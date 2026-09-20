---
description: "在网页侧边栏中渲染主机用量 Remote 的客户端用量面板。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-usage

[English](README.md) | 中文

## 概述

在网页侧边栏底部与浮层中渲染主机用量 Remote 的客户端用量面板，按打开与刷新轮询。

## 目录

- 概述
- 模型体验
- 已知限制与延期工作
- 开发备注

## 模型体验

无，本面板是浏览器侧的 provider 计费卡片；用量数据从不进入 Session 日志、模型上下文或遥测。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与延期工作

- **镜像主机名册** — 提供商列表与显示标题跟随 dsh-host-usage 的固定组合；共享名册契约等待第三家提供商。

<a id="dev-note"></a>
### 开发备注

实现细节与维护说明。
