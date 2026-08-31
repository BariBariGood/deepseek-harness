import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import LlmRuntime, { createUserMessage, EMPTY_RESPONSE_CODE, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmFailure, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { LlmPersistEventData } from '@deepseek-ai/dsh-llm-persist/types'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as persist from '../src/index.ts'

type ScriptEntry = Iterable<StreamChunk> | AsyncIterable<StreamChunk>

it('keeps the browser-safe persist payload identical to the session event', () => {
  expectTypeOf<LlmPersistEventData>().toEqualTypeOf<SessionEventMap['llm/persist']>()
})

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly entries: ScriptEntry[]) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.entries.shift()
    if (entry === undefined) throw new Error('persist test script exhausted')
    yield* entry
  }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/**
 * A degenerate empty provider completion as an error finish chunk: the shape
 * both adapters emit for a completed response with no content.
 */
function emptyCompletion(failure: Partial<LlmFailure> = {}): StreamChunk[] {
  return [
    { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } },
    {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: 'model returned a completed response with no content',
          code: EMPTY_RESPONSE_CODE,
          ...failure,
        },
      },
    },
  ]
}

async function harness(
  adapter: ScriptedAdapter,
  config: persist.Config = {},
  internals: persist.RetryInternals = {},
): Promise<{ ctx: Context; persistFiber: Fiber; disposeAdapter: () => void }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  const persistFiber = await ctx.plugin(Object.assign((inner: Context) => {
    persist.apply(inner, config, internals)
  }, { inject: persist.inject }))
  await ctx.plugin(AgentLoop, { agents: [] })
  const disposeAdapter = ctx.llm.registerAdapter(['mock', 'other'], adapter)
  return { ctx, persistFiber, disposeAdapter }
}

function waitForIdle(_ctx: Context, agent: Agent): Promise<void> {
  return agent.whenIdle()
}

function waitForPersist(ctx: Context, agent: Agent, retryNumber: number): Promise<Extract<SessionEvent, { type: 'llm/persist' }>> {
  return new Promise((resolve) => {
    const dispose = ctx.on('session/event', (session, event) => {
      if (session === agent.session && event.type === 'llm/persist' && event.data.retry === retryNumber) {
        dispose()
        resolve(event)
      }
    })
  })
}

let context: Context | undefined

afterEach(async () => {
  vi.useRealTimers()
  await context?.fiber.dispose()
  context = undefined
})

describe('provider-pinned retry persistence', () => {
  it('records the scheduled delay before retrying the request', async () => {
    vi.useFakeTimers()
    const adapter = new ScriptedAdapter([
      emptyCompletion(),
      textResponse('recovered'),
    ])
    ;({ ctx: context } = await harness(adapter, {
      providers: ['mock'],
      backoff: { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0 },
    }, { random: () => 0.5 }))
    const agent = context.agentLoop.create(SessionId('persist-empty-response'), {
      provider: 'mock',
      model: 'mock',
    })
    const scheduled = waitForPersist(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    const event = await scheduled

    expect(event.data.retryId).toEqual(expect.any(String))
    expect(event.data).toEqual({
      retryId: event.data.retryId,
      turn: 1,
      step: 1,
      provider: 'mock',
      code: EMPTY_RESPONSE_CODE,
      policyKey: `[["${EMPTY_RESPONSE_CODE}"],500,10000,0]`,
      retry: 1,
      delayMs: 500,
      failure: {
        message: 'model returned a completed response with no content',
        code: EMPTY_RESPONSE_CODE,
      },
    })
    expect(adapter.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(499)
    expect(adapter.requests).toHaveLength(1)

    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(1)
    await idle

    expect(adapter.requests).toHaveLength(2)
    expect(agent.session.events.filter(item => item.type === 'step/start').map(item => item.data))
      .toEqual([{ turn: 1, step: 1 }])
    expect(agent.session.deriveMessages().at(-1)).toEqual({
      id: expect.any(String) as unknown,
      role: 'assistant',
      content: [{ type: 'text', text: 'recovered' }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    })
  })

  it('keeps retrying past one failure and preserves the retry chain identity', async () => {
    vi.useFakeTimers()
    const adapter = new ScriptedAdapter([
      emptyCompletion(),
      emptyCompletion(),
      textResponse('recovered'),
    ])
    ;({ ctx: context } = await harness(adapter, {
      providers: ['mock'],
      backoff: { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0 },
    }, { random: () => 0.5 }))
    const agent = context.agentLoop.create(SessionId('persist-chain'), {
      provider: 'mock',
      model: 'mock',
    })
    const first = waitForPersist(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    const event1 = await first

    const second = waitForPersist(context, agent, 2)
    await vi.advanceTimersByTimeAsync(500)
    const event2 = await second

    expect(event2.data.retryId).toBe(event1.data.retryId)
    expect(event2.data.retry).toBe(2)
    expect(event2.data.delayMs).toBe(1_000)

    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(1_000)
    await idle

    expect(adapter.requests).toHaveLength(3)
    expect(agent.session.events.filter(event => event.type === 'llm/persist-started')).toHaveLength(2)
    expect(agent.session.deriveMessages().at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'recovered' }],
    })
  })

  it('delegates providers outside the configured set', async () => {
    const adapter = new ScriptedAdapter([emptyCompletion()])
    ;({ ctx: context } = await harness(adapter))
    const agent = context.agentLoop.create(SessionId('persist-unmatched-provider'), {
      provider: 'mock',
      model: 'mock',
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(context, agent)

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'llm/persist')).toHaveLength(0)
  })

  it('delegates failures outside the configured codes', async () => {
    const adapter = new ScriptedAdapter([emptyCompletion()])
    ;({ ctx: context } = await harness(adapter, {
      providers: ['mock'],
      codes: ['SERVER'],
    }))
    const agent = context.agentLoop.create(SessionId('persist-unmatched-code'), {
      provider: 'mock',
      model: 'mock',
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(context, agent)

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'llm/persist')).toHaveLength(0)
  })

  it('honors providerRetryAfterMs within the backoff cap', async () => {
    vi.useFakeTimers()
    const adapter = new ScriptedAdapter([
      emptyCompletion({ providerRetryAfterMs: 250 }),
      textResponse('recovered'),
    ])
    ;({ ctx: context } = await harness(adapter, {
      providers: ['mock'],
      backoff: { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0 },
    }, { random: () => 0.5 }))
    const agent = context.agentLoop.create(SessionId('persist-retry-after'), {
      provider: 'mock',
      model: 'mock',
    })
    const scheduled = waitForPersist(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    const event = await scheduled
    expect(event.data.delayMs).toBe(250)

    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(250)
    await idle
    expect(adapter.requests).toHaveLength(2)
  })

  it('uses local backoff when providerRetryAfterMs exceeds the cap', async () => {
    vi.useFakeTimers()
    const adapter = new ScriptedAdapter([
      emptyCompletion({ providerRetryAfterMs: 99_999 }),
      textResponse('recovered'),
    ])
    ;({ ctx: context } = await harness(adapter, {
      providers: ['mock'],
      backoff: { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0 },
    }, { random: () => 0.5 }))
    const agent = context.agentLoop.create(SessionId('persist-retry-after-cap'), {
      provider: 'mock',
      model: 'mock',
    })
    const scheduled = waitForPersist(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    const event = await scheduled
    expect(event.data.delayMs).toBe(500)

    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(500)
    await idle
    expect(adapter.requests).toHaveLength(2)
  })

  it('applies jitter to locally scheduled backoff', async () => {
    vi.useFakeTimers()
    const adapter = new ScriptedAdapter([
      emptyCompletion(),
      textResponse('recovered'),
    ])
    ;({ ctx: context } = await harness(adapter, {
      providers: ['mock'],
      backoff: { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0.1 },
    }, { random: () => 0 }))
    const agent = context.agentLoop.create(SessionId('persist-jitter'), {
      provider: 'mock',
      model: 'mock',
    })
    const scheduled = waitForPersist(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    const event = await scheduled
    expect(event.data.delayMs).toBe(450)

    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(450)
    await idle
    expect(adapter.requests).toHaveLength(2)
  })

  it('cancellation during the wait writes no started event and stops retrying', async () => {
    vi.useFakeTimers()
    const adapter = new ScriptedAdapter([
      emptyCompletion(),
      textResponse('never'),
    ])
    const built = await harness(adapter, {
      providers: ['mock'],
      backoff: { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0 },
    }, { random: () => 0.5 })
    context = built.ctx
    const agent = context.agentLoop.create(SessionId('persist-cancel'), {
      provider: 'mock',
      model: 'mock',
    })
    const scheduled = waitForPersist(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await scheduled
    await built.persistFiber.dispose()
    await vi.advanceTimersByTimeAsync(500)

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'llm/persist-started')).toHaveLength(0)
  })

  it('refuses recovery for a callback captured before disposal', async () => {
    vi.useFakeTimers()
    const adapter = new ScriptedAdapter([emptyCompletion()])
    const built = await harness(adapter, {
      providers: ['mock'],
      backoff: { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0 },
    }, { random: () => 0.5 })
    context = built.ctx
    // A slow earlier listener keeps the captured chain open while the persist
    // plugin disposes; the captured callback must then fail closed.
    context.on('agent/request-error', async (_payload, next) => {
      await new Promise<void>(resolve => setTimeout(resolve, 100))
      return next()
    }, { prepend: true })
    const agent = context.agentLoop.create(SessionId('persist-stale-callback'), {
      provider: 'mock',
      model: 'mock',
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await vi.advanceTimersByTimeAsync(1)
    await built.persistFiber.dispose()
    await vi.advanceTimersByTimeAsync(100)
    await waitForIdle(context, agent)

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'llm/persist')).toHaveLength(0)
  })

  it('reads the live settings section for recovery decisions', async () => {
    vi.useFakeTimers()
    class MemorySettings extends SettingsProvider {
      doc: Record<string, unknown> = {}

      get writable(): boolean {
        return true
      }

      protected load(): Promise<Record<string, unknown>> {
        return Promise.resolve(structuredClone(this.doc))
      }

      protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
        this.doc[ns] = structuredClone(section)
      }
    }
    const adapter = new ScriptedAdapter([
      emptyCompletion({ message: 'busy', code: 'SERVER' }),
      textResponse('recovered'),
    ])
    const built = await harness(adapter, {
      providers: ['mock'],
    }, { random: () => 0.5 })
    context = built.ctx
    await built.ctx.plugin(MemorySettings)
    await built.ctx.settings.update('llm-persist' as SettingsNamespace, {
      providers: ['mock'],
      codes: ['SERVER'],
      backoff: { initialDelayMs: 500, maxDelayMs: 10_000, jitterRatio: 0 },
    })
    const agent = context.agentLoop.create(SessionId('persist-settings-live'), {
      provider: 'mock',
      model: 'mock',
    })
    const scheduled = waitForPersist(context, agent, 1)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    const event = await scheduled
    expect(event.data.code).toBe('SERVER')

    const idle = waitForIdle(context, agent)
    await vi.advanceTimersByTimeAsync(500)
    await idle
    expect(adapter.requests).toHaveLength(2)
  })

  it('rejects unknown config keys', () => {
    const ctx = new Context()
    expect(() => {
      persist.apply(ctx, { bogus: true } as unknown as persist.Config, {})
    }).toThrow('llm-persist: unknown key "bogus"')
    void ctx.fiber.dispose()
  })
})
