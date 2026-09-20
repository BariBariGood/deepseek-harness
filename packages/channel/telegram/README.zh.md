---
description: "将已加入白名单的聊天通过 Telegram Bot API 中继到持久会话的通道。"
kind: "package-reference"
---

# @deepseek-ai/dsh-channel-telegram

[English](README.md) | 中文

## 概述

通往 agent 的 Telegram 通道：通过 Bot API 长轮询并将白名单聊天中继到持久会话。会话按聊天与话题键控，携带 origin telegram，并通过节流编辑流式回复。

## 目录

- 概述
- 模型体验
- 已知限制与延期工作
- 开发备注

## 模型体验

无，本包是进入 agent 工厂的传输层；最终会话中面向模型的一切由组装后的 preset 决定。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

- **入站仅支持文本** — 媒体、贴纸与编辑后的消息会被丢弃；媒体管线等待真正需要它的消费者。
- **单 bot token** — 每个部署一个凭据；多租户 token 池不在范围内。

<a id="dev-note"></a>
### 开发备注

实现细节与维护说明。
