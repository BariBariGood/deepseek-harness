import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity shared by every attempt in one request-step persist chain. */
export type PersistId = Branded<'PersistId'>

/**
 * Brand an implementation-minted persist-chain identity.
 * @param id - opaque persist identity.
 * @returns the same string, branded; no validation is performed.
 */
export function PersistId(id: string): PersistId {
  return id as PersistId
}
