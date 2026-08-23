/** Normalize raw Telegram updates into the inbound messages the gateway routes. */

import type { InboundMessage, TelegramUpdate } from './types.ts'

/** The `/`-prefixed commands this channel answers itself, before agent dispatch. */
export const CHANNEL_COMMANDS = ['/new', '/reset', '/help'] as const

/**
 * Reduce one long-polling update to a routable inbound message.
 * @param update - A `message`-carrying update; others are dropped.
 * @returns The normalized message, or undefined for non-text, bot-authored,
 * or empty updates.
 */
export function normalizeUpdate(update: TelegramUpdate): InboundMessage | undefined {
  const message = update.message
  if (message === undefined || message.text === undefined) return undefined
  const author = message.from
  if (author !== undefined && author.isBot) return undefined
  const text = message.text.trim()
  if (text.length === 0) return undefined
  const senderName = author === undefined
    ? message.chat.title ?? 'unknown'
    : [author.firstName, author.lastName].filter(part => part !== undefined).join(' ')
  return {
    text,
    chatId: message.chat.id,
    chatType: message.chat.type,
    chatTitle: message.chat.title,
    senderId: String(author?.id ?? message.chat.id),
    senderName,
    threadId: message.messageThreadId,
    messageId: message.messageId,
  }
}

/**
 * Stable session-routing key for one chat, mirroring hermes-agent's
 * `build_session_key`: DMs key by chat alone, groups by chat plus topic so
 * forum threads map to distinct conversations.
 * @param message - A normalized inbound message.
 * @returns The channel-local key segment (no platform prefix).
 */
export function sessionKeyOf(message: InboundMessage): string {
  const base = typeof message.chatId === 'string' ? message.chatId : String(message.chatId)
  return message.threadId === undefined ? base : `${base}:${message.threadId}`
}

/**
 * Whether an inbound message targets the channel itself: any message in a
 * direct chat, and in groups only commands or explicit mentions of the bot.
 * Hermes calls this mention gating.
 * @param message - The normalized message.
 * @param botUsernames - Lowercased bot usernames without the leading `@`.
 */
export function isAddressedToChannel(message: InboundMessage, botUsernames: readonly string[]): boolean {
  if (message.chatType === 'private') return true
  const lowered = message.text.toLowerCase()
  if (lowered.startsWith('/')) return true
  return botUsernames.some(name => lowered.includes(`@${name}`))
}
