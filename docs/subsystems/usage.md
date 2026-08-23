# Provider Usage

English | [中文](usage.zh.md)

[`@deepseek-ai/dsh-host-usage`](../../packages/host/usage) owns connected-provider billing state for the web usage panel. `UsageGateway` publishes one unary Remote, `usage/get`: every call re-resolves both providers' credential refs through the optional credentials seam, fetches OpenRouter credits and OpenCode Go windows in parallel with a bearer credential, and returns one independent report per provider. A missing key reads as `unconfigured`, and any transport or parse failure becomes that provider's display-safe `error` entry — neither can fail the endpoint, and the service retains no cache or history.

Source: [`packages/host/usage/src/types.ts`](../../packages/host/usage/src/types.ts)

## Public types

```ts type-equiv
/** A provider whose usage the panel reports. */
type UsageProviderId = 'openrouter' | 'opencode-go'
```

```ts type-equiv
/** One rate-limit window of an OpenCode Go plan. */
interface UsageWindow {
  /** Window kind: `5h` is the rolling five-hour window. */
  window: '5h' | 'weekly' | 'monthly'
  /** Share of the window's allowance already used, in percent. */
  usedPercent: number
  /** ISO 8601 instant the window resets, or null when the API omits it. */
  resetAt: string | null
}
```

```ts type-equiv
/** One provider's report; `code` discriminates. Failure codes never carry secrets. */
type UsageReport =
  | { provider: 'openrouter'; code: 'ok'; totalCredits: number; totalUsage: number }
  | { provider: 'opencode-go'; code: 'ok'; windows: UsageWindow[] }
  | { provider: UsageProviderId; code: 'unconfigured' }
  | { provider: UsageProviderId; code: 'error'; message: string }
```

```ts type-equiv
/** The ok variants both provider reporters return on success. */
type UsageOkReport = Extract<UsageReport, { code: 'ok' }>
```

```ts type-equiv
/** Complete answer of the `usage/get` endpoint. */
interface UsageSnapshot {
  /** Host wall-clock time the snapshot was assembled (ISO 8601). */
  collectedAt: string
  /** One report per supported provider, always present. */
  reports: UsageReport[]
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxusage--usagegateway"></a>

### `ctx.usage` — `UsageGateway`

Serves the web usage panel over the `usage/get` endpoint. Every call re-resolves credentials and refetches both providers: billing state is read-only remote data the service never caches.

```ts cordis-catalog
/**
 * Fetch every supported provider once. Reports are independent: a missing
 * key or failed request degrades only its own entry, so one provider's
 * outage never blanks the panel.
 * @returns Current billing state of every supported provider.
 */
@Remote('get') async get(): Promise<UsageSnapshot>
```

Source: [`packages/host/usage/src/index.ts`](../../packages/host/usage/src/index.ts)
<!-- END GENERATED cordis-surface -->
