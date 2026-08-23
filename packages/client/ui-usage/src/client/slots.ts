/** Injected face of the sidebar footer usage entry. */

import type { UsageSnapshot } from '@deepseek-ai/dsh-api-remotes/client'

/** Verbs injected into the usage panel; data is pulled per call. */
export interface UsageFace {
  /**
   * Fetch a fresh usage snapshot from the host.
   * @returns The assembled snapshot with one report per provider.
   * @throws When the wire call fails, with the endpoint's error message.
   */
  refresh(): Promise<UsageSnapshot>
}
