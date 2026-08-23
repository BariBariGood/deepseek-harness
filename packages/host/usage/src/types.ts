/** Wire vocabulary of the `usage` Remote: connected-provider billing state. */

/** A provider whose usage the panel reports. */
export type UsageProviderId = 'openrouter' | 'opencode-go'

/** One rate-limit window of an OpenCode Go plan. */
export interface UsageWindow {
  /** Window kind: `5h` is the rolling five-hour window. */
  window: '5h' | 'weekly' | 'monthly'
  /** Share of the window's allowance already used, in percent. */
  usedPercent: number
  /** ISO 8601 instant the window resets, or null when the API omits it. */
  resetAt: string | null
}

/** One provider's report; `code` discriminates. Failure codes never carry secrets. */
export type UsageReport =
  | { provider: 'openrouter'; code: 'ok'; totalCredits: number; totalUsage: number }
  | { provider: 'opencode-go'; code: 'ok'; windows: UsageWindow[] }
  | { provider: UsageProviderId; code: 'unconfigured' }
  | { provider: UsageProviderId; code: 'error'; message: string }

/** The ok variants both provider reporters return on success. */
export type UsageOkReport = Extract<UsageReport, { code: 'ok' }>

/** Complete answer of the `usage/get` endpoint. */
export interface UsageSnapshot {
  /** Host wall-clock time the snapshot was assembled (ISO 8601). */
  collectedAt: string
  /** One report per supported provider, always present. */
  reports: UsageReport[]
}
