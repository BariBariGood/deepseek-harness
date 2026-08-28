/**
 * Usage surface plugin, browser half: the sidebar footer trigger plus the
 * floating provider-usage panel it opens. Data is pulled per open/refresh
 * through the generated `usage` Remote; the Host degrades each provider
 * independently, so the panel renders whatever the snapshot carries.
 * @module @deepseek-ai/dsh-client-ui-usage/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the sidebar.footer.action entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { en, zh } from './locales.ts'
import { UsagePanel } from './UsagePanel.tsx'
import type { UsageFace } from './slots.ts'

export type { UsageFace } from './slots.ts'
export type { UsageKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'usage'

/** Required services: the slot registry, the copy, and the Remote namespace. */
export const inject = ['slots', 'locale', 'remote', 'remote.usage']

/**
 * Client plugin body: the usage trigger in the sidebar footer.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-usage: dictionaries')

  ctx.slots.inject('sidebar.footer.action', () => {
    const dispose = ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'usage',
      locale: NS,
      inject: (): UsageFace => ({
        refresh: async () => {
          const result = await ctx.remote.usage.get()
          if (!result.ok) {
            throw new Error(`usage.get failed: ${result.error.code}: ${result.error.message}`)
          }
          return result.value
        },
      }),
    }, UsagePanel)
    return () => {
      dispose()
    }
  })
}
