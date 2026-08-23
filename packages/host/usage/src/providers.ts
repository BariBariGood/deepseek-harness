/** Provider usage endpoints, response parsers, and their fetch wrappers. */

import type { UsageWindow } from './types.ts'

/** OpenRouter billing endpoint returning the account's credit totals. */
export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits'

/** OpenCode Go endpoint returning the plan's rate-limit windows. */
export const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

/**
 * Read one OpenCode Go usage field. Windows arrive independently, so a window
 * the API omits (or reports without a finite percent) stays absent instead of
 * failing the report.
 */
const OPENCODE_GO_WINDOWS = [
  ['rolling', '5h'],
  ['weekly', 'weekly'],
  ['monthly', 'monthly'],
] as const satisfies readonly (readonly [api: string, id: UsageWindow['window']])[]

/**
 * Render any thrown value as a display-safe message (never request headers).
 * @param error - Any thrown value.
 * @returns The Error message, or the string form of a non-Error throw.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error('provider response was not JSON')
  }
}

function expectObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error(`${what} was not an object`)
  return value as Record<string, unknown>
}

function expectFiniteNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${what} was not a finite number`)
  return value
}

/**
 * Parse an OpenRouter `/credits` payload (`{ data: { total_credits, total_usage } }`).
 * @param payload - Parsed JSON body of the credits response.
 * @returns Credit totals in US dollars.
 */
export function parseOpenRouterCredits(payload: unknown): { totalCredits: number; totalUsage: number } {
  const data = expectObject(expectObject(payload, 'credits payload').data, 'credits data')
  return {
    totalCredits: expectFiniteNumber(data.total_credits, 'total_credits'),
    totalUsage: expectFiniteNumber(data.total_usage, 'total_usage'),
  }
}

/**
 * Parse an OpenCode Go `/usage` payload into the windows it actually reports.
 * @param payload - Parsed JSON body of the usage response.
 * @returns Present windows in fixed `5h`, `weekly`, `monthly` order.
 */
export function parseOpenCodeGoUsage(payload: unknown): UsageWindow[] {
  const usage = expectObject(expectObject(payload, 'usage payload').usage, 'usage object')
  const windows: UsageWindow[] = []
  for (const [apiName, window] of OPENCODE_GO_WINDOWS) {
    const reported = usage[apiName]
    if (typeof reported !== 'object' || reported === null) continue
    const record = reported as Record<string, unknown>
    if (typeof record.percent !== 'number' || !Number.isFinite(record.percent)) continue
    windows.push({
      window,
      usedPercent: record.percent,
      resetAt: typeof record.resetsAt === 'string' ? record.resetsAt : null,
    })
  }
  return windows
}

/** Transport of the provider calls; production passes Node's global `fetch`. */
export type FetchImpl = (url: string, init: {
  headers: Record<string, string>
  signal: AbortSignal
}) => Promise<Response>

async function bearerJson(
  fetchImpl: FetchImpl,
  url: string,
  key: string,
  timeoutMs: number,
  what: string,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new Error(`${what} request failed: ${errorMessage(error)}`)
  }
  if (!response.ok) throw new Error(`${what} responded HTTP ${response.status}`)
  return readJson(response)
}

/**
 * Fetch the OpenRouter credit totals.
 * @param key - OpenRouter API key sent as the bearer credential.
 * @param timeoutMs - Abort the request after this many milliseconds.
 * @param fetchImpl - HTTP transport; the caller binds the global `fetch`.
 * @returns Credit totals in US dollars.
 */
export async function fetchOpenRouterCredits(
  key: string,
  timeoutMs: number,
  fetchImpl: FetchImpl,
): Promise<{ totalCredits: number; totalUsage: number }> {
  return parseOpenRouterCredits(
    await bearerJson(fetchImpl, OPENROUTER_CREDITS_URL, key, timeoutMs, 'OpenRouter credits'),
  )
}

/**
 * Fetch the OpenCode Go rate-limit windows.
 * @param key - OpenCode Go API key sent as the bearer credential.
 * @param timeoutMs - Abort the request after this many milliseconds.
 * @param fetchImpl - HTTP transport; the caller binds the global `fetch`.
 * @returns Present windows in fixed order.
 */
export async function fetchOpenCodeGoUsage(
  key: string,
  timeoutMs: number,
  fetchImpl: FetchImpl,
): Promise<UsageWindow[]> {
  return parseOpenCodeGoUsage(
    await bearerJson(fetchImpl, OPENCODE_GO_USAGE_URL, key, timeoutMs, 'OpenCode Go usage'),
  )
}
