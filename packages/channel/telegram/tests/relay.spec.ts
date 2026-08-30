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
    /** How many fake routes listModels returns (paging tests). */
    modelCount?: number | undefined
  } = {}) {
    const created: { sessionId: string; meta: { cwd: string } }[] = []
    const liveAgents = new Map<string, unknown>()
    if (options.existingLive !== undefined) liveAgents.set('tg-100', options.existingLive)
    const scripted = scriptedAgent({ replies: options.replies ?? [] })
    const sent: { chatId: TelegramChatId; text: string }[] = []
    const edits: { chatId: TelegramChatId; messageId: number; text: string }[] = []
    const typingCalls: TelegramChatId[] = []
    const keyboards: { chatId: TelegramChatId; text: string; keyboard: { label: string; callbackData: string }[][] }[] = []
    const answered: string[] = []

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
        listModels: async () => {
          if ((options.modelCount ?? 0) > 0) {
            return Array.from({ length: options.modelCount! }, (_, index) => ({
              provider: 'opencode-go',
              model: `model-${String(index).padStart(2, '0')}`,
              name: `Model ${index}`,
            }))
          }
          return [
            { provider: 'opencode-go', model: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
            { provider: 'zen-go', model: 'claude-4', name: 'Claude 4' },
          ]
        },
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
        sendKeyboard: async (chatId, text, keyboard) => {
          keyboards.push({ chatId, text, keyboard: keyboard.map(row => row.map(button => ({ ...button }))) })
          sent.push({ chatId, text })
          return { messageId: sent.length }
        },
        edit: async (chatId, messageId, text) => {
          edits.push({ chatId, messageId, text })
        },
        editMessage: async (chatId, messageId, text, keyboard) => {
          edits.push({ chatId, messageId, text })
          keyboards.push({ chatId, text, keyboard: keyboard.map(row => row.map(button => ({ ...button }))) })
        },
        answerCallback: async (callbackId) => {
          answered.push(callbackId)
        },
        typing: async (chatId) => {
          typingCalls.push(chatId)
        },
      },
    )
    return { relay, sent, edits, typingCalls, created, scripted, followupsOf: () => scripted.followups, keyboards, answered }
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

  it('rejects messages from users outside the allowlist with a self-service notice', async () => {
    const bench0 = bench({ allowedUserIds: [] })
    await bench0.relay.handle(message('hello'))
    expect(bench0.created).toHaveLength(0)
    const notice = bench0.sent.at(-1)?.text ?? ''
    expect(notice).toContain('not on this bot\'s allowlist')
    expect(notice).toContain('555')
    // The notice is once per sender, not a reply loop.
    await bench0.relay.handle(message('hello again'))
    expect(bench0.sent).toHaveLength(1)
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

  it('answers bare /model with a provider-level menu', async () => {
    const bench0 = bench()
    await bench0.relay.handle(message('/model'))
    expect(bench0.created).toHaveLength(0)
    const text = bench0.sent.at(-1)?.text ?? ''
    expect(text).toContain('Current model: opencode-go/deepseek-v4-flash')
    const menu = bench0.keyboards.at(-1)
    expect(menu).toBeDefined()
    const datas = menu!.keyboard.map(row => row[0]?.callbackData ?? '')
    expect(datas).toContain('modelp:opencode-go')
    expect(datas).toContain('modelp:zen-go')
    const marked = menu!.keyboard.find(row => row[0]?.label.startsWith('✓ '))
    expect(marked?.[0]?.label).toContain('opencode-go')
  })

  it('drills into a provider, pages, and switches on a model press', async () => {
    const bench0 = bench()
    // Level one → provider submenu.
    await bench0.relay.handleCallback({
      callbackId: 'cb0', fromId: '555', chatId: 100, threadId: undefined,
      messageId: 7, data: 'modelp:zen-go',
    })
    expect(bench0.answered).toContain('cb0')
    const menu = bench0.keyboards.at(-1)
    expect(menu?.keyboard.map(row => row[0]?.callbackData)).toContain('model:zen-go/claude-4')
    expect(menu?.keyboard.at(-1)?.some(button => button.label === '↩ Providers')).toBe(true)
    // Level two → commit the pick; keyboard collapses to empty.
    await bench0.relay.handleCallback({
      callbackId: 'cb1', fromId: '555', chatId: 100, threadId: undefined,
      messageId: 7, data: 'model:zen-go/claude-4',
    })
    expect(bench0.answered).toContain('cb1')
    expect(bench0.edits.at(-1)?.text).toBe('Model set to zen-go/claude-4.')
    expect(bench0.keyboards.at(-1)?.keyboard ?? []).toEqual([])
    // The switch persists for the chat's next turn.
    await bench0.relay.handle(message('/model flash'))
    expect(bench0.sent.at(-1)?.text).toBe('Model set to opencode-go/deepseek-v4-flash.')
  })

  it('pages through many models with Back and Next', async () => {
    const bench0 = bench({ modelCount: 20 })
    await bench0.relay.handleCallback({
      callbackId: 'cb2', fromId: '555', chatId: 100, threadId: undefined,
      messageId: 7, data: 'modelpage:opencode-go/1',
    })
    const text = bench0.edits.at(-1)?.text ?? ''
    expect(text).toContain('page 2/3')
    const menu = bench0.keyboards.at(-1)
    // Middle page: Back and Next both present, Providers centered between them.
    expect(menu?.keyboard.at(-1)?.map(button => button.label)).toEqual(['‹ Back', '↩ Providers', 'Next ›'])
  })

  it('returns to the provider level from the ↩ Providers button', async () => {
    const bench0 = bench()
    await bench0.relay.handleCallback({
      callbackId: 'cb3', fromId: '555', chatId: 100, threadId: undefined,
      messageId: 7, data: 'modelroot:',
    })
    expect(bench0.answered).toContain('cb3')
    const datas = (bench0.keyboards.at(-1)?.keyboard ?? []).map(row => row[0]?.callbackData ?? '')
    expect(datas.some(data => data.startsWith('modelp:'))).toBe(true)
  })

  it('rejects button presses from non-allowed users', async () => {
    const bench0 = bench()
    await bench0.relay.handleCallback({
      callbackId: 'cb4', fromId: '999', chatId: 100, threadId: undefined,
      messageId: 7, data: 'model:zen-go/claude-4',
    })
    expect(bench0.answered).toContain('cb4')
    expect(bench0.edits).toHaveLength(0)
  })

  it('toasts a failure when the pressed route does not resolve', async () => {
    const bench0 = bench()
    await bench0.relay.handleCallback({
      callbackId: 'cb5', fromId: '555', chatId: 100, threadId: undefined,
      messageId: 7, data: 'model:missing/nope',
    })
    expect(bench0.answered).toContain('cb5')
    expect(bench0.edits).toHaveLength(0)
  })

  it('switches by full provider/model and by a unique bare name', async () => {
    const bench0 = bench()
    await bench0.relay.handle(message('/model zen-go/claude-4'))
    expect(bench0.sent.at(-1)?.text).toBe('Model set to zen-go/claude-4.')
    await bench0.relay.handle(message('/model'))
    expect(bench0.sent.at(-1)?.text).toContain('Current model: zen-go/claude-4')
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
    expect(text).toContain('zen-go/claude-4')
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
        sendKeyboard: async () => ({ messageId: 0 }),
        edit: async () => {},
        editMessage: async () => {},
        answerCallback: async () => {},
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
        sendKeyboard: async () => ({ messageId: 0 }),
        edit: async (chatId, messageId, text) => {
          edits.push({ chatId, messageId, text })
        },
        editMessage: async () => {},
        answerCallback: async () => {},
        typing: async () => {},
      },
    )

    await relay.handle(message('stream please'))
    expect(sent.map(entry => entry.text)).toEqual(['draft part one'])
    expect(edits.length).toBeGreaterThanOrEqual(1)
    expect(edits.at(-1)?.text).toBe('draft part one + two')
  })
})
