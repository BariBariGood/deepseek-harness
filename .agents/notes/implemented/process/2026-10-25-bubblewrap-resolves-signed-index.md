# Agent Note: bubblewrap payload resolves through the signed index chain

Status: implemented

English | [中文](2026-10-25-bubblewrap-resolves-signed-index.zh.md)

## Problem

`scripts/prepare-ci-bubblewrap.sh` pinned a single `.deb` version plus its SHA256 and fetched it from `archive.ubuntu.com`'s package pool. The pool keeps only the newest point release of a pocket: when `0.9.0-1ubuntu0.3` superseded `0.9.0-1ubuntu0.1`, the pinned URL began returning 404 and every scheduled `E2E (real DeepSeek API)` run failed before the suite could start. The nightly signal was dead for weeks with no code change on our side — the pin was a time bomb that any archive security update could set off again.

## Decision

The script resolves the payload through the same trust chain apt walks, instead of pinning it. It reads the release codename from `/etc/os-release`, fetches the `<codename>-updates` `InRelease` (falling back to the release pocket), verifies that file's signature with `gpgv` against the `ubuntu-archive-keyring` the runner image ships, reads the `main/binary-amd64/Packages.xz` digest out of the signed body, fetches and verifies that index, then reads the `bubblewrap` stanza's `Filename` and `SHA256` from it. The deb is downloaded from `pool/` and verified against that digest before `dpkg-deb --extract` and the unchanged functional probe run.

Every artifact is checked against a signed or digest-verified parent, so integrity strength matches the old hardcoded hash while the resolved version now tracks the archive. A pocket missing the stanza falls through to the next pocket; exhausting both fails loud, as does a missing keyring.

## Alternatives considered

**Bumping the pin to the current pool version.** One-line and immediately green, but the same rotation returns on the next archive update — the fix has to remove the rot mechanism, not refresh the fuse.

**`apt-get download bubblewrap`.** Lets apt do the resolution and verification in three lines. It loses the fixed-version property and adds an `apt-get update` round-trip; more importantly it smuggles the toolchain prep into apt's semantics (candidate selection, `trusted=yes` edge cases) instead of stating the payload we take and how it is verified. Worth it only if the index walk ever proves fragile.

**snapshot.ubuntu.com pinned URL.** The snapshot service answers 401 today and is not a dependable fetch endpoint for CI.

## Consequences

Nightly e2e prepares bubblewrap against whatever point release the archive currently serves, and the next rotation is a no-event instead of a multi-week outage. The functional probe at the end still decides whether the resolved payload actually sandboxes — resolution changes which deb we get, never whether we trust it to work.

The script grows from one pinned fetch to a three-hop verify chain (~50 extra lines of awk/curl plumbing). The codename is read from the runner rather than hardcoded, so `ubuntu-latest` image drift is absorbed — a runner whose `/etc/os-release` or keyring deviates fails at preflight instead of downloading an unverifiable payload.
