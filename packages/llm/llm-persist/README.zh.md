---
description: "面向选定 LLM 失败码的、固定重试预算之外的提供商钉选无限重试持久化。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-llm-persist`

[English](README.md) | 中文

## 概述

面向选定 LLM 失败码的提供商钉选无限重试持久化。位于固定重试策略之后，持续重试同一提供商直至成功或中止。

## 目录

- 概述
- 模型体验
- 已知限制与延期工作
- 开发备注

## 模型体验

### 持久化请求恢复

#### 模型看到什么

无 persist 事件、延迟或 provider 错误对模型可见。每次重试都把同一个已组装的请求重新送回 llm adapter 瀑布；持久的 `llm/persist` 事件只记录重试计划，不进入派生消息。

#### Token 影响

每次重试都是新的 provider 请求，可能重复计费输入 token。配置的代码列表没有重试上限，故障期间会持续消耗请求直至成功或取消。`llm/persist` 本身不贡献 token。

#### KV Cache 影响

重试的请求原样重新进入 adapter，provider 侧前缀缓存按其自身规则看到完全相同的请求体。

## 已知限制与延期工作

- **同步日志读取** — persist 查找与 invariant 通过已弃用的同步快照读取器检查日志；异步 handle 读取是迁移路径。

<a id="dev-note"></a>
### 开发备注

实现细节与维护说明。
