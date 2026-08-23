import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import * as PersistInvariant from '../src/invariant.ts'
import { PersistId } from '../src/brand.ts'
import type { LlmPersistEventData, LlmPersistStartedEventData } from '../src/types.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

const failure: LlmFailure = { message: 'no content', code: 'EMPTY_RESPONSE' }

function persistEvent(
  overrides: Partial<LlmPersistEventData> = {},
): LlmPersistEventData {
  return {
    retryId: PersistId('r1'),
    turn: 1,
    step: 1,
    provider: 'mock',
    code: 'EMPTY_RESPONSE',
    policyKey: 'k',
    retry: 1,
    delayMs: 5,
    failure,
    ...overrides,
  }
}

function startedEvent(
  overrides: Partial<LlmPersistStartedEventData> = {},
): LlmPersistStartedEventData {
  return { retryId: PersistId('r1'), turn: 1, step: 1, retry: 1, ...overrides }
}

async function setup(
  earlyEvents: boolean,
): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId(`persist-invariant-${Math.random()}`), {
    meta: { cwd: '/workspace' },
  })
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  if (earlyEvents) {
    session.append('llm/persist', persistEvent())
    session.append('llm/persist-started', startedEvent())
  }
  await ctx.plugin(PersistInvariant)
  return { ctx, session }
}

describe('LLM persist invariants', () => {
  it('accepts a valid persist chain recorded before the companion mounts', async () => {
    const { ctx } = await setup(true)
    await ctx.fiber.dispose()
  })

  it('accepts a valid persist chain appended after the companion mounts', async () => {
    const { ctx, session } = await setup(false)
    session.append('llm/persist', persistEvent())
    session.append('llm/persist-started', startedEvent())
    await ctx.fiber.dispose()
  })

  it.each([
    [persistEvent({ retryId: PersistId('') }), /retryId must be a non-empty string/],
    [persistEvent({ failure: null as unknown as LlmFailure }), /failure must be an object/],
    [persistEvent({ failure: { code: 'EMPTY_RESPONSE' } as unknown as LlmFailure }), /failure.message must be a non-empty string/],
    [persistEvent({ failure: { message: 'no content' } as unknown as LlmFailure }), /failure.code must be a non-empty string/],
    [persistEvent({ failure: { message: 'm', code: 'EMPTY_RESPONSE', status: 42 } }), /failure.status must be an integer from 100 through 599/],
    [persistEvent({ failure: { message: 'm', code: 'EMPTY_RESPONSE', status: 600 } }), /failure.status must be an integer from 100 through 599/],
    [persistEvent({ failure: { message: 'm', code: 'EMPTY_RESPONSE', providerRetryAfterMs: 0 } }), /failure.providerRetryAfterMs must be a positive finite number/],
    [persistEvent({ failure: { message: 'm', code: 'EMPTY_RESPONSE', requestId: '' } as unknown as LlmFailure }), /failure.requestId must be a non-empty string/],
    [persistEvent({ code: 'SERVER' }), /code must equal failure.code/],
    [persistEvent({ retry: 0 }), /retry must be a positive safe integer/],
    [persistEvent({ provider: '' }), /provider must be a non-empty string/],
    [persistEvent({ policyKey: '' }), /policyKey must be a non-empty string/],
    [persistEvent({ delayMs: -1 }), /delayMs must be a finite number/],
    [persistEvent({ delayMs: 2 ** 33 }), /delayMs must be a finite number/],
    [persistEvent({ delayMs: 'fast' as unknown as number }), /delayMs must be a finite number/],
    [persistEvent({ turn: 2 }), /names turn 2, but the open turn is 1/],
    [persistEvent({ step: 2 }), /names turn 1\/step 2, but the open step is 1\/1/],
    [persistEvent({ retry: 2 }), /retry 2 must equal provider-policy retry 1/],
  ] as Array<[LlmPersistEventData, RegExp]>)('rejects a malformed persist record %#', async (data, message) => {
    const { ctx, session } = await setup(false)
    expect(() => session.append('llm/persist', data)).toThrow(message)
    await ctx.fiber.dispose()
  })

  it('rejects a persist record outside an open turn', async () => {
    const { ctx, session } = await setup(false)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(() => session.append('llm/persist', persistEvent())).toThrow(/inside an open turn/)
    await ctx.fiber.dispose()
  })

  it('rejects a persist record outside an open step', async () => {
    const { ctx, session } = await setup(false)
    session.append('step/end', { turn: 1, step: 1 })
    expect(() => session.append('llm/persist', persistEvent())).toThrow(/inside an open step/)
    await ctx.fiber.dispose()
  })

  it('rejects a chain that changes its retryId', async () => {
    const { ctx, session } = await setup(false)
    session.append('llm/persist', persistEvent())
    expect(() => session.append('llm/persist', persistEvent({ retryId: PersistId('other'), retry: 2 })))
      .toThrow(/must preserve retryId across one provider-policy chain/)
    await ctx.fiber.dispose()
  })

  it('rejects a retryId owned by another chain', async () => {
    const { ctx, session } = await setup(false)
    session.append('llm/persist', persistEvent({ retryId: PersistId('r2'), policyKey: 'other' }))
    expect(() => session.append('llm/persist', persistEvent({ retryId: PersistId('r2') })))
      .toThrow(/already owned by another chain/)
    await ctx.fiber.dispose()
  })

  it.each([
    [startedEvent({ retryId: PersistId('') }), /retryId must be a non-empty string/],
    [startedEvent({ retry: 2 }), /pairs no prior scheduled attempt/],
    [startedEvent({ turn: 2 }), /turn\/step must match its scheduled attempt/],
  ] as Array<[LlmPersistStartedEventData, RegExp]>)('rejects a malformed started transition %#', async (data, message) => {
    const { ctx, session } = await setup(false)
    session.append('llm/persist', persistEvent())
    expect(() => session.append('llm/persist-started', data)).toThrow(message)
    await ctx.fiber.dispose()
  })

  it('rejects a repeated started transition', async () => {
    const { ctx, session } = await setup(false)
    session.append('llm/persist', persistEvent())
    session.append('llm/persist-started', startedEvent())
    expect(() => session.append('llm/persist-started', startedEvent())).toThrow(/repeats one scheduled attempt/)
    await ctx.fiber.dispose()
  })
})
