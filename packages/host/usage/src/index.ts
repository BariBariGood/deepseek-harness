/** Connected-provider usage projection served to the browser as the `usage` Remote. */

import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { errorMessage, fetchOpenCodeGoUsage, fetchOpenRouterCredits } from './providers.ts'
import type { FetchImpl } from './providers.ts'
import type { UsageOkReport, UsageProviderId, UsageReport, UsageSnapshot } from './types.ts'

export type * from './types.ts'

const OPENROUTER_KEY_REF = credentialRef('OPENROUTER_API_KEY')
const OPENCODE_GO_KEY_REF = credentialRef('OPENCODE_GO_API_KEY')

/** Fallback per-request timeout when the row config omits one. */
export const DEFAULT_TIMEOUT_MS = 15_000

/** Plugin config: transport tuning for the provider usage calls (all defaulted). */
export interface Config {
  /** Abort a provider request after this many milliseconds. */
  timeoutMs?: number
}

/**
 * Serves the web usage panel over the `usage/get` endpoint. Every call
 * re-resolves credentials and refetches both providers: billing state is
 * read-only remote data the service never caches.
 */
export class UsageGateway extends TypertRemoteService {
  /** Config schema; schemastery applies defaults before construction. */
  static Config: z<Config> = z.object({
    timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  })

  private readonly timeoutMs: number

  constructor(ctx: Context, config: Config) {
    super(ctx, 'usage')
    // Explicit resolve of the schema-defaulted field: direct constructions
    // (tests) may omit the config entirely.
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /**
   * Fetch every supported provider once. Reports are independent: a missing
   * key or failed request degrades only its own entry, so one provider's
   * outage never blanks the panel.
   * @returns Current billing state of every supported provider.
   */
  @Remote('get')
  async get(): Promise<UsageSnapshot> {
    const reports = await Promise.all([
      this.reportOpenRouter(this.timeoutMs),
      this.reportOpenCodeGo(this.timeoutMs),
    ])
    return { collectedAt: new Date().toISOString(), reports }
  }

  /**
   * Resolve a credential through the seam when mounted; without it the launch
   * environment is the whole credential plane, mirroring the LLM adapters.
   */
  private async credentialValue(ref: CredentialRef): Promise<string | undefined> {
    const credentials = this.ctx.get('credentials')
    if (credentials !== undefined) return (await credentials.resolve(ref))?.value
    return launchEnvironmentOf(this.ctx).get(ref)?.value
  }

  private reportOpenRouter(timeoutMs: number): Promise<UsageReport> {
    return this.reportProvider('openrouter', OPENROUTER_KEY_REF, async (key, fetchImpl) => {
      const { totalCredits, totalUsage } = await fetchOpenRouterCredits(key, timeoutMs, fetchImpl)
      return { provider: 'openrouter', code: 'ok', totalCredits, totalUsage }
    })
  }

  private reportOpenCodeGo(timeoutMs: number): Promise<UsageReport> {
    return this.reportProvider('opencode-go', OPENCODE_GO_KEY_REF, async (key, fetchImpl) => {
      return {
        provider: 'opencode-go',
        code: 'ok',
        windows: await fetchOpenCodeGoUsage(key, timeoutMs, fetchImpl),
      }
    })
  }

  /**
   * Build one provider's report. A missing key reads as unconfigured and any
   * failure becomes that provider's error entry, so reports stay independent.
   */
  private async reportProvider(
    provider: UsageProviderId,
    ref: CredentialRef,
    run: (key: string, fetchImpl: FetchImpl) => Promise<UsageOkReport>,
  ): Promise<UsageReport> {
    const key = await this.credentialValue(ref)
    if (key === undefined) return { provider, code: 'unconfigured' }
    try {
      return await run(key, (...args) => fetch(...args))
    } catch (error) {
      return { provider, code: 'error', message: errorMessage(error) }
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Connected-provider billing state for the web usage panel. */
    usage: UsageGateway
  }
}

export default UsageGateway
