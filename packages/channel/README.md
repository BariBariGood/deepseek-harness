# channel/ — external messaging entrances

English | [中文](README.zh.md)

Adapters that relay an external messaging platform into durable agent sessions through the shared agent factory. Each channel owns its transport and authorization; sessions minted here carry a header `origin` so the web sidebar can group them per platform.

| Package | Purpose |
|---|---|
| [`telegram/`](telegram/README.md) | Telegram Bot API channel: allowlisted chats, per-chat session routing, final-reply delivery |
