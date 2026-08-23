/**
 * The chat→session relay: ensure one durable agent session per chat key,
 * submit inbound texts as turns, and relay the final assistant text back.
 *
 * Structural interfaces here keep the relay unit-testable without a Cordis
 * context; `index.ts` binds the real services onto it.
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { InboundMessage } from './types.ts'

/** Minimal agent face the relay drives (structural view of the real handle). */
export interface RelayAgent {
  readonly session: {
    /** Log length; snapshot before submitting so the reply fold starts here. */
    readonly seq: number
    readonly events: readonly SessionEvent[]
  }
  followup(input: ReturnType<typeof createUserMessage>): void
  whenIdle(): Promise<void>
  cancel(reason: { kind: 'user' }): void
}

/** Services the relay needs, all optional-resolved by the plugin wrapper. */
export interface RelayServices {
  /** Durability checkpoint for one agent's session (the session store owns it). */
  flushSession(session: RelayAgent['session']): Promise<boolean>
  createAgent(options: {
    sessionId: SessionId
    meta: { cwd: string; agentPreset?: string }
    setup?: ((agentCtx: Context) => Promise<void>) | undefined
  }): Promise<{ agent: RelayAgent }>
  getLiveAgent(sessionId: SessionId): unknown
}

export interface RelayConfig {
  /** Working directory recorded on gateway-created sessions. */
  cwd: string
  /**
   * Telegram user ids allowed to drive the agent. An empty list denies every
   * inbound message: an open bot is never a default.
   */
  allowedUserIds: readonly string[]
}

const HELP_TEXT = [
  'DSH Telegram channel:',
  '/new — start a fresh conversation',
  '/help — show this help',
  'Anything else is sent to the agent.',
].join('\n')

/**
 * True when `/new` or `/reset` asks for a fresh conversation. Both exist for
 * muscle memory; they mean the same thing here.
 */
export function isResetCommand(text: string): boolean {
  return text === '/new' || text === '/reset'
}

interface ChatState {
  generation: number
  chain: Promise<void>
  agent: RelayAgent | undefined
}

export interface RelayOptions {
  /** Invoked per created session so callers can join preset rosters. */
  setupFactory?: (() => ((agentCtx: Context) => Promise<void>) | undefined) | undefined
  /** Recorded on gateway-created sessions when a default composition exists. */
  presetId?: string | undefined
}

export interface ReplyOutcome {
  text: string
  reason: TurnEndReason | undefined
}

/** Extract the last committed non-empty assistant text at or after `seq`. */
export function assistantTextSince(events: readonly SessionEvent[], seq: number): ReplyOutcome {
  let text: string | undefined
  let reason: TurnEndReason | undefined
  for (const event of events) {
    if (event.seq < seq) continue
    if (event.type === 'assistant/message') {
      const blocks = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text.trim())
        .filter(text => text.length > 0)
      if (blocks.length > 0) text = blocks.join('\n\n')
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text: text ?? '', reason }
}

/** One relay instance owns the chat-key → session mapping for its process. */
export class TelegramRelay {
  private readonly chats = new Map<string, ChatState>()

  constructor(
    private readonly options: RelayOptions,
    private readonly services: RelayServices,
    private readonly config: RelayConfig,
    private readonly io: {
      send(chatId: InboundMessage['chatId'], text: string): Promise<void>
      typing(chatId: InboundMessage['chatId']): Promise<void>
      logger?: { info(message: string): void; warn(message: string): void }
    },
  ) {}

  /** Forget the chat's current session so the next message starts fresh. */
  resetChat(message: InboundMessage): void {
    const state = this.chatState(message)
    state.generation += 1
    state.agent = undefined
  }

  /**
   * Route one authorized, addressed inbound message: commands answer
   * immediately; anything else queues behind the chat's previous turn and
   * relays the final assistant text.
   */
  async handle(message: InboundMessage): Promise<void> {
    if (!this.isAllowed(message)) {
      this.io.logger?.warn(`telegram: rejected message from non-allowed user ${message.senderId}`)
      return
    }
    if (isResetCommand(message.text)) {
      this.resetChat(message)
      await this.io.send(message.chatId, 'Started a fresh conversation.')
      return
    }
    if (message.text === '/help') {
      await this.io.send(message.chatId, HELP_TEXT)
      return
    }
    const state = this.chatState(message)
    const previous = state.chain
    const run = previous.catch(() => {}).then(() => this.runTurn(message, state))
    state.chain = run
    await run
  }

  private async runTurn(message: InboundMessage, state: ChatState): Promise<void> {
    const agent = await this.ensureAgent(message, state)
    // Snapshot before submitting: everything at or after this seq is ours.
    const firstSeq = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: message.text }],
      source: { kind: 'user' },
    }))
    const typing = this.startTypingHeartbeat(message.chatId)
    try {
      await agent.whenIdle()
    } finally {
      clearInterval(typing)
    }
    const outcome = assistantTextSince(agent.session.events, firstSeq)
    await this.services.flushSession(agent.session)
    const suffix = outcome.reason !== undefined && outcome.reason.kind !== 'completed'
      ? `\n\n_(turn ended: ${outcome.reason.kind})_`
      : ''
    await this.io.send(message.chatId, `${outcome.text}${suffix}`.trim() || '(empty reply)')
  }

  private startTypingHeartbeat(chatId: InboundMessage['chatId']): ReturnType<typeof setInterval> {
    void this.io.typing(chatId)
    const timer = setInterval(() => {
      void this.io.typing(chatId).catch(() => {})
    }, 4_000)
    return timer
  }

  /**
   * Live reuse → reuse; otherwise create a fresh generation-scoped session.
   * Cold persistence resume joins the current default composition; the relay
   * never bypasses the agent factory.
   */
  private async ensureAgent(message: InboundMessage, state: ChatState): Promise<RelayAgent> {
    if (state.agent !== undefined) return state.agent
    const sessionId = SessionId(`tg-${this.keyOf(message)}${state.generation === 0 ? '' : `-gen${state.generation}`}`)
    const existing = this.services.getLiveAgent(sessionId) as RelayAgent | undefined
    if (existing !== undefined) {
      state.agent = existing
      return existing
    }
    const handle = await this.services.createAgent({
      sessionId,
      meta: this.options.presetId === undefined
        ? { cwd: this.config.cwd }
        : { cwd: this.config.cwd, agentPreset: this.options.presetId },
      setup: this.options.setupFactory?.(),
    })
    state.agent = handle.agent
    return handle.agent
  }

  private isAllowed(message: InboundMessage): boolean {
    return this.config.allowedUserIds.includes(message.senderId)
  }

  private keyOf(message: InboundMessage): string {
    const base = typeof message.chatId === 'string' ? message.chatId : String(message.chatId)
    return message.threadId === undefined ? base : `${base}:${message.threadId}`
  }

  private chatState(message: InboundMessage): ChatState {
    const key = this.keyOf(message)
    let state = this.chats.get(key)
    if (state === undefined) {
      state = { generation: 0, chain: Promise.resolve(), agent: undefined }
      this.chats.set(key, state)
    }
    return state
  }
}
