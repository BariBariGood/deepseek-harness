// @vitest-environment jsdom
/**
 * ui-usage browser half on a real cordis Context with fake slots/remote faces:
 * the plugin contributes the usage entry into sidebar.footer.action through
 * slots.inject, the inject face unwraps the Remote envelope (value out,
 * failure rejected), and registration rides the plugin fiber (HMR safety).
 * The node half and the invariant companion run over the same Context.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { UsageSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { UsageFace } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import * as UsageInvariant from '../src/invariant.ts'

afterEach(cleanup)

const snapshot: UsageSnapshot = {
  collectedAt: '2026-08-22T18:00:00.000Z',
  reports: [{ provider: 'openrouter', code: 'ok', totalCredits: 50, totalUsage: 12.5 }],
}

/** Boot the plugin over fake faces; the Remote namespace records every call. */
async function bench(remoteUsage: Record<string, unknown>) {
  const ctx = new Context()
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.usage', remoteUsage)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx,
    fiber,
    face: (): UsageFace | undefined => {
      const entry = ctx.slots.entries('sidebar.footer.action')[0]
      return (entry?.inject as unknown as (() => UsageFace) | undefined)?.()
    },
  }
}

describe('ui-usage browser half on a real Context', () => {
  it('contributes the footer action and unwraps a successful envelope', async () => {
    let calls = 0
    const { face } = await bench({
      get: () => {
        calls += 1
        return Promise.resolve({ ok: true as const, value: snapshot })
      },
    })

    expect(face()).toBeDefined()
    await expect(face()?.refresh()).resolves.toEqual(snapshot)
    expect(calls).toBe(1)
  })

  it('rejects with the wire code and message on a failed envelope', async () => {
    const { face } = await bench({
      get: () => Promise.resolve({
        ok: false as const,
        error: { code: 'service-unavailable', message: 'usage service is not mounted' },
      }),
    })

    await expect(face()?.refresh()).rejects.toThrowError('usage.get failed: service-unavailable: usage service is not mounted')
  })

  it('removes the contribution when the plugin fiber is disposed', async () => {
    const { ctx, fiber } = await bench({ get: () => Promise.resolve({ ok: true as const, value: snapshot }) })
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(1)

    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)
  })

  it('runs the empty node half and registers the invariant companion', async () => {
    expect(nodeApply()).toBeUndefined()
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(UsageInvariant).await()).resolves.toBeDefined()
  })
})
