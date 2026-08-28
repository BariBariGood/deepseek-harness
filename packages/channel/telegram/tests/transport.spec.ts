import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramApiError, TelegramBotApiClient } from '../src/bot-api.ts'
import { isAddressedToChannel, normalizeUpdate, sessionKeyOf } from '../src/inbound.ts'
import { pollMessages } from '../src/poller.ts'
import type { InboundMessage, TelegramApiResponse, TelegramUpdate } from '../src/types.ts'

const TOKEN = '123456:TEST-TOKEN'

function apiResponse<T>(result: T): Response {
  return new Response(JSON.stringify({ ok: true, result }))
}

interface UpdateOverrides {
  updateId?: number
  text?: string
  chatId?: number | string
  chatType?: 'private' | 'supergroup'
  threadId?: number
  senderIsBot?: boolean
}

function makeUpdate(overrides: UpdateOverrides = {}): TelegramUpdate {
  const chatType = overrides.chatType ?? 'private'
  return {
    updateId: overrides.updateId ?? 7,
    message: {
      messageId: 42,
      date: 1_755_000_000,
      chat: {
        id: overrides.chatId ?? 100,
        type: chatType,
        ...(chatType === 'private' ? {} : { title: 'Ops' }),
      },
      from: { id: 555, isBot: overrides.senderIsBot ?? false, firstName: 'Ada' },
      text: overrides.text,
      ...(overrides.threadId === undefined ? {} : { messageThreadId: overrides.threadId }),
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TelegramBotApiClient', () => {
  it('posts JSON to the token-scoped method URL and unwraps the envelope', async () => {
    const calls: { url: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return apiResponse({ id: 42, username: 'dsh_bot' })
    }) as unknown as typeof fetch)

    const client = new TelegramBotApiClient(TOKEN)
    await expect(client.getMe()).resolves.toEqual({ id: 42, username: 'dsh_bot' })
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`)
  })

  it('normalizes failures into typed errors carrying code and retry-after', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 3 },
    }), { status: 429 })) as unknown as typeof fetch)

    const client = new TelegramBotApiClient(TOKEN)
    const failure = await client.sendMessage(1, 'hi').then(() => undefined, (error: unknown) => error)
    expect(failure).toBeInstanceOf(TelegramApiError)
    expect((failure as TelegramApiError).code).toBe(429)
    expect((failure as TelegramApiError).retryAfterSeconds).toBe(3)
  })

  it('marks 409 envelopes as conflicts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request',
    }), { status: 409 })) as unknown as typeof fetch)
    const client = new TelegramBotApiClient(TOKEN)
    await expect(client.getUpdates(0, 0)).rejects.toMatchObject({ conflict: true })
  })
})

describe('normalizeUpdate', () => {
  it('maps private-chat text messages with sender identity', () => {
    expect(normalizeUpdate(makeUpdate({ text: ' hello there ' }))).toEqual({
      text: 'hello there',
      chatId: 100,
      chatType: 'private',
      chatTitle: undefined,
      senderId: '555',
      senderName: 'Ada',
      threadId: undefined,
      messageId: 42,
    } satisfies InboundMessage)
  })

  it('drops bot-authored, non-text, and empty updates', () => {
    expect(normalizeUpdate(makeUpdate({ senderIsBot: true, text: 'echo' }))).toBeUndefined()
    expect(normalizeUpdate(makeUpdate())).toBeUndefined()
    expect(normalizeUpdate(makeUpdate({ text: '   ' }))).toBeUndefined()
    expect(normalizeUpdate({ updateId: 9 })).toBeUndefined()
  })
})

describe('sessionKeyOf', () => {
  it('keys direct chats by chat id and topics by chat plus thread', () => {
    expect(sessionKeyOf(normalizeUpdate(makeUpdate({ text: 'hi' }))!)).toBe('100')
    expect(sessionKeyOf(normalizeUpdate(
      makeUpdate({ text: 'hi', chatId: -100999, chatType: 'supergroup', threadId: 12 }),
    )!)).toBe('-100999:12')
    expect(sessionKeyOf(normalizeUpdate(makeUpdate({ text: 'x', chatId: '@chan', chatType: 'supergroup' }))!))
      .toBe('@chan')
  })
})

describe('isAddressedToChannel', () => {
  it('always answers direct chats', () => {
    expect(isAddressedToChannel(normalizeUpdate(makeUpdate({ text: 'plain' }))!, ['dsh_bot'])).toBe(true)
  })

  it('answers group commands and mentions, not chatter', () => {
    const group = (text: string): InboundMessage =>
      normalizeUpdate(makeUpdate({ text, chatId: -5, chatType: 'supergroup' }))!
    expect(isAddressedToChannel(group('/new'), ['dsh_bot'])).toBe(true)
    expect(isAddressedToChannel(group('hey @DSH_Bot run this'), ['dsh_bot'])).toBe(true)
    expect(isAddressedToChannel(group('ordinary chatter'), ['dsh_bot'])).toBe(false)
  })
})

describe('pollMessages', () => {
  function scriptedBatches(batches: TelegramApiResponse<TelegramUpdate[]>[]): {
    offsets: number[]
    run: (onMessage: (message: InboundMessage) => Promise<void>, signal?: AbortSignal) => Promise<void>
  } {
    let served = 0
    const offsets: number[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      offsets.push((JSON.parse(String(init?.body)) as { offset: number }).offset)
      const payload = batches[Math.min(served, batches.length - 1)] as TelegramApiResponse<TelegramUpdate[]>
      served += 1
      return new Response(JSON.stringify(payload))
    }) as unknown as typeof fetch)
    return {
      offsets,
      run: (onMessage, signal) => pollMessages({
        client: new TelegramBotApiClient(TOKEN),
        onMessage,
        signal,
        pollTimeoutSeconds: 0,
      }),
    }
  }

  it('delivers messages in order and advances the offset across batches', async () => {
    const seen: string[] = []
    const script = scriptedBatches([
      { ok: true, result: [makeUpdate({ updateId: 7, text: 'one' }), makeUpdate({ updateId: 8, text: '   ' })] },
      { ok: true, result: [makeUpdate({ updateId: 9, text: 'two' })] },
      { ok: true, result: [] },
    ])
    const controller = new AbortController()
    await script.run(async (message) => {
      seen.push(message.text)
      if (seen.length === 2) controller.abort()
    }, controller.signal)
    expect(seen).toEqual(['one', 'two'])
    expect(script.offsets).toEqual([0, 9])
  })

  it('retries 429 responses and recovers on a later poll', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls <= 2) {
        return new Response(JSON.stringify({
          ok: false, error_code: 429, description: 'slow down', parameters: { retry_after: 0 },
        }), { status: 429 })
      }
      return apiResponse([makeUpdate({ updateId: 7, text: 'recovered' })])
    }) as unknown as typeof fetch)

    const controller = new AbortController()
    await pollMessages({
      client: new TelegramBotApiClient(TOKEN),
      onMessage: async () => {
        controller.abort()
      },
      signal: controller.signal,
      pollTimeoutSeconds: 0,
    })
    expect(calls).toBe(3)
  })

  it('surfaces a getUpdates conflict instead of retrying it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false, error_code: 409, description: 'Conflict',
    }), { status: 409 })) as unknown as typeof fetch)
    await expect(pollMessages({
      client: new TelegramBotApiClient(TOKEN),
      onMessage: async () => {},
      pollTimeoutSeconds: 0,
    })).rejects.toMatchObject({ conflict: true })
  })

  it('returns cleanly when aborted mid-backoff', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network unreachable')
    }) as unknown as typeof fetch)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)
    await expect(pollMessages({
      client: new TelegramBotApiClient(TOKEN),
      onMessage: async () => {},
      signal: controller.signal,
      pollTimeoutSeconds: 0,
    })).resolves.toBeUndefined()
  })
})
