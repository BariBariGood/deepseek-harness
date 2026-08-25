import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { assistantTextSince, TelegramRelay } from '../src/relay.ts'
import type { InboundMessage, TelegramChatId } from '../src/types.ts'

function message(text: string, chatId: TelegramChatId = 100): InboundMessage {
  return {
    text,
    chatId,
    chatType: 'private',
    chatTitle: undefined,
    senderId: '555',
    senderName: 'Ada',
    threadId: undefined,
    messageId: 42,
  }
}

type ScriptedEndReason = 'completed' | 'aborted' | 'error'

interface ScriptedAgentOptions {
  replies?: string[] | undefined
  reason?: ScriptedEndReason | undefined
}

function endEvent(seq: number, kind: ScriptedEndReason): SessionEvent {
  const data = kind === 'error'
    ? { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } }
    : kind === 'aborted'
      ? { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }
      : { turn: 1, reason: { kind: 'completed' } }
  return { type: 'turn/end', seq, time: 2, data } as unknown as SessionEvent
}

/** One fake agent whose log grows by an assistant message + turn/end per turn. */
function scriptedAgent(options: ScriptedAgentOptions = {}) {
  let seq = 0
  const events: SessionEvent[] = []
  const followups: string[] = []
  const agent = {
    session: {
      get seq() {
        return seq
      },
      events,
      flush: async () => true,
    },
    followup(input: { content: readonly { type: string; text?: string }[] }) {
      followups.push(input.content.find(block => block.type === 'text')?.text ?? '')
      const reply = options.replies?.[followups.length - 1] ?? `echo: ${followups.at(-1)}`
      seq += 1
      events.push({ type: 'assistant/message', seq, time: 1, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } } } as unknown as SessionEvent)
      if (options.reason === undefined || options.reason === 'completed') {
        seq += 1
        events.push(endEvent(seq, 'completed'))
      } else {
        seq += 1
        events.push(endEvent(seq, options.reason))
      }
    },
    whenIdle: async () => {},
    cancel: vi.fn(),
  }
  return { agent, followups }
}

describe('TelegramRelay', () => {
  function bench(options: {
    allowedUserIds?: readonly string[] | undefined
    existingLive?: object | undefined
    replies?: string[] | undefined
    reason?: ScriptedEndReason | undefined
  } = {}) {
    const created: { sessionId: string; meta: { cwd: string } }[] = []
    const liveAgents = new Map<string, unknown>()
    if (options.existingLive !== undefined) liveAgents.set('tg-100', options.existingLive)
    const scripted = scriptedAgent({ replies: options.replies ?? [] })
    const sent: { chatId: TelegramChatId; text: string }[] = []
    const edits: { chatId: TelegramChatId; messageId: number; text: string }[] = []
    const typingCalls: TelegramChatId[] = []

    const relay = new TelegramRelay(
      {},
      {
        flushSession: async () => true,
        createAgent: async ({ sessionId, meta }) => {
          created.push({ sessionId: String(sessionId), meta })
          // Fresh agents get their own scripted instance so /new resets cleanly.
          const fresh = scriptedAgent({
            replies: options.replies ?? [],
            reason: 'reason' in options && typeof options.reason === 'string' ? options.reason : undefined,
          })
          liveAgents.set(String(sessionId), fresh.agent)
          return { agent: fresh.agent }
        },
        getLiveAgent: sessionId => liveAgents.get(String(sessionId)),
        listModels: async () => [
          { provider: 'opencode-go', model: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
          { provider: 'zen-go', model: 'ox-alpha-free', name: 'Ox Alpha' },
        ],
        resolveSelection: async (provider, model) => {
          if (provider === 'missing') throw new Error('unknown provider')
          return { provider, model }
        },
        defaultSelection: () => ({ provider: 'opencode-go', model: 'deepseek-v4-flash' }),
      },
      {
        cwd: '/tmp/fake-cwd',
        allowedUserIds: options.allowedUserIds ?? ['555'],
      },
      {
        send: async (chatId, text) => {
          sent.push({ chatId, text })
          return { messageId: sent.length }
        },
        edit: async () => {},
        typing: async (chatId) => {
          typingCalls.push(chatId)
        },
      },
    )
    return { relay, sent, edits, typingCalls, created, scripted, followupsOf: () => scripted.followups }
  }

  it('creates a deterministic session and relays the final text', async () => {
    const bench0 = bench({ replies: ['the answer'] })
    await bench0.relay.handle(message('hello'))
    expect(bench0.created[0]?.sessionId).toBe('tg-100')
    expect(bench0.created[0]?.meta.cwd).toBe('/tmp/fake-cwd')
    expect(bench0.sent.at(-1)?.text).toBe('the answer')
    expect(bench0.typingCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('reuses the same agent for a second message on the chat', async () => {
    const bench0 = bench()
    await bench0.relay.handle(message('first'))
    await bench0.relay.handle(message('second'))
    expect(bench0.created).toHaveLength(1)
    expect(bench0.sent.map(entry => entry.text)).toEqual(['echo: first', 'echo: second'])
  })

  it('rejects messages from users outside the allowlist', async () => {
    const bench0 = bench({ allowedUserIds: [] })
    await bench0.relay.handle(message('hello'))
    expect(bench0.created).toHaveLength(0)
    expect(bench0.sent).toHaveLength(0)
  })

  it('answers /new with a confirmation and starts a fresh generation', async () => {
    const bench0 = bench()
    await bench0.relay.handle(message('work on this'))
    await bench0.relay.handle(message('/new'))
    await bench0.relay.handle(message('again'))
    expect(bench0.sent[1]?.text).toContain('fresh conversation')
    expect(bench0.created.map(entry => entry.sessionId)).toEqual(['tg-100', 'tg-100-gen1'])
  })

  it('answers /help without touching any session', async () => {
    const bench0 = bench()
    await bench0.relay.handle(message('/help'))
    expect(bench0.created).toHaveLength(0)
    expect(bench0.sent.at(-1)?.text).toContain('/new')
    expect(bench0.sent.at(-1)?.text).toContain('/model')
  })

  it('lists the current model and available routes on /model', async () => {
    const bench0 = bench()
    await bench0.relay.handle(message('/model'))
    expect(bench0.created).toHaveLength(0)
    const text = bench0.sent.at(-1)?.text ?? ''
    expect(text).toContain('Current model: opencode-go/deepseek-v4-flash')
    expect(text).toContain('zen-go/ox-alpha-free')
  })

  it('switches by full provider/model and by a unique bare name', async () => {
    const bench0 = bench()
    await bench0.relay.handle(message('/model zen-go/ox-alpha-free'))
    expect(bench0.sent.at(-1)?.text).toBe('Model set to zen-go/ox-alpha-free.')
    await bench0.relay.handle(message('/model'))
    expect(bench0.sent.at(-1)?.text).toContain('Current model: zen-go/ox-alpha-free')
    await bench0.relay.handle(message('/model flash'))
    expect(bench0.sent.at(-1)?.text).toBe('Model set to opencode-go/deepseek-v4-flash.')
  })

  it('tells the user when a bare /model name matches nothing', async () => {
    const bench0 = bench()
    await bench0.relay.handle(message('/model go'))
    const text = bench0.sent.at(-1)?.text ?? ''
    expect(text).toContain('No model matches')
    expect(text).toContain('Send /model')
  })

  it('lists candidates when a bare /model name is ambiguous', async () => {
    const bench0 = bench()
    await bench0.relay.handle(message('/model e'))
    const text = bench0.sent.at(-1)?.text ?? ''
    expect(text).toContain('ambiguous')
    expect(text).toContain('zen-go/ox-alpha-free')
  })

  it('serializes concurrent messages per chat instead of interleaving turns', async () => {
    let releaseSecond!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    let calls = 0
    const sent: { chatId: TelegramChatId; text: string }[] = []
    const relay = new TelegramRelay(
      {},
      {
        flushSession: async () => true,
        createAgent: async () => ({
          agent: {
            session: {
              seq: 0,
              events: [],
            },
            followup() {},
            whenIdle: async () => {
              calls += 1
              if (calls === 1) await gate
            },
            cancel: () => {},
          },
        }),
        getLiveAgent: () => undefined,
        listModels: async () => [],
        resolveSelection: async (provider, model) => ({ provider, model }),
        defaultSelection: () => ({ provider: 'opencode-go', model: 'deepseek-v4-flash' }),
      },
      { cwd: '/tmp/fake-cwd', allowedUserIds: ['555'] },
      {
        send: async (chatId, text) => {
          sent.push({ chatId, text })
          return { messageId: sent.length }
        },
        edit: async () => {},
        typing: async () => {},
      },
    )

    const first = relay.handle(message('slow'))
    const second = relay.handle(message('fast'))
    let secondDone = false
    void second.then(() => {
      secondDone = true
    })
    await Promise.resolve()
    expect(secondDone).toBe(false)
    releaseSecond()
    await Promise.all([first, second])
    expect(sent.map(entry => entry.text)).toEqual(['(empty reply)', '(empty reply)'])
  })

  it('appends a note when the turn ends abnormally', async () => {
    const bench0 = bench({ replies: ['partial'], reason: 'aborted' as const })
    await bench0.relay.handle(message('do the thing'))
    expect(bench0.sent.at(-1)?.text).toBe('partial\n\n_(turn ended: aborted)_')
  })

  it('assistantTextSince skips events before the snapshot seq', () => {
    const stale: SessionEvent = { type: 'assistant/message', seq: 0, time: 1, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'stale' }] } } } as unknown as SessionEvent
    const events: SessionEvent[] = [stale, endEvent(1, 'completed')]
    const outcome = assistantTextSince(events, 2)
    expect(outcome).toEqual({ text: '', reason: undefined })
  })
})

describe('TelegramRelay draft streaming', () => {
  it('edits one draft message with folded text and finalizes it', async () => {
    const sent: { chatId: TelegramChatId; text: string }[] = []
    const edits: { chatId: TelegramChatId; messageId: number; text: string }[] = []

    const agent = {
      session: {
        seq: 0,
        events: [] as SessionEvent[],
        flush: async () => true,
      },
      followup() {},
      whenIdle: () => new Promise<void>((resolve) => {
        // A real turn lands assistant messages across time: step one early,
        // step two only at completion.
        const append = (text: string): void => {
          agent.session.events.push({
            type: 'assistant/message',
            seq: agent.session.seq + 1,
            time: 1,
            data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } },
          } as unknown as SessionEvent)
          agent.session.seq += 1
        }
        setTimeout(() => {
          append('draft part one')
          setTimeout(() => {
            append('draft part one + two')
            resolve()
          }, 25)
        }, 10)
      }),
      cancel: () => {},
    }

    const relay = new TelegramRelay(
      { streamIntervalMs: 5 },
      {
        createAgent: async () => ({ agent }),
        getLiveAgent: () => undefined,
        flushSession: async () => true,
        listModels: async () => [],
        resolveSelection: async (provider, model) => ({ provider, model }),
        defaultSelection: () => ({ provider: 'opencode-go', model: 'deepseek-v4-flash' }),
      },
      { cwd: '/tmp/fake-cwd', allowedUserIds: ['555'] },
      {
        send: async (chatId, text) => {
          sent.push({ chatId, text })
          return { messageId: sent.length }
        },
        edit: async (chatId, messageId, text) => {
          edits.push({ chatId, messageId, text })
        },
        typing: async () => {},
      },
    )

    await relay.handle(message('stream please'))
    expect(sent.map(entry => entry.text)).toEqual(['draft part one'])
    expect(edits.length).toBeGreaterThanOrEqual(1)
    expect(edits.at(-1)?.text).toBe('draft part one + two')
  })
})
