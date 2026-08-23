# channel/ — 外部消息入口

[English](README.md) | 中文

把外部消息平台中继到持久 agent 会话的适配器，经共享 agent 工厂铸造会话。每个通道拥有自己的传输与鉴权；此处创建的会话携带 header `origin`，供 Web 侧栏按平台分组。

| 包 | 用途 |
|---|---|
| [`telegram/`](telegram/README.zh.md) | Telegram Bot API 通道：白名单会话、按聊天路由会话、最终回复投递 |
