/** Package-owned invariant companion. @module @deepseek-ai/dsh-channel-telegram/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-channel-telegram'

/** Cordis companion plugin name. */
export const name = 'channel-telegram-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the polling loop and per-chat relays ride the plugin
 * fiber's effect disposer, and session lifecycles are owned by the agent
 * factory, so no second authority exists to check at runtime.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
