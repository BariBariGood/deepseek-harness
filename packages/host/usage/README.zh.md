---
description: "为网页用量面板提供 OpenRouter 与 OpenCode Go 计费投影的主机用量。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-usage

[English](README.md) | 中文

## 概述

面向 OpenRouter 与 OpenCode Go 的主机用量计费投影。UsageGateway 暴露 usage/get 并行获取两家用量并返回独立报告。

## 目录

- 概述
- 模型体验
- 已知限制与延期工作
- 开发备注

## 模型体验

无，本网关读取计费端点，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

- **固定两家提供商** — 报告名册就是本部署使用的 OpenRouter/OpenCode Go 组合；提供商名册配置等待第三家计费面。

<a id="dev-note"></a>
### 开发备注

实现细节与维护说明。
