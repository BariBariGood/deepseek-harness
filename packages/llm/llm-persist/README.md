# `@deepseek-ai/dsh-llm-persist`

English | [中文](README.zh.md)

Function plugin that keeps retrying a failed model request beyond the bounded provider policy, without ever switching provider or model. It registers after `dsh-llm-retry` on the agent loop's closed-step `agent/request-error` waterfall, so the bounded policy always acts first; only when that budget is exhausted (or absent) does this plugin take over for the providers and failure codes it is configured with.

Configuration is a `llm-persist:` user-settings section, hot-reloaded like every other settings namespace. An empty configuration (the default) is inert. `providers` names the routes that persist, `codes` the failure codes eligible for unbounded retries (default `[EMPTY_RESPONSE]`, the adapters' classification of a degenerate provider completion that produced no durable content), and `backoff` the capped exponential backoff with symmetric jitter (defaults 2000 ms initial, 30000 ms maximum, 0.2 jitter).

Each persisted attempt waits on bounded backoff, then retries the same provider/model request until it succeeds, the turn aborts, or the plugin disposes. A valid `providerRetryAfterMs` at or below `maxDelayMs` replaces local backoff without jitter; an over-cap provider delay falls back to local backoff so persistence cannot terminate on that instruction.

Before waiting, the plugin appends a non-surface `llm/persist` event with a shared `retryId`, provider, the failure code that entered persistence, the canonical resolved-config key, the failure, and the scheduled delay. Its payload is available from the browser-safe `@deepseek-ai/dsh-llm-persist/types` subpath. Retry numbers continue only across events with the same provider and complete config key. When the wait completes, the plugin appends `llm/persist-started` with the same `retryId`, turn, step, and retry number immediately before returning `{ kind: 'retry' }`; cancellation during backoff writes no started event. The loop then closes the failed turn and opens a retry turn over the same durable history. Cancellation and plugin disposal abort active backoff and drain active recovery before settling.

```yaml
- name: '@deepseek-ai/dsh-llm-persist'

llm-persist:
  providers: [zen-go]
  codes: [EMPTY_RESPONSE]
  backoff:
    initialDelayMs: 2000
    maxDelayMs: 30000
    jitterRatio: 0.2
```

The package's `./invariant` companion validates every `llm/persist` record against the open turn and step, checks retry-chain numbering and `retryId` preservation, requires each `llm/persist-started` to pair one prior scheduled attempt, and bounds every delay by the timer maximum.

## Model Experience

### Model-request persistence

#### What the model sees

No persist event, delay, provider error, or failed partial output is model-visible. The retry turn reconstructs the same explicit provider/model request from durable surface history; failed chunks never enter derived messages.

#### Token effect

Each persisted attempt is a new provider request and may repeat input-token billing with no fixed budget, bounded only by provider reliability and turn cancellation. `llm/persist` itself contributes no tokens.

#### KV Cache effect

The reconstructed request preserves the prior prefix and is eligible for provider cache reuse under that provider's rules. The non-surface persist event does not change cache identity.

## Known Limitations and Deferred Work

- **Persistence is unbounded by design** — a provider that fails an eligible code forever keeps the step open until the turn is cancelled; deployments pinning an unreliable route own that latency and cost tradeoff. `dsh-llm-retry`'s bounded phase runs first and absorbs transient streaks.
- **Agent turns are the only retry boundary** — direct `ctx.llm.stream()` consumers remain single-attempt, as with `dsh-llm-retry`.
- **The config key tracks behavior, not the code list's order** — eligible codes are sorted into the canonical key, so reordering them does not split a retry chain; adding or removing a code does.
- **`llm/persist` records scheduling, not completion** — later step and turn events establish success or cancellation.
