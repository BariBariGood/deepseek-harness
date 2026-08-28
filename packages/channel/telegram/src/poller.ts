/** Resilient long-polling loop: offset tracking, backoff, conflict and stop handling. */

import { TelegramApiError, TelegramBotApiClient } from './bot-api.ts'
import { normalizeUpdate } from './inbound.ts'
import type { InboundMessage, TelegramCallbackQuery } from './types.ts'

/**
 * Consume updates forever until stopped.
 * @param options - Client, per-message handler, poll budget, backoff ceiling,
 * and the abort signal owned by the plugin's effect.
 * @returns Resolves when the signal aborts; rejects on an unrecoverable
 * conflict (another getUpdates consumer).
 *
 * Network failures back off exponentially; 429 responses honor Telegram's
 * retry-after; a 409 conflict (another consumer holds getUpdates) surfaces
 * instead of being retried away, mirroring hermes-agent's polling-conflict
 * handling. Each message is handed to `onMessage` in order before the offset
 * advances, so a thrown routing error stops the loop rather than silently
 * skipping the update.
 */
export async function pollMessages(options: {
  client: TelegramBotApiClient
  /** Invoked once per normalized text message, in arrival order. */
  onMessage: (message: InboundMessage) => Promise<void>
  /** Invoked once per inline-keyboard button press, in arrival order. */
  onCallback?: ((query: TelegramCallbackQuery) => Promise<void>) | undefined
  /** Invoked when one message's handler throws; the loop continues past it. */
  onMessageError?: ((message: InboundMessage, error: unknown) => void) | undefined
  /** Long-poll hang budget per request, in seconds. */
  pollTimeoutSeconds?: number | undefined
  /** Ceiling for the exponential reconnect backoff, in milliseconds. */
  maxBackoffMs?: number | undefined
  /** Resolved by `stop()` when the loop ends cleanly. */
  signal?: AbortSignal | undefined
}): Promise<void> {
  const pollTimeoutSeconds = options.pollTimeoutSeconds ?? 25
  const maxBackoffMs = options.maxBackoffMs ?? 30_000
  const signal = options.signal
  let offset = 0
  let backoffMs = 500

  const abortedNow = (): boolean => signal?.aborted === true
  for (;;) {
    if (abortedNow()) return
    let batch: Awaited<ReturnType<TelegramBotApiClient['getUpdates']>>
    try {
      batch = await options.client.getUpdates(offset, pollTimeoutSeconds, signal)
      backoffMs = 500
    } catch (error) {
      if (abortedNow() || (error instanceof TelegramApiError && error.code === 0 && isAbortBody(error))) return
      if (error instanceof TelegramApiError && error.conflict) throw error
      const waitMs = error instanceof TelegramApiError && error.retryAfterSeconds !== undefined
        ? error.retryAfterSeconds * 1000
        : backoffMs
      await sleep(waitMs, signal)
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs)
      continue
    }
    for (const update of batch) {
      // A non-finite update id would make the next getUpdates offset NaN (sent
      // as null = 0), re-fetching the whole queue forever. Skip and log loudly.
      if (!Number.isFinite(update.updateId)) {
        options.onMessageError?.(
          {
            text: '', chatId: '0', chatType: 'private', chatTitle: undefined,
            senderId: '0', senderName: 'telegram', threadId: undefined, messageId: 0,
          },
          new Error(`update with non-finite updateId: ${JSON.stringify(update).slice(0, 120)}`),
        )
        continue
      }
      offset = update.updateId + 1
      if (update.callbackQuery !== undefined) {
        try {
          await options.onCallback?.(update.callbackQuery)
        } catch (error) {
          // Same contract as onMessage: the offset has advanced, so a thrown
          // handler must not loop the press forever. Log and continue.
          options.onMessageError?.(
            {
              text: '', chatId: String(update.callbackQuery.chatId), chatType: 'private',
              chatTitle: undefined, senderId: update.callbackQuery.fromId,
              senderName: 'telegram', threadId: update.callbackQuery.threadId,
              messageId: update.callbackQuery.messageId,
            },
            error,
          )
        }
        continue
      }
      const message = normalizeUpdate(update)
      if (message === undefined) continue
      try {
        await options.onMessage(message)
      } catch (error) {
        // One bad message must not kill the loop: the offset is already
        // advanced past this update, so a thrown handler would otherwise be
        // retried forever (and re-answer an already-replied message after a
        // restart). Log and move on; the relay owns per-chat error replies.
        options.onMessageError?.(message, error)
      }
    }
  }
}

function isAbortBody(error: TelegramApiError): boolean {
  return /abort/i.test(error.message)
}

async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal?.aborted === true) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
