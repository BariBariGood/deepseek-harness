# Agent Note: The Telegram channel rides the agent factory, not the session store

Status: implemented

English | [中文](2026-08-22-telegram-channel-agent-factory.zh.md)

## Problem

Giving the agent a messaging-platform entrance (Telegram first, mirroring hermes-agent's gateway) needs three things wired without breaking existing invariants: an inbound transport that outlives any single request, a chat→session mapping that survives restarts, and replies that reach the user. The tempting shortcut is `ctx.sessions.create` plus manual event listening — but the store's own JSDoc refuses that path: a session created on the relay's fiber tears down with the wrong lifetime, racing the loop's ordered publish.

A second pressure is access control. A bot that answers anyone who messages it is a remote code-execution endpoint on the owner's machine, so authorization must deny by default and fail closed when unconfigured.

## Decision

**Sessions are minted only through `ctx.agents.create`/`resume`.** The relay keeps a per-chat key (`tg-<chat>`, `<chat>:<topic>` for forum threads) mapped to a deterministic session id and mirrors apiproxy's `ensureSession`: live reuse, then fresh create with a preset-composing setup. `/new` bumps a generation counter instead of disposing anything — the previous conversation remains in the sidebar as history, which is what a messaging user expects from "new chat".

**Authorization denies by default and reads the shared credential plane.** The token resolves per start through the credentials seam under `TELEGRAM_BOT_TOKEN` (launch-environment fallback), never at import; with no token the plugin logs one warning and stays idle rather than failing the surface it mounted on. An empty allowlist answers nothing. Groups additionally require a slash command or bot mention (hermes' mention gating), so lurking bots don't answer chatter.

**Replies stream as one throttled draft bubble.** Each turn snapshots the log seq before `followup`, sends the first folded text as soon as it exists, and edits that one message on a throttle until `whenIdle`; the final fold is authoritative and checkpoints through the session-store flush. Rejected edits (identical text, transient 429s) keep the draft id so the next tick edits instead of duplicating. A blocked turn never freezes the polling loop: handlers fire unawaited and the relay chains turns per chat.

**Model choice is a per-chat override, not a new session.** `/model` mirrors hermes' slash UX: bare shows current plus every `llm` route, `provider/model` switches exactly after `resolveCallConfig` validation, a bare name fuzzy-matches with ambiguity listing candidates. The selection lives in `ChatState`, threads into `ctx.agents.create`, and installs a `ModelSelectionRef` in the agent's setup window so a mid-chat switch mutates the ref and re-routes the next turn without recreating the session or losing history.

**Origin is a widened union, not a new field.** `SessionHeader.origin` becomes `SessionOrigin = 'subagent' | 'telegram'`; every validator (header check, jsonl codec, sqlite column check, both zod wire schemas) accepts both values while all `'subagent'` comparisons keep their meaning. The sidebar's workspace tree excludes telegram rows at its single visibility choke point and renders them in a dedicated collapsible section — the same shape as hermes' per-platform sidebar sections.

## Testing

`packages/channel/telegram/tests/transport.spec.ts` covers the Bot API client (envelope unwrap, typed 429/409 errors, token-scoped URLs), normalization (snake_case `update_id` mapping, bot/empty drops, topic keys, mention gating), and the polling loop (ordered offset advance, retry-after backoff, conflict surfacing, clean abort). `tests/relay.spec.ts` drives the relay over fake services: deterministic ids with generation suffixes, reuse, allowlist rejection, `/new` + `/help`, per-chat serialization, abnormal-reason suffix, draft streaming, and the `/model` matrix (list, exact switch, fuzzy match, ambiguity, miss). `packages/client/ui-workspace/tests/tree.client.spec.ts` asserts the partition (telegram rows leave groups/flat, arrive newest-first, archive/blank handling).

## Consequences

Adding the next platform means a sibling package reusing `TelegramRelay`'s shape with its own transport — the session-routing contract is already platform-neutral except for the id prefix. The channel is silent about media, reactions, and streaming edits; each of those lands as an extension of `types.ts` plus one adapter concern, not a core change.

## Alternatives considered

**A generic messaging-platform seam now** (Service Definition + provider + consumer). Rejected with one implemented platform: the seam would be inferred from a single provider and would likely guess wrong; the relay class is already the reusable part. Revisit at the second platform.

**Streaming via `sendMessage`+`editMessageText` per chunk.** Deferred: rate limits make naive edits costly and the fold point is reserved for a Hermes-style draft consumer with throttling.

**Pairing codes for unknown users.** Deferred: allowlist-plus-Models-page covers the single-owner deployment today; pairing needs an approval surface that deserves its own design.
