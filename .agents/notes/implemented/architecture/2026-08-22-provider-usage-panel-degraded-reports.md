# Agent Note: The usage panel degrades per provider instead of failing the endpoint

Status: implemented

English | [中文](2026-08-22-provider-usage-panel-degraded-reports.zh.md)

## Problem

The web sidebar gained a usage card for connected providers (OpenRouter credits, OpenCode Go rate windows). Two design pressures collide. Billing endpoints are flaky in exactly the ways model traffic is not — a plan without a window, a 401 after a rotation, a slow timeout — and the panel is a footer card that must stay legible when any single provider misbehaves. Meanwhile the secrets those endpoints need are already stored: `llm-pi-ai` routes reference `OPENROUTER_API_KEY` and `OPENCODE_GO_API_KEY`, and storing a second copy under usage-specific names would desync the moment either side rotates.

## Decision

**Degradation lives in the payload, not the transport.** `usage/get` always resolves with one report per supported provider; `code` discriminates `ok`, `unconfigured`, and `error`. A missing key, an HTTP failure, or an unparseable body becomes that provider's entry with a display-safe message, so one provider's outage blanks its own card and nothing else. The client renders whatever arrives and needs no retry taxonomy of its own.

**The credential refs are reused, not mirrored.** The gateway resolves `credentialRef('OPENROUTER_API_KEY')` and `credentialRef('OPENCODE_GO_API_KEY')` through the optional seam — the same refs the pi-ai routes resolve for inference. One stored secret serves both the model call and the card, rotation stays single-point, and the panel adds no settings surface: an absent ref reads as `unconfigured` naming the ref to store on the Models page.

**Pull beats subscribe.** The card refetches on every open plus an explicit refresh button; there is no push channel, background poll, or session event. Nothing here is model-visible, so the model-visible-means-logged rule never engages, and billing totals change on a horizon where per-open freshness wins against wiring a forwarded-event path through `api-remotes`.

## Testing

`packages/host/usage/tests/loader-composition.spec.ts` boots the real Loader over a stub credential seam and stubbed transport: endpoint registration into `ctx.typert`, mixed ok/unconfigured and all-error snapshots, the no-seam launch-environment fallback, and registry withdrawal on fiber disposal. `tests/providers.spec.ts` covers parsers and bearer/status/transport/non-JSON arms. Client-side, `browser-plugin.client.spec.tsx` boots the plugin over a real Context asserting envelope unwrap both ways and HMR-safe withdrawal from `sidebar.footer.action`; `usage-panel.client.spec.tsx` renders every report code, refetch-on-open, stale-visible refresh, and alert surfacing.

## Consequences

The wire type is a discriminated union that grows per provider, and the client renders by `code`, so adding a provider touches the gateway, the union, and one render branch — never the endpoint's failure contract. Display-safe error messages are an obligation the host carries alone: provider response bodies and request headers never enter a report message. Because reports are pull-only, a card left open shows frozen numbers until interaction; the refresh affordance is part of the decision, not a decoration.

## Alternatives considered

**A shared quota-provider seam** (`providers/<name>/usage` style, OpenChamber-shaped). Rejected for now: two consumers with different payloads do not pay for the abstraction, and the wire shapes differ enough (credit totals vs window lists) that a common face would be stringly typed. Revisit at the third provider.

**Usage-specific credential refs** (`USAGE_OPENROUTER_API_KEY`). Rejected: it doubles storage, splits rotation, and the Models page already owns write access to the existing refs.

**Forwarded host events for live updates.** Rejected with pull: the forwarded-event allowlist exists for state the user watches continuously (runs, streams); usage numbers are checked, not watched.
