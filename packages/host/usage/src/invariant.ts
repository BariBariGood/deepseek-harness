/** Package-owned invariant companion. @module @deepseek-ai/dsh-host-usage/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-usage'

/** Cordis companion plugin name. */
export const name = 'host-usage-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every `usage/get` call projects fresh provider
 * responses and the service owns no retained or cross-event state, so no
 * second authority exists to check at runtime.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
