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
import type { SessionOrigin } from '@deepseek-ai/dsh-session'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { InboundMessage, TelegramCallbackQuery } from './types.ts'

/** Minimal agent face the relay drives (structural view of the real handle). */
export interface RelayAgent {
  readonly session: {
    /** Log length; snapshot before submitting so the reply fold starts here. */
    readonly seq: number
    readonly events: readonly SessionEvent[]
  }
  /** Live model-selection ref installed at setup; absent on legacy agents. */
  readonly selectionRef?: { current: { provider: string; model: string } | undefined } | undefined
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
    meta: { cwd: string; agentPreset?: string; origin?: SessionOrigin }
    /** Chat's model override; `undefined` follows the deployment default. */
    selection?: { provider: string; model: string } | undefined
    setup?: ((agentCtx: Context) => Promise<void>) | undefined
  }): Promise<{ agent: RelayAgent }>
  getLiveAgent(sessionId: SessionId): unknown
  /** Every selectable provider/model route, for `/model` display. */
  listModels(): Promise<readonly { provider: string; model: string; name: string }[]>
  /** Validate one route through the LLM seam before a chat adopts it. */
  resolveSelection(provider: string, model: string): Promise<{ provider: string; model: string }>
  /** The deployment default, shown by bare `/model` when no override is set. */
  defaultSelection(): { provider: string; model: string }
}

/** Access and working-directory facts the relay enforces on every route. */
export interface RelayConfig {
  /** Working directory recorded on gateway-created sessions. */
  cwd: string
  /**
   * Telegram user ids allowed to drive the agent. An empty list denies every
   * inbound message: an open bot is never a default.
   */
  allowedUserIds: readonly string[]
}

/** Minimum spacing between draft edits; Telegram rate-lips rapid edits. */
const STREAM_EDIT_INTERVAL_MS = 1_500

const HELP_TEXT = [
  'DSH Telegram channel:',
  '/new — start a fresh conversation',
  '/model — pick a model (buttons)',
  '/model <provider/model> — switch by name',
  '/help — show this help',
  'Anything else is sent to the agent.',
].join('\n')

/** Callback-data prefixes for the two-level `/model` picker. */
const MODEL_PICK_PREFIX = 'model:'
const MODEL_PROVIDER_PREFIX = 'modelp:'
const MODEL_PAGE_PREFIX = 'modelpage:'

/**
 * Models per page in the provider submenu; one route per row plus Back/Next
 * keeps the keyboard inside one phone screen.
 */
const MODEL_MENU_PAGE = 8

/**
 * True when `/new` or `/reset` asks for a fresh conversation. Both exist for
 * muscle memory; they mean the same thing here.
 * @param text - Trimmed inbound text.
 * @returns True for either reset command spelling.
 */
export function isResetCommand(text: string): boolean {
  return text === '/new' || text === '/reset'
}

interface ChatState {
  generation: number
  chain: Promise<void>
  agent: RelayAgent | undefined
  /** Per-chat model override; `undefined` follows the deployment default. */
  selection: { provider: string; model: string } | undefined
}

/** Composition hooks supplied by the Cordis wrapper at construction. */
export interface RelayOptions {
  /** Invoked per created session so callers can join preset rosters. */
  setupFactory?: (() => ((agentCtx: Context) => Promise<void>) | undefined) | undefined
  /** Recorded on gateway-created sessions when a default composition exists. */
  presetId?: string | undefined
  /** Draft-edit cadence in milliseconds; tests shrink it. */
  streamIntervalMs?: number | undefined
}

/** The relayed reply: folded text plus the turn's end reason, if observed. */
export interface ReplyOutcome {
  text: string
  reason: TurnEndReason | undefined
}

/**
 * Extract the last committed non-empty assistant text at or after `seq`.
 * @param events - The session's full event log.
 * @param seq - Snapshot seq taken before the turn was submitted.
 * @returns The reply text (possibly empty) and the observed end reason.
 */
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
  /** Senders already told they're not allowlisted; one notice each, not a spam loop. */
  private readonly deniedNotified = new Set<string>()

  constructor(
    private readonly options: RelayOptions,
    private readonly services: RelayServices,
    private readonly config: RelayConfig,
    private readonly io: {
      send(chatId: InboundMessage['chatId'], text: string): Promise<{ messageId: number }>
      /** Send with an inline keyboard (the `/model` picker). */
      sendKeyboard(chatId: InboundMessage['chatId'], text: string, keyboard: readonly { label: string; callbackData: string }[][]): Promise<{ messageId: number }>
      edit(chatId: InboundMessage['chatId'], messageId: number, text: string): Promise<void>
      /**
       * Rewrite a keyboard message's text and markup in place (picker paging,
       * collapse-on-pick). An empty keyboard removes the buttons.
       */
      editMessage(chatId: InboundMessage['chatId'], messageId: number, text: string, keyboard: readonly { label: string; callbackData: string }[][]): Promise<void>
      /** Acknowledge a press so Telegram stops the client-side spinner. */
      answerCallback(callbackId: string, toast?: string): Promise<void>
      typing(chatId: InboundMessage['chatId']): Promise<void>
      logger?: { info(message: string): void; warn(message: string): void; error(message: string): void }
    },
  ) {}

  /**
   * Forget the chat's current session so the next message starts fresh.
   * @param message - The inbound message identifying the chat to reset.
   */
  resetChat(message: InboundMessage): void {
    const state = this.chatState(message)
    state.generation += 1
    state.agent = undefined
  }

  /**
   * Route one authorized, addressed inbound message: commands answer
   * immediately; anything else queues behind the chat's previous turn and
   * relays the final assistant text.
   * @param message - The normalized inbound message to route.
   * @returns Resolves when the reply (or rejection) is fully delivered.
   */
  async handle(message: InboundMessage): Promise<void> {
    if (!this.isAllowed(message)) {
      // Deny-by-default stays, but silence strands a new owner mid-setup: the
      // one reply names their id so allowlisting themselves is self-service.
      this.io.logger?.warn(`telegram: rejected message from non-allowed user ${message.senderId}`)
      if (!this.deniedNotified.has(message.senderId)) {
        this.deniedNotified.add(message.senderId)
        await this.io.send(message.chatId, [
          'You are not on this bot\'s allowlist yet.',
          `Your Telegram id is ${message.senderId} — add it to the channel's allowedUserIds config and restart.`,
        ].join('\n'))
      }
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
    if (message.text === '/model' || message.text.startsWith('/model ')) {
      await this.handleModelCommand(message)
      return
    }
    const state = this.chatState(message)
    const previous = state.chain
    const run = previous.catch(() => {}).then(() => this.runTurn(message, state))
    state.chain = run
    await run
  }

  /**
   * Route one authorized inline-keyboard press. The picker is two-level,
   * hermes-style: `modelp:<provider>` opens that provider's model list (paged
   * with ‹ Back / Next ▶), `modelpage:<provider>/<n>` flips pages, and
   * `model:<provider>/<model>` commits the switch and collapses the menu.
   * @param query - The normalized callback query from the poller.
   */
  async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    if (!query.fromId || !this.config.allowedUserIds.includes(query.fromId)) {
      this.io.logger?.warn(`telegram: rejected callback from non-allowed user ${query.fromId}`)
      await this.io.answerCallback(query.callbackId).catch(() => {})
      return
    }
    try {
      if (query.data === 'modelroot:') {
        await this.showProviderRoot(query)
        return
      }
      if (query.data.startsWith(MODEL_PROVIDER_PREFIX) || query.data.startsWith(MODEL_PAGE_PREFIX)) {
        const provider = query.data.slice(
          query.data.startsWith(MODEL_PROVIDER_PREFIX) ? MODEL_PROVIDER_PREFIX.length : MODEL_PAGE_PREFIX.length,
        ).split('/')[0] ?? ''
        const page = query.data.startsWith(MODEL_PAGE_PREFIX)
          ? Number.parseInt(query.data.slice(MODEL_PAGE_PREFIX.length).split('/')[1] ?? '0', 10) || 0
          : 0
        await this.showModelPage(query, provider, page)
        return
      }
      if (query.data.startsWith(MODEL_PICK_PREFIX)) {
        const route = query.data.slice(MODEL_PICK_PREFIX.length)
        const slash = route.indexOf('/')
        if (slash <= 0 || slash === route.length - 1) {
          await this.io.answerCallback(query.callbackId, 'Malformed model pick').catch(() => {})
          return
        }
        const resolved = await this.services.resolveSelection(route.slice(0, slash), route.slice(slash + 1))
        const state = this.chatStateOf(query.chatId, query.threadId)
        state.selection = resolved
        const live = state.agent
        if (live !== undefined && live.selectionRef !== undefined) live.selectionRef.current = { ...resolved }
        // Collapse the menu into a receipt; the keyboard disappears.
        await this.io.editMessage(query.chatId, query.messageId, `Model set to ${resolved.provider}/${resolved.model}.`, [])
        await this.io.answerCallback(query.callbackId).catch(() => {})
        return
      }
      await this.io.answerCallback(query.callbackId).catch(() => {})
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await this.io.answerCallback(query.callbackId, `Switch failed: ${reason}`).catch(() => {})
    }
  }

  /** Render the provider level of the picker into the keyboard message. */
  private async showProviderRoot(query: TelegramCallbackQuery): Promise<void> {
    const routes = await this.services.listModels()
    const fallback = this.services.defaultSelection()
    const state = this.chatStateOf(query.chatId, query.threadId)
    const currentText = state.selection === undefined
      ? `${fallback.provider}/${fallback.model}`
      : `${state.selection.provider}/${state.selection.model}`
    const currentProvider = currentText.split('/')[0] ?? ''
    const providers = [...new Set(routes.map(route => route.provider))].sort()
    const keyboard = providers.slice(0, 12).map((provider) => {
      const count = routes.filter(route => route.provider === provider).length
      const mark = provider === currentProvider ? '✓ ' : ''
      return [{ label: `${mark}${provider} (${count})`, callbackData: `${MODEL_PROVIDER_PREFIX}${provider}` }]
    })
    await this.io.editMessage(query.chatId, query.messageId, `Current model: ${currentText}\n\nPick a provider:`, keyboard)
    await this.io.answerCallback(query.callbackId).catch(() => {})
  }

  /** Render one page of one provider's models into the keyboard message. */
  private async showModelPage(query: TelegramCallbackQuery, provider: string, page: number): Promise<void> {
    const routes = (await this.services.listModels()).filter(route => route.provider === provider)
    const pageCount = Math.max(1, Math.ceil(routes.length / MODEL_MENU_PAGE))
    const safePage = Math.min(Math.max(page, 0), pageCount - 1)
    const slice = routes.slice(safePage * MODEL_MENU_PAGE, (safePage + 1) * MODEL_MENU_PAGE)
    const fallback = this.services.defaultSelection()
    const state = this.chatStateOf(query.chatId, query.threadId)
    const currentText = state.selection === undefined
      ? `${fallback.provider}/${fallback.model}`
      : `${state.selection.provider}/${state.selection.model}`
    const keyboard = slice
      .map((route) => {
        const data = `${MODEL_PICK_PREFIX}${route.provider}/${route.model}`
        // Telegram caps callback data at 64 bytes; oversized routes are typed.
        if (data.length > 64) return undefined
        const mark = `${route.provider}/${route.model}` === currentText ? '✓ ' : ''
        return [{ label: `${mark}${route.model}`, callbackData: data }]
      })
      .filter(row => row !== undefined)
    const nav: { label: string; callbackData: string }[] = []
    if (safePage > 0) nav.push({ label: '‹ Back', callbackData: `${MODEL_PAGE_PREFIX}${provider}/${safePage - 1}` })
    nav.push({ label: '↩ Providers', callbackData: 'modelroot:' })
    if (safePage < pageCount - 1) nav.push({ label: 'Next ›', callbackData: `${MODEL_PAGE_PREFIX}${provider}/${safePage + 1}` })
    keyboard.push(nav)
    const header = `${provider} — page ${safePage + 1}/${pageCount} (${routes.length} models)\nCurrent: ${currentText}`
    await this.io.editMessage(query.chatId, query.messageId, header, keyboard)
    await this.io.answerCallback(query.callbackId).catch(() => {})
  }

  private chatStateOf(chatId: InboundMessage['chatId'], threadId: number | undefined): ChatState {
    return this.chatState({
      text: '', chatId, chatType: 'private', chatTitle: undefined,
      senderId: '0', senderName: 'telegram', threadId, messageId: 0,
    })
  }

  /**
   * `/model` — show the chat's current model; `/model <provider/model>` —
   * validate the route through the LLM seam, then apply it to this chat's
   * live agent (and every future one until `/new` or another switch).
   * @param message - The `/model` command message.
   */
  private async handleModelCommand(message: InboundMessage): Promise<void> {
    const arg = message.text.slice('/model'.length).trim()
    if (arg.length === 0) {
      const state = this.chatState(message)
      const fallback = this.services.defaultSelection()
      const currentText = state.selection === undefined
        ? `${fallback.provider}/${fallback.model}`
        : `${state.selection.provider}/${state.selection.model}`
      let routes: readonly { provider: string; model: string; name: string }[] = []
      try {
        routes = await this.services.listModels()
      } catch {
        // Fall through: a listing failure still shows the current route.
      }
      // Hermes-style two-level picker: level one is providers only, so the
      // keyboard stays small even with many models.
      const currentProvider = currentText.split('/')[0] ?? ''
      const providers = [...new Set(routes.map(route => route.provider))].sort()
      const keyboard = providers.slice(0, 12).map((provider) => {
        const count = routes.filter(route => route.provider === provider).length
        const mark = provider === currentProvider ? '✓ ' : ''
        return [{ label: `${mark}${provider} (${count})`, callbackData: `${MODEL_PROVIDER_PREFIX}${provider}` }]
      })
      if (keyboard.length === 0) {
        await this.io.send(message.chatId, `Current model: ${currentText}\n\nNo models listed — type /model <provider/model>.`)
        return
      }
      await this.io.sendKeyboard(message.chatId, `Current model: ${currentText}\n\nPick a provider:`, keyboard)
      return
    }
    // Hermes-style resolution: full "provider/model" switches directly; a bare
    // name fuzzy-matches model ids/names (e.g. `/model flash` → the one route
    // whose id contains "flash"). Zero or many matches list the candidates.
    let provider: string
    let model: string
    if (arg.includes('/')) {
      const slash = arg.indexOf('/')
      provider = arg.slice(0, slash).trim()
      model = arg.slice(slash + 1).trim()
      if (provider.length === 0 || model.length === 0) {
        await this.io.send(message.chatId, 'Use `/model <provider/model>` — e.g. `/model opencode-go/deepseek-v4-flash` — or a bare name like `/model flash`.')
        return
      }
    } else {
      const needle = arg.toLowerCase()
      const matches = (await this.services.listModels())
        .filter(m => m.model.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
      if (matches.length === 0) {
        await this.io.send(message.chatId, `No model matches "${arg}". Send /model to list available models.`)
        return
      }
      if (matches.length > 1) {
        await this.io.send(message.chatId, `"${arg}" is ambiguous:\n${matches.slice(0, 10).map(m => `• ${m.provider}/${m.model}`).join('\n')}`)
        return
      }
      const picked = matches.at(0)
      if (picked === undefined) return
      provider = picked.provider
      model = picked.model
    }
    try {
      const resolved = await this.services.resolveSelection(provider, model)
      const state = this.chatState(message)
      state.selection = resolved
      const live = state.agent
      if (live !== undefined && live.selectionRef !== undefined) live.selectionRef.current = { ...resolved }
      await this.io.send(message.chatId, `Model set to ${resolved.provider}/${resolved.model}.`)
    } catch (error) {
      await this.io.send(message.chatId, `Model switch failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async runTurn(message: InboundMessage, state: ChatState): Promise<void> {
    const agent = await this.ensureAgent(message, state)
    // Snapshot before submitting: everything at or after this seq is ours.
    const firstSeq = agent.session.seq
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: message.text }],
      source: { kind: 'user' },
    }))

    // Draft streaming: one placeholder message edited in place on a throttle,
    // mirroring hermes' draft frames. The final fold below is authoritative;
    // edits are best-effort and never fail the turn.
    let draftId: number | undefined
    let draftText = ''
    const sendDraft = async (text: string): Promise<void> => {
      const body = text.trim()
      if (body.length === 0 || body === draftText) return
      try {
        if (draftId === undefined) {
          const sent = await this.io.send(message.chatId, body)
          draftId = sent.messageId
        } else {
          await this.io.edit(message.chatId, draftId, body)
        }
        draftText = body
      } catch {
        // A rejected edit keeps the draft bubble: "message is not modified"
        // (identical text) and transient rate limits must not reset draftId,
        // or the next tick would send a duplicate bubble instead of editing.
      }
    }

    const typingTick = (): void => {
      void this.io.typing(message.chatId).catch(() => {})
    }
    typingTick()
    const typing = setInterval(typingTick, 4_000)
    const streamTimer = setInterval(() => {
      const { text } = assistantTextSince(agent.session.events, firstSeq)
      if (text.length > 0) void sendDraft(text)
    }, this.options.streamIntervalMs ?? STREAM_EDIT_INTERVAL_MS)
    try {
      await agent.whenIdle()
    } finally {
      clearInterval(typing)
      clearInterval(streamTimer)
    }

    const outcome = assistantTextSince(agent.session.events, firstSeq)
    await this.services.flushSession(agent.session)
    const suffix = outcome.reason !== undefined && outcome.reason.kind !== 'completed'
      ? `\n\n_(turn ended: ${outcome.reason.kind})_`
      : ''
    const finalText = `${outcome.text}${suffix}`.trim() || '(empty reply)'
    if (draftId !== undefined) {
      await this.io.edit(message.chatId, draftId, finalText).catch(() =>
        this.io.send(message.chatId, finalText))
    } else {
      await this.io.send(message.chatId, finalText)
    }
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
      meta: {
        cwd: this.config.cwd,
        ...(this.options.presetId === undefined ? {} : { agentPreset: this.options.presetId }),
        origin: 'telegram',
      },
      selection: state.selection,
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
      state = { generation: 0, chain: Promise.resolve(), agent: undefined, selection: undefined }
      this.chats.set(key, state)
    }
    return state
  }
}
