---
description: "Telegram Bot API channel that relays allowlisted chats into durable agent sessions."
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-telegram

English | [中文](README.zh.md)

## Summary

Telegram channel into the agent: one bot token long-polls the Bot API and relays allowlisted chats into durable agent sessions. Sessions are keyed by chat and topic, carry origin telegram, and stream replies via throttled edits.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

## Model Experience

None, as the channel is transport into the agent factory; the composed preset owns everything model-facing the resulting sessions see.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Text-only inbound updates** — media, stickers, and edited messages are dropped; a media pipeline waits for a consumer that needs it.
- **Single bot token** — one credential per deployment; multi-tenant token pools are out of scope.

<a id="dev-note"></a>
### Dev Note

Implementation details and maintenance notes.
