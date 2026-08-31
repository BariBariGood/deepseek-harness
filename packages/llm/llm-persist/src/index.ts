/**
 * Provider-pinned unbounded retry persistence for selected LLM failure codes.
 *
 * `dsh-llm-retry` executes each provider's bounded retry policy first; this
 * plugin registers after it on the same `agent/request-error` waterfall and,
 * for the providers and failure codes it is configured with, keeps retrying
 * the same request until it succeeds, the turn aborts, or the plugin disposes.
 * It never switches provider or model.
 *
 * @module @deepseek-ai/dsh-llm-persist
 */

import { randomUUID } from 'node:crypto'
import type { Context, Events } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { Agent, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import { EMPTY_RESPONSE_CODE } from '@deepseek-ai/dsh-llm'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { PersistId } from './brand.ts'
import type { LlmPersistEventData } from './types.ts'

export type { LlmPersistEventData, LlmPersistStartedEventData } from './types.ts'
export { PersistId } from './brand.ts'

export const name = 'llm-persist'
export const inject = ['agents']

const DEFAULT_CODES = Object.freeze([EMPTY_RESPONSE_CODE])
const DEFAULT_INITIAL_DELAY_MS = 2_000
const DEFAULT_MAX_DELAY_MS = 30_000
const DEFAULT_JITTER_RATIO = 0.2

/** Local exponential-backoff and jitter configuration for persisted retries. */
export interface BackoffConfig {
  /** Initial local exponential-backoff delay in milliseconds (default 2000). */
  initialDelayMs?: number
  /** Maximum locally scheduled or accepted provider delay in milliseconds (default 30000). */
  maxDelayMs?: number
  /** Symmetric random multiplier range around one (default 0.2). */
  jitterRatio?: number
}

/** Provider-pinned unbounded retry persistence configuration. */
export interface Config {
  /** Provider routes whose eligible failures persist beyond the bounded retry budget (default []). */
  providers?: string[]
  /** Failure codes eligible for persisted retries (default [EMPTY_RESPONSE]). */
  codes?: string[]
  /** Local exponential-backoff and jitter configuration. */
  backoff?: BackoffConfig
}

/** Runtime schema for {@link Config}; resolved live from the settings section. */
export const Config: z<Config> = z.object({
  providers: z.array(z.string()).default([]),
  codes: z.array(z.string()).default([...DEFAULT_CODES]),
  backoff: z.object({
    initialDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
    maxDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
    jitterRatio: z.number().min(0).max(1).default(DEFAULT_JITTER_RATIO),
  }).default({
    initialDelayMs: DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
    jitterRatio: DEFAULT_JITTER_RATIO,
  }),
})

/** Non-serializable hooks used to make timing policy deterministic in tests. */
export interface RetryInternals {
  /** Random sample in the inclusive zero-to-one range used for jitter. */
  random?: () => number
}

/** Fully resolved backoff shared by every persisted wait. */
export interface ResolvedBackoff {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly jitterRatio: number
}

const CONFIG_KEYS: ReadonlySet<string> = new Set(['providers', 'codes', 'backoff'])

function validateConfig(config: Config): void {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`llm-persist: unknown key "${key}"`)
  }
}

function resolved(config: Config): { providers: readonly string[]; codes: readonly string[]; backoff: ResolvedBackoff } {
  return {
    providers: config.providers ?? [],
    codes: config.codes ?? [...DEFAULT_CODES],
    backoff: {
      initialDelayMs: config.backoff?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
      maxDelayMs: config.backoff?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
      jitterRatio: config.backoff?.jitterRatio ?? DEFAULT_JITTER_RATIO,
    },
  }
}

function persistPolicyKey(codes: readonly string[], backoff: ResolvedBackoff): string {
  return JSON.stringify([
    [...codes].sort(),
    backoff.initialDelayMs,
    backoff.maxDelayMs,
    backoff.jitterRatio,
  ])
}

function localDelay(backoff: ResolvedBackoff, retry: number, random: () => number): number {
  const exponent = Math.min(retry - 1, 1024)
  const exponential = Math.min(backoff.initialDelayMs * 2 ** exponent, backoff.maxDelayMs)
  const jitter = 1 - backoff.jitterRatio + 2 * backoff.jitterRatio * random()
  return Math.min(exponential * jitter, backoff.maxDelayMs)
}

function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  /* v8 ignore next -- callers check the same fused signal synchronously before this call */
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    function onAbort(): void {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Install provider-pinned unbounded recovery behind the bounded retry policy.
 * @param ctx - plugin context that owns the listener and active waits.
 * @param config - providers, eligible codes, and backoff; a settings section
 *  under `llm-persist:` overrides it live.
 * @param internals - non-serializable deterministic hooks for tests.
 */
export function apply(ctx: Context, config: Config = {}, internals: RetryInternals = {}): void {
  validateConfig(config)
  const random = internals.random ?? Math.random
  let current: () => Config = () => config
  const lifetime = new AbortController()
  const active = new Set<Promise<RequestErrorAction>>()

  function track(operation: Promise<RequestErrorAction>): Promise<RequestErrorAction> {
    const tracked = operation.finally(() => active.delete(tracked))
    active.add(tracked)
    return tracked
  }

  async function backoff(
    agent: Agent,
    turn: number,
    step: number,
    failure: LlmFailure,
    provider: string,
    policyKey: string,
    retry: number,
    retryId: PersistId,
    delayMs: number,
    signal: AbortSignal,
  ): Promise<RequestErrorAction> {
    const fusedSignal = AbortSignal.any([signal, lifetime.signal])
    /* v8 ignore next -- recover rejected the same aborted state synchronously */
    if (fusedSignal.aborted) return
    const eventData: LlmPersistEventData = {
      retryId,
      turn,
      step,
      provider,
      code: failure.code,
      policyKey,
      retry,
      delayMs,
      failure,
    }
    agent.session.append('llm/persist', eventData)
    if (!await cancellableDelay(delayMs, fusedSignal)) return
    agent.session.append('llm/persist-started', { retryId, turn, step, retry })
    return { kind: 'retry' }
  }

  async function recover(
    { agent, turn, step, provider, failure, signal }: Parameters<Events['agent/request-error']>[0],
    next: () => Promise<RequestErrorAction>,
  ): Promise<RequestErrorAction> {
    const { providers, codes, backoff: backoffConfig } = resolved(current())
    if (!providers.includes(provider)) return next()
    if (!codes.includes(failure.code)) return next()
    // A waterfall may have captured this callback before its registration was
    // removed. Refuse recovery once the turn or the plugin lifetime aborted.
    /* v8 ignore next -- the listener guard above rejects a disposed plugin; a live turn dispatches only while its signal is open */
    if (signal.aborted || lifetime.signal.aborted) return
    const policyKey = persistPolicyKey(codes, backoffConfig)
    const priorPersist = agent.session.events.findLast((event): event is SessionEvent<'llm/persist'> =>
      event.type === 'llm/persist'
      && event.data.turn === turn
      && event.data.step === step
      && event.data.provider === provider
      && event.data.policyKey === policyKey,
    )
    const retry = (priorPersist?.data.retry ?? 0) + 1
    const retryId = priorPersist?.data.retryId ?? PersistId(randomUUID())
    let delayMs: number
    if (failure.providerRetryAfterMs !== undefined
      && Number.isFinite(failure.providerRetryAfterMs)
      && failure.providerRetryAfterMs > 0) {
      delayMs = failure.providerRetryAfterMs > backoffConfig.maxDelayMs
        ? localDelay(backoffConfig, retry, random)
        : failure.providerRetryAfterMs
    } else {
      delayMs = localDelay(backoffConfig, retry, random)
    }

    return backoff(agent, turn, step, failure, provider, policyKey, retry, retryId, delayMs, signal)
  }

  const disposeListener = ctx.on('agent/request-error', (
    payload,
    next: () => Promise<RequestErrorAction>,
  ) => {
    if (lifetime.signal.aborted) return Promise.resolve<RequestErrorAction>(undefined)
    return track(recover(payload, next))
  })

  ctx.effect(() => async () => {
    disposeListener()
    lifetime.abort(new Error('llm-persist plugin disposed'))
    await Promise.allSettled([...active])
  }, 'llm-persist: abort and drain active recovery')

  ctx.inject(['settings'], (sctx) => {
    sctx.settings.installSection(ctx, 'llm-persist', Config, config, {
      setSource: (source: () => Config) => {
        current = source
      },
      onChange: () => {},
    })
  })
}
