/** Minimal fetch-based Telegram Bot API client: long polling plus the send face the channel needs. */

import type {
  TelegramApiResponse, TelegramChatId, TelegramUpdate,
} from './types.ts'

/** The Bot API base URL; an external service spec, not a tunable. */
export const TELEGRAM_API_BASE = 'https://api.telegram.org'

/**
 * One failed Bot API call, carrying the API error code and retry-after hint
 * when Telegram supplied them. Messages never contain the bot token.
 */
export class TelegramApiError extends Error {
  constructor(
    /** Bot API `error_code`, or 0 for network/parse failures. */
    readonly code: number,
    message: string,
    /** Seconds Telegram asked the client to wait (429 responses). */
    readonly retryAfterSeconds: number | undefined,
    /** True for 409 conflicts: another consumer holds getUpdates. */
    readonly conflict: boolean,
  ) {
    super(message)
  }
}

function queryOf(token: string): string {
  return `${TELEGRAM_API_BASE}/bot${token}`
}

/**
 * Thin promise facade over the subset of the Bot API this channel uses.
 * Every call goes through one request point so timeouts, JSON envelopes, and
 * error normalization stay uniform; the transport itself is the caller-bound
 * global `fetch`.
 */
export class TelegramBotApiClient {
  constructor(
    private readonly token: string,
    /**
     * Abort one HTTP attempt after this many milliseconds. Long polls pass
     * their own per-call budget; sends use the constructor default.
     */
    private readonly defaultTimeoutMs = 15_000,
  ) {}

  /** Issue one Bot API call and unwrap its envelope. */
  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    timeoutMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<T> {
    const deadline = AbortSignal.timeout(timeoutMs ?? this.defaultTimeoutMs)
    let response: Response
    try {
      response = await fetch(`${queryOf(this.token)}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal === undefined ? deadline : AbortSignal.any([deadline, signal]),
      })
    } catch (error) {
      throw new TelegramApiError(0, `${method} transport failure: ${error instanceof Error ? error.message : String(error)}`, undefined, false)
    }
    let payload: TelegramApiResponse<T>
    try {
      payload = await response.json() as TelegramApiResponse<T>
    } catch {
      throw new TelegramApiError(response.status, `${method} returned non-JSON HTTP ${response.status}`, undefined, false)
    }
    if (!payload.ok || payload.result === undefined) {
      const description = payload.description ?? `HTTP ${response.status}`
      throw new TelegramApiError(
        payload.errorCode ?? response.status,
        `${method} failed: ${description}`,
        payload.parameters?.retry_after,
        payload.errorCode === 409 || response.status === 409,
      )
    }
    return payload.result
  }

  /**
   * Identity check used at connect time to fail fast on a bad token.
   * @param timeoutMs - Optional per-call timeout override in milliseconds.
   * @returns The bot's numeric id and `@`-less username.
   */
  async getMe(timeoutMs?: number): Promise<{ id: number; username: string }> {
    return this.call('getMe', {}, timeoutMs)
  }

  /**
   * Long-poll updates strictly after `offset`. Resolves with an empty array
   * when the poll budget elapses without traffic.
   * @param offset - Fetch updates with `update_id` strictly greater than this.
   * @param pollTimeoutSeconds - Server-side long-poll hang budget in seconds.
   * @param signal - Caller abort; a stop request ends the loop promptly.
   * @returns The accepted updates in ascending update-id order.
   */
  async getUpdates(
    offset: number,
    pollTimeoutSeconds: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    const raw = await this.call<Array<Record<string, unknown>>>('getUpdates', { offset, timeout: pollTimeoutSeconds, allowed_updates: ['message'] }, (pollTimeoutSeconds + 10) * 1000, signal)
    // The wire format is snake_case (`update_id`); the channel type is camelCase.
    // Without this mapping `updateId` reads undefined, the next offset becomes
    // NaN, and every poll re-fetches the whole queue — the reply-storm bug.
    return raw.map(update => ({
      ...update,
      // Real Telegram payloads are snake_case; camelCase keeps hand-built
      // fixtures and internal callers working unchanged.
      updateId: Number((update as { updateId?: number }).updateId ?? update.update_id),
    }))
  }

  /**
   * Drop a webhook if one is set; leftover webhooks make getUpdates 409.
   * @returns Resolves after the Bot API acknowledges the deletion.
   */
  async deleteWebhook(): Promise<void> {
    await this.call('deleteWebhook', { drop_pending_updates: false }, undefined)
  }

  /**
   * Send one plain-text message.
   * @param chatId - Destination chat (numeric or `@username`).
   * @param text - Message body; link previews are disabled.
   * @returns The platform message id of the sent message.
   */
  async sendMessage(chatId: TelegramChatId, text: string): Promise<{ messageId: number }> {
    const result = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: true },
    }, undefined)
    return { messageId: result.message_id }
  }

  /**
   * Replace the text of a previously sent message (draft streaming).
   * @param chatId - Destination chat (numeric or `@username`).
   * @param messageId - Platform message id returned by sendMessage.
   * @param text - The replacement body.
   * @returns Resolves when the edit is accepted.
   */
  async editMessageText(chatId: TelegramChatId, messageId: number, text: string): Promise<void> {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      link_preview_options: { is_disabled: true },
    }, undefined)
  }

  /**
   * Show a typing indicator; lasts ~5s server-side, so callers heartbeat it.
   * @param chatId - Destination chat (numeric or `@username`).
   * @param action - The chat action; only `typing` is used today.
   * @returns Resolves when the indicator is accepted.
   */
  async sendChatAction(chatId: TelegramChatId, action: 'typing'): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action }, undefined)
  }
}
