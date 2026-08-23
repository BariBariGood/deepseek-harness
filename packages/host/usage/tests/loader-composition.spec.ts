import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type {
  CredentialInfo, CredentialKey, CredentialRecord, CredentialRecordEntry,
  CredentialRecordInfo, CredentialRef, ResolvedCredential,
} from '@deepseek-ai/dsh-credentials'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import * as TypertLoader from '@deepseek-ai/dsh-typert-loader'
import * as TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import type { UsageReport } from '../src/types.ts'
import * as UsageModule from '../src/index.ts'

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Two-provider ok fixture served by the stubbed transport. */
const fetchFixture = (): typeof fetch =>
  (async (url: string | URL | Request) => {
    const body = String(url).includes('openrouter')
      ? { data: { total_credits: 50, total_usage: 12.5 } }
      : { usage: { rolling: { percent: 25, resetsAt: '2026-08-22T18:00:00.000Z' } } }
    return new Response(JSON.stringify(body))
  }) as unknown as typeof fetch

interface CompositionOptions {
  /**
   * Bearer values served through a mounted credential seam. Undefined mounts
   * no seam at all, leaving the launch environment as the credential plane.
   */
  keys?: Readonly<Record<string, string>>
}

export async function loadComposition(options: CompositionOptions = {}): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-host-usage-loader-'))
  // typert-loader resolves each entry's ./typert artifact with a require
  // anchored at ctx.baseUrl, and Include rewrites that anchor to the config
  // directory on activation — mirroring the real profile's healed
  // node_modules, the composition dir gets a link to the package under test.
  await mkdir(join(root, 'node_modules', '@deepseek-ai'), { recursive: true })
  await symlink(
    join(dirname(fileURLToPath(import.meta.url)), '..'),
    join(root, 'node_modules', '@deepseek-ai', 'dsh-host-usage'),
    'dir',
  )
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-typert-registry'",
    "- name: '@deepseek-ai/dsh-typert-loader'",
    ...(options.keys === undefined ? [] : ["- name: 'test-credentials'"]),
    "- name: '@deepseek-ai/dsh-host-usage'",
    '  config:',
    '    timeoutMs: 250',
    '',
  ].join('\n'))

  // The Loader instantiates plugins itself, so the key table closes over the
  // composition instead of riding a constructor argument.
  const keys = options.keys ?? {}
  class TestCredentials extends CredentialProvider {
    async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
      const value = keys[ref]
      return value === undefined ? undefined : { value, source: 'test' }
    }

    async describe(ref: CredentialRef): Promise<CredentialInfo> {
      return { configured: keys[ref] !== undefined, writable: false }
    }

    async set(): Promise<void> {
      throw new Error('test credentials are read-only')
    }

    async unset(): Promise<void> {
      throw new Error('test credentials are read-only')
    }

    async readRecord(): Promise<CredentialRecord | undefined> {
      throw new Error('records unsupported')
    }

    async describeRecord(): Promise<CredentialRecordInfo> {
      throw new Error('records unsupported')
    }

    async listRecords(): Promise<readonly CredentialRecordEntry[]> {
      throw new Error('records unsupported')
    }

    async modifyRecord(): Promise<CredentialRecord | undefined> {
      throw new Error('records unsupported')
    }

    async deleteRecord(_key: CredentialKey): Promise<void> {
      throw new Error('records unsupported')
    }
  }

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-typert-registry', TypertRegistry],
    ['@deepseek-ai/dsh-typert-loader', TypertLoader],
    ['@deepseek-ai/dsh-host-usage', UsageModule],
    ['test-credentials', TestCredentials],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const found = modules.get(specifier)
      if (found === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return found
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(join(root, 'cordis.yml')).href },
  })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return ctx
}

describe('usage gateway through a real Loader composition', () => {
  it('exposes usage/get over typert and degrades each provider independently', async () => {
    vi.stubGlobal('fetch', fetchFixture())
    const ctx = await loadComposition({
      keys: { OPENROUTER_API_KEY: 'router-key' }, // OPENCODE_GO_API_KEY stays absent
    })

    expect(ctx.usage.typertRemote.namespace).toBe('usage')
    expect(remoteMethods(ctx.usage).map(marker => marker.method)).toEqual(['get'])
    expect(ctx.typert.local.get('usage/get')).toBeDefined()

    const snapshot = await ctx.usage.get()
    expect(snapshot.collectedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/))
    expect(snapshot.reports).toEqual([
      { provider: 'openrouter', code: 'ok', totalCredits: 50, totalUsage: 12.5 },
      { provider: 'opencode-go', code: 'unconfigured' },
    ] satisfies UsageReport[])
  })

  it('turns provider failures into per-provider error entries', async () => {
    vi.stubGlobal('fetch', (async () => new Response('denied', { status: 401 })) as unknown as typeof fetch)
    const ctx = await loadComposition({
      keys: { OPENROUTER_API_KEY: 'router-key', OPENCODE_GO_API_KEY: 'go-key' },
    })

    const snapshot = await ctx.usage.get()
    const [openrouter, opencodeGo] = snapshot.reports
    expect(openrouter).toMatchObject({ provider: 'openrouter', code: 'error' })
    expect(opencodeGo).toEqual({ provider: 'opencode-go', code: 'error', message: 'OpenCode Go usage responded HTTP 401' })
  })

  it('reads no credentials when the seam is absent and the environment is bare', async () => {
    vi.stubGlobal('fetch', fetchFixture())
    const ctx = await loadComposition()

    const snapshot = await ctx.usage.get()
    expect(snapshot.reports).toEqual([
      { provider: 'openrouter', code: 'unconfigured' },
      { provider: 'opencode-go', code: 'unconfigured' },
    ] satisfies UsageReport[])
  })

  it('withdraws the endpoint when the plugin fiber is disposed', async () => {
    vi.stubGlobal('fetch', fetchFixture())
    const ctx = await loadComposition({ keys: {} })
    // Retain the store: disposing the root fiber tears the service down with it.
    const local = ctx.typert.local
    expect(local.get('usage/get')).toBeDefined()
    await ctx.fiber.dispose()
    contexts.length = 0
    expect(local.get('usage/get')).toBeUndefined()
  })
})
