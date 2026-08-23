/** Resilient long-polling loop: offset tracking, backoff, conflict and stop handling. */

import { TelegramApiError, TelegramBotApiClient } from './bot-api.ts'
import { normalizeUpdate } from './inbound.ts'
import type { InboundMessage } from './types.ts'

/**
 * Consume updates forever until stopped. Network failures back off
 * exponentially; 429 responses honor Telegram's retry-after; a 409 conflict
 * (another consumer holds getUpdates) surfaces instead of being retried away,
 * mirroring hermes-agent's polling-conflict handling. Each message is handed
 * to `onMessage` in order before the offset advances, so a thrown routing
 * error stops the loop rather than silently skipping the update.
 */
export async function pollMessages(options: {
  client: TelegramBotApiClient
  /** Invoked once per normalized text message, in arrival order. */
  onMessage: (message: InboundMessage) => Promise<void>
  /** Long-poll hang budget per request, in seconds. */
  pollTimeoutSeconds?: number
  /** Ceiling for the exponential reconnect backoff, in milliseconds. */
  maxBackoffMs?: number
  /** Resolved by `stop()` when the loop ends cleanly. */
  signal?: AbortSignal
}): Promise<void> {
  const pollTimeoutSeconds = options.pollTimeoutSeconds ?? 25
  const maxBackoffMs = options.maxBackoffMs ?? 30_000
  const signal = options.signal
  let offset = 0
  let backoffMs = 500

  while (signal?.aborted !== true) {
    let batch: Awaited<ReturnType<TelegramBotApiClient['getUpdates']>>
    try {
      batch = await options.client.getUpdates(offset, pollTimeoutSeconds, signal)
      backoffMs = 500
    } catch (error) {
      if (signal?.aborted === true || (error instanceof TelegramApiError && error.code === 0 && isAbortBody(error))) return
      if (error instanceof TelegramApiError && error.conflict) throw error
      const waitMs = error instanceof TelegramApiError && error.retryAfterSeconds !== undefined
        ? error.retryAfterSeconds * 1000
        : backoffMs
      await sleep(waitMs, signal)
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs)
      continue
    }
    for (const update of batch) {
      offset = update.updateId + 1
      const message = normalizeUpdate(update)
      if (message === undefined) continue
      await options.onMessage(message)
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
