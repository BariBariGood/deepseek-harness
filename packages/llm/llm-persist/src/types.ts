import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import type { PersistId } from './brand.ts'

export type { PersistId }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable, non-surface record of one persisted retry scheduled after a failed request attempt. */
    'llm/persist': LlmPersistEventData
    /** Durable transition written after a persist wait succeeds and before the next request attempt starts. */
    'llm/persist-started': LlmPersistStartedEventData
  }
}

/** Durable payload recorded before one provider-pinned persist retry wait. */
export interface LlmPersistEventData {
  retryId: PersistId
  turn: number
  step: number
  provider: string
  /** Failure code that entered persistence; it is a member of the configured codes. */
  code: string
  policyKey: string
  retry: number
  delayMs: number
  failure: LlmFailure
}

/** Durable transition recorded after one persist delay completes. */
export interface LlmPersistStartedEventData {
  retryId: PersistId
  turn: number
  step: number
  retry: number
}
