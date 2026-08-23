# @deepseek-ai/dsh-client-ui-usage

English | [中文](README.zh.md)

Sidebar usage surface over the [`usage`](../../host/usage/README.md) Remote. The plugin contributes one `sidebar.footer.action` entry: an icon trigger that opens a floating provider-usage card anchored above the footer (the sidebar clips overflow, so the card positions itself from a measured trigger offset instead of document flow). Opening always refetches; the header button refreshes on demand.

The component is pure presentation: the inject face exposes one `refresh` verb that unwraps the Remote envelope, and all view state (open flag, last snapshot, in-flight marker, error) stays component-local. Each report renders by its `code`: OpenRouter credit totals as a USD bar with remaining allowance, OpenCode Go windows as percent bars with reset instants, `unconfigured` as a hint naming the missing credential ref, and errors as an inline alert beside any healthy provider. Copy lives in the zh-first `usage` locale namespace.

## Model Experience

None, as this sidebar card renders provider billing state that never enters the Session log, the model context, or telemetry.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Pull-only** — numbers refresh on open or explicit action; there is no background polling or push update.
- **Fixed USD formatting** — OpenRouter bills in USD, so amounts render through an en-US currency formatter regardless of UI language.
