/** Package-owned durable persist-event invariants. @module @deepseek-ai/dsh-llm-persist/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-persist'

/** Cordis companion plugin name. */
export const name = 'llm-persist-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate the complete provider-neutral failure payload at the durable boundary. */
function validateFailure(value: unknown, fail: InvariantFailure): asserts value is LlmFailure {
  if (typeof value !== 'object' || value === null) {
    fail('llm/persist failure must be an object')
  }
  const failure = value as Partial<LlmFailure>
  if (typeof failure.message !== 'string' || failure.message.length === 0) {
    fail('llm/persist failure.message must be a non-empty string')
  }
  if (typeof failure.code !== 'string' || failure.code.length === 0) {
    fail('llm/persist failure.code must be a non-empty string')
  }
  if (failure.status !== undefined
    && (!Number.isInteger(failure.status) || failure.status < 100 || failure.status > 599)) {
    fail('llm/persist failure.status must be an integer from 100 through 599 when present')
  }
  if (failure.providerRetryAfterMs !== undefined
    && (!Number.isFinite(failure.providerRetryAfterMs) || failure.providerRetryAfterMs <= 0)) {
    fail('llm/persist failure.providerRetryAfterMs must be a positive finite number when present')
  }
  if (failure.requestId !== undefined
    && (typeof failure.requestId !== 'string' || failure.requestId.length === 0)) {
    fail('llm/persist failure.requestId must be a non-empty string when present')
  }
}

/** Validate one persist record against the currently open request step. */
function validatePersist(
  history: readonly SessionEvent[],
  event: SessionEvent<'llm/persist'>,
  fail: InvariantFailure,
): void {
  const { retryId, turn, step, provider, code, policyKey, retry, delayMs } = event.data
  if (typeof retryId !== 'string' || retryId.length === 0) {
    fail('llm/persist retryId must be a non-empty string')
  }
  const failure: unknown = event.data.failure
  validateFailure(failure, fail)
  if (failure.code !== code) {
    fail('llm/persist code must equal failure.code')
  }
  if (!Number.isSafeInteger(retry) || retry < 1) {
    fail('llm/persist retry must be a positive safe integer')
  }
  if (typeof provider !== 'string' || provider.length === 0) {
    fail('llm/persist provider must be a non-empty string')
  }
  /* v8 ignore next -- equality with the validated failure.code above rejects non-string codes before this branch */
  if (typeof code !== 'string') {
    fail('llm/persist code must be a non-empty string')
  }
  /* v8 ignore next -- the validated failure.code above is non-empty and equality keeps code equal */
  if (code.length === 0) {
    fail('llm/persist code must be a non-empty string')
  }
  if (typeof policyKey !== 'string' || policyKey.length === 0) {
    fail('llm/persist policyKey must be a non-empty string')
  }
  if (typeof delayMs !== 'number' || delayMs < 0 || delayMs > MAX_TIMER_DELAY_MS) {
    fail(`llm/persist delayMs must be a finite number within 0..${MAX_TIMER_DELAY_MS}`)
  }
  /* v8 ignore next -- the session append JSON guard refuses non-finite numbers before this boundary */
  if (!Number.isFinite(delayMs)) {
    fail(`llm/persist delayMs must be a finite number within 0..${MAX_TIMER_DELAY_MS}`)
  }

  const turnBoundary = history.findLast(prior =>
    prior.type === 'turn/start' || prior.type === 'turn/end')
  if (turnBoundary?.type !== 'turn/start') {
    fail('llm/persist must be appended inside an open turn')
  }
  if (turn !== turnBoundary.data.turn) {
    fail(`llm/persist names turn ${turn}, but the open turn is ${turnBoundary.data.turn}`)
  }

  const stepBoundary = history.findLast(prior =>
    prior.type === 'step/start' || prior.type === 'step/end')
  if (stepBoundary?.type !== 'step/start') {
    fail('llm/persist must be appended inside an open step')
  }
  if (step !== stepBoundary.data.step || turn !== stepBoundary.data.turn) {
    fail(`llm/persist names turn ${turn}/step ${step}, but the open step is ${stepBoundary.data.turn}/${stepBoundary.data.step}`)
  }

  const priorPersist = history.findLast((prior): prior is SessionEvent<'llm/persist'> =>
    prior.type === 'llm/persist'
    && prior.data.turn === turn
    && prior.data.step === step
    && prior.data.provider === provider
    && prior.data.policyKey === policyKey)
  const expectedRetry = (priorPersist?.data.retry ?? 0) + 1
  if (retry !== expectedRetry) {
    fail(`llm/persist retry ${retry} must equal provider-policy retry ${expectedRetry}`)
  }
  if (priorPersist !== undefined && priorPersist.data.retryId !== retryId) {
    fail('llm/persist must preserve retryId across one provider-policy chain')
  }
  if (priorPersist === undefined && history.some(prior =>
    (prior.type === 'llm/persist' || prior.type === 'llm/persist-started')
    && prior.data.retryId === retryId)) {
    fail(`llm/persist retryId ${JSON.stringify(retryId)} is already owned by another chain`)
  }
}

/** Validate one wait-complete transition against its scheduled attempt. */
function validateStarted(
  history: readonly SessionEvent[],
  event: SessionEvent<'llm/persist-started'>,
  fail: InvariantFailure,
): void {
  const { retryId, turn, step, retry } = event.data
  if (typeof retryId !== 'string' || retryId.length === 0) {
    fail('llm/persist-started retryId must be a non-empty string')
  }
  const scheduled = history.findLast((prior): prior is SessionEvent<'llm/persist'> =>
    prior.type === 'llm/persist' && prior.data.retryId === retryId && prior.data.retry === retry)
  if (scheduled === undefined) fail('llm/persist-started pairs no prior scheduled attempt')
  if (scheduled.data.turn !== turn || scheduled.data.step !== step) {
    fail('llm/persist-started turn/step must match its scheduled attempt')
  }
  if (history.some(prior => prior.type === 'llm/persist-started'
    && prior.data.retryId === retryId && prior.data.retry === retry)) {
    fail('llm/persist-started repeats one scheduled attempt')
  }
}

/** Validate every persist record already present in one loaded session. */
function validateSession(session: Session, fail: InvariantFailure): void {
  for (const [index, event] of session.events.entries()) {
    if (event.type === 'llm/persist') validatePersist(session.events.slice(0, index), event, fail)
    else if (event.type === 'llm/persist-started') validateStarted(session.events.slice(0, index), event, fail)
  }
}

/** Install validation for loaded and newly appended persist records. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('session/created', (session) => { validateSession(session, fail) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type === 'llm/persist') validatePersist(session.events, event, fail)
    else if (event.type === 'llm/persist-started') validateStarted(session.events, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the LLM persist invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
