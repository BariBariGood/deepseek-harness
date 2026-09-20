---
description: "External messaging channel group for Telegram and future adapters."
kind: "package-group"
---

# channel/ — external messaging entrances

English | [中文](README.zh.md)

## Summary

The channel group relays external messaging platforms into the Harness: one adapter per platform owns its transport, long-polling, authorization allowlist, and per-chat command surface, and hands approved messages to the agent factory as ordinary sessions. Chat commands (a fresh conversation, a model switch) resolve through the same seams the web surface uses. Choose this group to reach an agent from a messaging app; the composed preset — not the adapter — owns everything model-facing the resulting sessions see.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | Shape |
|---|---|---|
| [`telegram`](telegram/README.md) | Drive the agent from a Telegram bot DM; idle without a bot token | plugin |

-----

<a id="dev-note"></a>
## Dev Note

<details>

<summary>Session origin is presentation metadata</summary>

Sessions created by a channel carry `origin: 'telegram'` in their durable header so the web sidebar can group them. The marker is a navigation aid only: it proves nothing about the session's validity or continuability, and the shared `SessionOrigin` vocabulary lives in dsh-session.

</details>
