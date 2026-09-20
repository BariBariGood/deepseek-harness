---
description: "外部消息通道分组，包含 Telegram 及未来适配器。"
kind: "package-group"
---

# channel/ — 外部消息入口

[English](README.md) | 中文

## Summary

channel 分组把外部消息平台接入 Harness：每个平台一个适配器，拥有自己的传输、长轮询、授权白名单与逐聊天命令面板，并把通过校验的消息作为普通会话交给 agent 工厂。聊天命令（新建会话、切换模型）与 Web 端复用同一批 seam。选择本分组即可从消息应用触达 agent；最终会话中面向模型的一切由组装后的 preset 决定，适配器不介入。

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | Shape |
|---|---|---|
| [`telegram`](telegram/README.zh.md) | 通过 Telegram bot 私聊驱动 agent；无 bot token 时保持空闲 | plugin |

-----

<a id="dev-note"></a>
## Dev Note

<details>

<summary>会话 origin 只是呈现元数据</summary>

由通道创建的会话在持久化 header 中携带 `origin: 'telegram'`，供 Web 侧栏分组使用。该标记仅用于导航：它不证明会话有效，也不证明可以继续；`SessionOrigin` 词表的唯一出处是 dsh-session。

</details>
