/**
 * Telegram channel plugin: long-polls one bot token and relays allowlisted
 * chats into durable agent sessions through the shared agent factory.
 *
 * The relay logic lives in `relay.ts` (framework-light); this entry resolves
 * DSH services onto it, owns the polling effect lifetime, and stays idle with
 * a warning when no bot token is configured.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the Context merge that types ctx.agents.
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { TelegramBotApiClient } from './bot-api.ts'
import { isAddressedToChannel } from './inbound.ts'
import { pollMessages } from './poller.ts'
import { TelegramRelay } from './relay.ts'

/** Plugin config: connection and access control for the bot (all defaulted). */
export interface Config {
  /** Credential ref carrying the bot token; resolved through the seam or env. */
  botTokenRef?: string
  /**
   * Telegram user ids allowed to drive the agent. An empty list denies every
   * inbound message: an open bot is never a default.
   */
  allowedUserIds?: number[]
  /** Working directory recorded on gateway-created sessions. */
  cwd?: string
  /** Long-poll hang budget per getUpdates request, in seconds. */
  pollTimeoutSeconds?: number
}


/** Cordis plugin name used by loader diagnostics. */
export const name = 'channel-telegram'

/** Required services: the agent factory owns session+loop lifecycles. */
export const inject = ['agents']

/** Config schema; schemastery applies defaults before apply runs. */
export const Config: z<Config> = z.object({
  botTokenRef: z.string().default('TELEGRAM_BOT_TOKEN'),
  allowedUserIds: z.array(z.number()).default([]),
  cwd: z.string(),
  pollTimeoutSeconds: z.number().default(25),
})

/** Structural view of the optional preset roster (kept dependency-light). */
interface PresetsLike {
  defaultId: string
  mount(agentCtx: Context, id?: string): Promise<unknown>
}

/**
 * Resolve the bot token through the seam when mounted; without it the launch
 * environment is the whole credential plane, mirroring the LLM adapters.
 */
async function resolveToken(ctx: Context, refName: string): Promise<string | undefined> {
  const ref = credentialRef(refName)
  const credentials = ctx.get('credentials')
  const hit = credentials !== undefined ? (await credentials.resolve(ref))?.value : undefined
  if (hit !== undefined && hit.length > 0) return hit
  return launchEnvironmentOf(ctx).get(ref)?.value
}

/**
 * Start polling under the plugin fiber's effect so stop, update, and undefine
 * abort the loop and unwind every registration with it.
 * @param ctx - Host context carrying agents plus optional seam services.
 * @param config - Resolved row config after schemastery defaults.
 */
export function apply(ctx: Context, config: Config): void {
  const pollTimeoutSeconds = config.pollTimeoutSeconds ?? 25
  const allowedUserIds = (config.allowedUserIds ?? []).map(String)
  const controller = new AbortController()

  ctx.effect(() => {
    void (async () => {
      const token = await resolveToken(ctx, config.botTokenRef ?? 'TELEGRAM_BOT_TOKEN')
      if (token === undefined) {
        ctx.logger.warn(`channel-telegram: idle — no bot token under ref ${config.botTokenRef ?? 'TELEGRAM_BOT_TOKEN'}; store it on the Models page or in the environment`)
        return
      }
      const client = new TelegramBotApiClient(token)
      let me: { id: number; username: string }
      try {
        // A stale webhook makes every getUpdates 409; drop it before polling.
        await client.deleteWebhook().catch((cause: unknown) => {
          ctx.logger.warn(`channel-telegram: webhook cleanup failed (${String(cause)})`)
        })
        me = await client.getMe()
      } catch (error) {
        ctx.logger.warn(`channel-telegram: idle — Bot API rejected the token (${String(error)})`)
        return
      }

      const presets = ctx.get('agentPresets') as unknown as PresetsLike | undefined
      const presetId = presets?.defaultId

      const relay = new TelegramRelay(
        {
          setupFactory: () =>
            presets === undefined
              ? undefined
              : async (agentCtx) => {
                await presets.mount(agentCtx)
              },
          presetId,
        },
        {
          // The relay only ever hands back sessions minted by this factory.
          flushSession: session => ctx.sessions.flush(session as Parameters<typeof ctx.sessions.flush>[0]),
          createAgent: async ({ sessionId, meta, setup }) => {
            const handle = setup === undefined
              ? await ctx.agents.create({ sessionId, meta })
              : await ctx.agents.create({ sessionId, meta, setup })
            return { agent: handle.agent }
          },
          getLiveAgent: sessionId => ctx.agents.get(sessionId),
        },
        {
          cwd: config.cwd ?? process.cwd(),
          allowedUserIds,
        },
        {
          send: async (chatId, text) => await client.sendMessage(chatId, text),
          edit: async (chatId, messageId, text) => {
            await client.editMessageText(chatId, messageId, text)
          },
          typing: chatId => client.sendChatAction(chatId, 'typing'),
          logger: ctx.logger,
        },
      )

      ctx.logger.info(`channel-telegram: polling as @${me.username} for ${allowedUserIds.length} allowed user(s)`)
      await pollMessages({
        client,
        pollTimeoutSeconds,
        signal: controller.signal,
        onMessage: async (message) => {
          if (!isAddressedToChannel(message, [me.username.toLowerCase()])) return
          await relay.handle(message)
        },
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return
        ctx.logger.error(`channel-telegram: polling stopped — ${String(error)}`)
      })
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) ctx.logger.error(`channel-telegram: startup failed — ${String(error)}`)
    })
    return () => {
      controller.abort()
    }
  }, 'channel-telegram: polling loop')
}
