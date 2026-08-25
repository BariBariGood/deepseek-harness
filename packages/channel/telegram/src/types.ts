/** Wire vocabulary of the Telegram Bot API subset the channel uses. */

/**
 * A Bot API chat identifier exactly as the API accepts it: a numeric id
 * (`123456789` DM, `-1001234567890` supergroup) or an `@username` for public
 * channels. Numeric form stays number-typed so dict keys stringify stably;
 * mirroring hermes-agent's `telegram_ids.normalize_telegram_chat_id`.
 */
export type TelegramChatId = number | string

/** The chat a normalized update belongs to. */
export interface TelegramChat {
  /** Bot API chat id (numeric, or `@username` for public channels). */
  id: TelegramChatId
  /** `private`, `group`, `supergroup`, or `channel`. */
  type: 'private' | 'group' | 'supergroup' | 'channel'
  /** Display title for groups/channels; the DM partner's name for private chats. */
  title?: string | undefined
}

/** The Telegram user who authored an inbound message. */
export interface TelegramUser {
  id: number
  isBot: boolean
  firstName: string
  lastName?: string | undefined
  username?: string | undefined
}

/** A text message inside an update (media messages are out of scope for v1). */
export interface TelegramMessage {
  messageId: number
  date: number
  chat: TelegramChat
  from?: TelegramUser | undefined
  text?: string | undefined
  /** Forum-topic thread id when the message was posted inside a topic. */
  messageThreadId?: number | undefined
  /** The message being replied to, when present. */
  replyToMessage?: { messageId: number; text?: string | undefined } | undefined
}

/** One button in an inline keyboard; `callbackData` is 1-64 bytes. */
export interface TelegramInlineButton {
  label: string
  callbackData: string
}

/** A sent message carrying an inline keyboard, for later edit. */
export interface SentKeyboardMessage {
  messageId: number
}

/**
 * A pressed inline-keyboard button (`callback_query` update): who tapped,
 * where, which message shows the keyboard, and the opaque data payload.
 */
export interface TelegramCallbackQuery {
  callbackId: string
  fromId: string
  chatId: TelegramChatId
  /** Forum-topic thread id when the keyboard's message lives inside a topic. */
  threadId: number | undefined
  /** The keyboard-bearing message this press belongs to. */
  messageId: number
  data: string
}

/** One long-polling update; only `message` and `callback_query` matter. */
export interface TelegramUpdate {
  updateId: number
  message?: TelegramMessage | undefined
  callbackQuery?: TelegramCallbackQuery | undefined
}

/** Result envelope every Bot API JSON response shares. */
export interface TelegramApiResponse<T> {
  ok: boolean
  result?: T | undefined
  /** Human-readable error description when `ok` is false. */
  description?: string | undefined
  /** Retry-after seconds attached to 429 responses. */
  parameters?: { retry_after?: number | undefined } | undefined
  /** Bot API error code; absent on network-level failures. */
  errorCode?: number | undefined

  /** True when this failure is another getUpdates consumer conflicting (409). */
}

/** Normalized inbound message the gateway hands to session routing. */
export interface InboundMessage {
  /** Trimmed non-empty text; updates without one are dropped upstream. */
  text: string
  chatId: TelegramChatId
  chatType: TelegramChat['type']
  chatTitle: string | undefined
  senderId: string
  senderName: string
  /** Forum topic id when present; threads map to distinct sessions like hermes. */
  threadId: number | undefined
  messageId: number
}
