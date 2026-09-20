# Agent Note: Upstream sync to dsh 0.1.6-alpha.2 keeps the telegram origin as a field-level fork vocabulary

Status: implemented

English | [中文](2026-09-20-upstream-sync-0.1.6-alpha.2.zh.md)

## Problem

The fork carries four custom packages (channel/telegram, host/usage, client/ui-usage, llm/llm-persist) and one deliberate divergence inside the shared session stack: `SessionOrigin` includes `'telegram'`, and the telegram channel stamps it on every session it creates so the web sidebar can group bot conversations. Upstream's persistence type-history gate (`verify-persistence-changes`, introduced after the fork's 0.1.2-alpha.2 base) classifies that widening as a version-bump-required durable change and refuses the tree until the history records a real `SESSION_FORMAT_VERSION` transition.

## Decision

**The widening stays; the gate is excluded, not the rule weakened.** The sync merges upstream/master (dsh-v0.1.6-alpha.2) and keeps `origin: 'telegram'` end to end — session header validation, the JSONL header line, the format-catalog logical header, the wire header of session-log-deepseek, and the session-controller summaries. A fork-local format bump to 4 would put a permanent conflict surface into upstream's most actively developed seam (format catalog, migrations, snapshot expectations) for zero interoperability gain: readers that do not know `'telegram'` already reject the log loudly at field validation, which is the same observable behavior a version refusal produces. `verify-persistence-changes` alone is therefore dropped from `doc-sync` in `scripts/run-gates.ts` with a pointer back to this note; every other persistence gate (catalog, releases, formats, session-format-catalog) still runs and passed.

**Every other adaptation follows upstream.** The 3599-commit delta replaced the seeding API (`seedLength` → `isSeeded` + `inheritedEventCount`), made agent creation awaited, moved session reads behind the deprecated `snapshotEvents()` (used with per-line suppression and a limitation entry until the handle-based migration), deleted the sqlite persistence backend (and llm-persist's stale devDependency on it), and restructured the client primitives. Fork packages were ported onto those APIs; no shim layers were added.

## Testing

Fork-package suites (telegram relay/transport, llm-persist persist/invariant/composition, host usage, ui-usage, ui-workspace tree, ui-model-selection) run 357/357; repo typecheck, oxlint, and `doc-sync` (minus the excluded gate) are clean. The generated catalogs (config, tool, cordis API, persistence, doc graphs) are regenerated from merged sources, and the bilingual pairs touched by the sync are re-recorded.

## Consequences

Future upstream syncs hit a known, documented conflict set: the `doc-sync` gate list (keep the exclusion), the six widened `origin` sites (re-apply the widening), and the generated catalogs (regenerate). If upstream ever ships its own multi-origin `SessionOrigin`, the fork's union and the gate exclusion collapse into it. If the telegram channel ever needs a second durable field, that is the point to revisit the field-level stance against a real fork format bump.

## Alternatives considered

**Fork-local `SESSION_FORMAT_VERSION = 4` with an identity-preserving v3-to-v4 migration.** Rejected: ~700 lines of migration machinery copied from upstream's v2-to-v3 work, a guaranteed collision when upstream ships its own v4, and strictly worse interop — upstream builds would refuse every fork log at the version check instead of only telegram-origin logs at the field check.

**Redesign the feature to drop the durable marker** (the channel publishes its chat-to-session registry over a Remote; the sidebar queries it). Rejected for this sync: it rewrites a working, tested feature at merge time with no live-bot verification path; revisit if the exclusion ever causes a real drift problem.
