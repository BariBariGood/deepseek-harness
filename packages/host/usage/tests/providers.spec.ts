import { describe, expect, it, vi } from 'vitest'
import {
  errorMessage,
  fetchOpenCodeGoUsage,
  fetchOpenRouterCredits,
  parseOpenCodeGoUsage,
  parseOpenRouterCredits,
} from '../src/providers.ts'
import type { FetchImpl } from '../src/providers.ts'
import type { CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import UsageGateway from '../src/index.ts'

const okResponse = (body: unknown): Response => new Response(JSON.stringify(body))

describe('parseOpenRouterCredits', () => {
  it('reads the credit totals out of the data object', () => {
    expect(parseOpenRouterCredits({ data: { total_credits: 10, total_usage: 2.5 } }))
      .toEqual({ totalCredits: 10, totalUsage: 2.5 })
  })

  it('rejects payloads without a data object or with non-finite totals', () => {
    expect(() => parseOpenRouterCredits(null)).toThrowError()
    expect(() => parseOpenRouterCredits({})).toThrowError(/data/)
    expect(() => parseOpenRouterCredits({ data: { total_credits: '10', total_usage: 0 } })).toThrowError(/total_credits/)
    expect(() => parseOpenRouterCredits({ data: { total_credits: Number.NaN, total_usage: 0 } })).toThrowError(/total_credits/)
  })
})

describe('parseOpenCodeGoUsage', () => {
  it('maps rolling to 5h and keeps weekly and monthly', () => {
    const windows = parseOpenCodeGoUsage({
      usage: {
        rolling: { percent: 25, resetsAt: '2026-08-12T12:00:00.000Z' },
        weekly: { percent: 40, resetsAt: '2026-08-19T12:00:00.000Z' },
        monthly: { percent: 60.25 },
      },
    })
    expect(windows).toEqual([
      { window: '5h', usedPercent: 25, resetAt: '2026-08-12T12:00:00.000Z' },
      { window: 'weekly', usedPercent: 40, resetAt: '2026-08-19T12:00:00.000Z' },
      { window: 'monthly', usedPercent: 60.25, resetAt: null },
    ])
  })

  it('skips absent or malformed windows instead of failing the report', () => {
    const windows = parseOpenCodeGoUsage({
      usage: { rolling: { percent: Number.NaN }, weekly: 'bogus', monthly: { percent: 1 } },
    })
    expect(windows).toEqual([{ window: 'monthly', usedPercent: 1, resetAt: null }])
  })

  it('rejects payloads whose usage object is missing', () => {
    expect(() => parseOpenCodeGoUsage({})).toThrowError(/usage/)
    expect(() => parseOpenCodeGoUsage(undefined)).toThrowError()
  })
})

describe('errorMessage', () => {
  it('stringifies thrown non-Error values', () => {
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })
})

describe('provider fetch wrappers', () => {
  it('sends the bearer credential and parses an ok response', async () => {
    const requested: { url: string; authorization?: string | null }[] = []
    const fetchImpl: FetchImpl = async (url, init) => {
      requested.push({ url, authorization: new Headers(init.headers).get('authorization') })
      return okResponse({ data: { total_credits: 20, total_usage: 5 } })
    }
    await expect(fetchOpenRouterCredits('key-value', 1000, fetchImpl)).resolves
      .toEqual({ totalCredits: 20, totalUsage: 5 })
    expect(requested[0]?.authorization).toBe('Bearer key-value')
  })

  it('reports HTTP status failures without echoing the body', async () => {
    const fetchImpl: FetchImpl = async () =>
      new Response('{"error":"bad key"}', { status: 401 })
    await expect(fetchOpenRouterCredits('key-value', 1000, fetchImpl))
      .rejects.toThrowError(/HTTP 401/)
  })

  it('wraps transport failures from both providers', async () => {
    const fetchImpl: FetchImpl = async () => {
      throw new TypeError('network down')
    }
    await expect(fetchOpenRouterCredits('k', 1000, fetchImpl)).rejects.toThrowError(/network down/)
    await expect(fetchOpenCodeGoUsage('k', 1000, fetchImpl)).rejects.toThrowError(/network down/)
  })

  it('rejects non-JSON success bodies', async () => {
    const fetchImpl: FetchImpl = async () => new Response('<html></html>')
    await expect(fetchOpenCodeGoUsage('k', 1000, fetchImpl)).rejects.toThrowError(/not JSON/)
  })
})

describe('UsageGateway timeout resolution', () => {
  class AllKeys extends CredentialProvider {
    async resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> {
      return { value: 'test-key', source: 'test' }
    }
    async describe(): Promise<never> {
      throw new Error('unused')
    }
    async set(): Promise<void> {}
    async unset(): Promise<void> {}
    async readRecord(): Promise<never> {
      throw new Error('unused')
    }
    async describeRecord(): Promise<never> {
      throw new Error('unused')
    }
    async listRecords(): Promise<never> {
      throw new Error('unused')
    }
    async modifyRecord(): Promise<never> {
      throw new Error('unused')
    }
    async deleteRecord(): Promise<void> {}
  }

  it('resolves the schema default when constructed without config', async () => {
    const { Context } = await import('@deepseek-ai/cordis') as { Context: new () => Context }
    const signals: unknown[] = []
    vi.stubGlobal('fetch', (async (url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal)
      const body = String(url).includes('openrouter')
        ? { data: { total_credits: 1, total_usage: 0 } }
        : { usage: {} }
      return okResponse(body)
    }) as unknown as typeof fetch)

    const ctx = new Context()
    // The CredentialProvider base registers itself under `credentials`.
    new AllKeys(ctx)
    const gateway = new UsageGateway(ctx, {})
    const snapshot = await gateway.get()
    expect(snapshot.reports.every(report => report.code === 'ok')).toBe(true)
    expect(signals.length).toBe(2)
    vi.unstubAllGlobals()
  })
})
