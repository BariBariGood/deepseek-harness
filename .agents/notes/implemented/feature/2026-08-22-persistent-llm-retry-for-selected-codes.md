# Agent Note: persistent LLM retry for selected failure codes

Status: implemented

English | [中文](2026-08-22-persistent-llm-retry-for-selected-codes.zh.md)

## Problem

Every provider route carries a bounded retry policy executed by `dsh-llm-retry` on `agent/request-error` (see [bounded LLM request recovery](../architecture/2026-06-21-bounded-llm-request-recovery.md)). A provider whose eligible failure — most commonly `EMPTY_RESPONSE`, the adapters' classification of a degenerate completed response with no content — persists beyond that budget ends the step in a terminal error. `mode: 'always'` retries without limit but is code-blind: it also retries permanent failures such as `AUTH` forever. Deployments pinning flaky-but-free routes wanted unbounded persistence for transient-like codes only, with no budget and no model fallback.

## Decision

Ship `@deepseek-ai/dsh-llm-persist`, a function plugin registered after `dsh-llm-retry` on the same `agent/request-error` waterfall. The bounded policy always acts first; only when it delegates or exhausts does the plugin take over for its configured `providers` and `codes`, retrying the same provider/model request with capped exponential backoff and symmetric jitter until success, turn abort, or plugin disposal. It never switches provider or model.

Configuration lives in a hot-reloaded `llm-persist:` user-settings section: `providers` (default empty — the plugin is inert until configured), `codes` (default `[EMPTY_RESPONSE]`), and `backoff` (defaults 2000 ms initial, 30000 ms maximum, 0.2 jitter). Each scheduled wait appends the non-surface durable `llm/persist` event (shared `retryId`, provider, code, canonical config key, failure, delay) and, on completion, `llm/persist-started`; cancellation during backoff writes no started event. The payload type is browser-safe via the package's `./types` subpath, and the package's `./invariant` companion validates turn/step placement, chain numbering, `retryId` preservation, started-pairing, and delay bounds. A valid `providerRetryAfterMs` at or below `maxDelayMs` replaces local backoff; an over-cap provider delay falls back to local backoff so persistence cannot terminate on that instruction.

## Consequences

- The plugin joins the base bundle after `dsh-llm-retry`; registration order is the composition contract between the bounded phase and the unbounded phase.
- Persistence is unbounded by design: a provider that fails an eligible code forever keeps the step open until the turn is cancelled. Deployments pinning an unreliable route own that latency and cost tradeoff; the bounded phase absorbs ordinary transient streaks first.
- Two new durable event types enter the session vocabulary (`llm/persist`, `llm/persist-started`), regenerated into `known-event-types.ts` and the persistence catalog; every product build knows them because the plugin ships in the base bundle.
- A code removed from `codes` starts a new retry chain (the canonical config key includes the sorted codes); reordering codes does not.

## Alternatives considered

- **Use `mode: 'always'` on the provider's retryPolicy** — rejected: it retries every model-request failure, so authentication, quota, and invalid-request failures would retry without limit alongside transient empties.
- **Extend `dsh-llm-retry` with a code-scoped always variant** — rejected: it would widen a shipped package's policy vocabulary and its per-provider config surface for a consumer that the separate plugin can serve without touching the bounded executor.
- **Fall back to a different model after exhausting retries** — rejected: switching models silently changes the surface the operator pinned; persistence keeps the pinned request alive instead, and the operator can cancel the turn when the provider is truly dead.
- **Retry inside the adapter (pi-ai's `retryProviderRequest`)** — rejected: that layer only retries thrown transport errors; a successful HTTP response that carries no content reaches the harness as a completed response, which only the loop-level recovery extension point can classify.
