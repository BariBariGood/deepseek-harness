# Agent Note: The Telegram channel rides the agent factory, not the session store

Status: implemented

English | [中文](2026-08-22-telegram-channel-agent-factory.zh.md)

## Problem

Giving the agent a messaging-platform entrance (Telegram first, mirroring hermes-agent's gateway) needs three things wired without breaking existing invariants: an inbound transport that outlives any single request, a chat→session mapping that survives restarts, and replies that reach the user. The tempting shortcut is `ctx.sessions.create` plus manual event listening — but the store's own JSDoc refuses that path: a session created on the relay's fiber tears down with the wrong lifetime, racing the loop's ordered publish.

A second pressure is access control. A bot that answers anyone who messages it is a remote code-execution endpoint on the owner's machine, so authorization must deny by default and fail closed when unconfigured.

## Decision

**Sessions are minted only through `ctx.agents.create`/`resume`.** The relay keeps a per-chat key (`tg-<chat>`, `<chat>:<topic>` for forum threads) mapped to a deterministic session id and mirrors apiproxy's `ensureSession`: live reuse, then fresh create with a preset-composing setup. `/new` bumps a generation counter instead of disposing anything — the previous conversation remains in the sidebar as history, which is what a messaging user expects from "new chat".

**Authorization denies by default and reads the shared credential plane.** The token resolves per start through the credentials seam under `TELEGRAM_BOT_TOKEN` (launch-environment fallback), never at import; with no token the plugin logs one warning and stays idle rather than failing the surface it mounted on. An empty allowlist answers nothing. Groups additionally require a slash command or bot mention (hermes' mention gating), so lurking bots don't answer chatter.

**Replies pull after quiescence instead of streaming.** Each turn snapshots the log seq before `followup`, awaits `whenIdle`, folds `assistant/message` events since the snapshot, checkpoints through the session-store flush, then sends one message. Streaming edits (hermes' draft frames) remain deferred until this channel earns them; the fold point is where a stream consumer would attach.

**Origin is a widened union, not a new field.** `SessionHeader.origin` becomes `SessionOrigin = 'subagent' | 'telegram'`; every validator (header check, jsonl codec, sqlite column check, both zod wire schemas) accepts both values while all `'subagent'` comparisons keep their meaning. The sidebar's workspace tree excludes telegram rows at its single visibility choke point and renders them in a dedicated collapsible section — the same shape as hermes' per-platform sidebar sections.

## Testing

`packages/channel/telegram/tests/transport.spec.ts` covers the Bot API client (envelope unwrap, typed 429/409 errors, token-scoped URLs), normalization (bot/empty drops, topic keys, mention gating), and the polling loop (ordered offset advance, retry-after backoff, conflict surfacing, clean abort). `tests/relay.spec.ts` drives the relay over fake services: deterministic ids with generation suffixes, reuse, allowlist rejection, `/new` + `/help`, per-chat serialization, abnormal-reason suffix. `packages/client/ui-workspace/tests/tree.client.spec.ts` asserts the partition (telegram rows leave groups/flat, arrive newest-first, archive/blank handling).

## Consequences

Adding the next platform means a sibling package reusing `TelegramRelay`'s shape with its own transport — the session-routing contract is already platform-neutral except for the id prefix. The channel is silent about media, reactions, and streaming edits; each of those lands as an extension of `types.ts` plus one adapter concern, not a core change.

## Alternatives considered

**A generic messaging-platform seam now** (Service Definition + provider + consumer). Rejected with one implemented platform: the seam would be inferred from a single provider and would likely guess wrong; the relay class is already the reusable part. Revisit at the second platform.

**Streaming via `sendMessage`+`editMessageText` per chunk.** Deferred: rate limits make naive edits costly and the fold point is reserved for a Hermes-style draft consumer with throttling.

**Pairing codes for unknown users.** Deferred: allowlist-plus-Models-page covers the single-owner deployment today; pairing needs an approval surface that deserves its own design.
