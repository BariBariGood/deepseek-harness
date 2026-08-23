# 提供商用量

[English](usage.md) | 中文

[`@deepseek-ai/dsh-host-usage`](../../packages/host/usage) 拥有面向 Web 用量面板的已连接提供商账单状态。`UsageGateway` 发布一个一元 Remote `usage/get`：每次调用都通过可选凭据接缝重新解析两个提供商的凭据引用，并行携带 Bearer 凭据请求 OpenRouter 额度与 OpenCode Go 窗口，并为每个提供商返回一份相互独立的报告。缺失的密钥读作 `unconfigured`，任何传输或解析失败都会成为该提供商携带可展示消息的 `error` 条目——二者都不会使端点失败，服务也不保留任何缓存或历史。

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

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
