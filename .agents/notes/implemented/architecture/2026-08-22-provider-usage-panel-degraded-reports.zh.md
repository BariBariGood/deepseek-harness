# Agent Note：用量面板按提供商降级，而不是让端点失败

Status: implemented

[English](2026-08-22-provider-usage-panel-degraded-reports.md) | 中文

## Problem

Web 侧栏新增了已连接提供商的用量卡片（OpenRouter 额度、OpenCode Go 限流窗口）。两股设计压力在此碰撞。账单端点的故障方式与模型流量不同——没有某个窗口的套餐、轮换密钥后的 401、缓慢的超时——而面板是页脚卡片，必须在任一提供商异常时保持可读。与此同时，这些端点所需的密钥已经存在：`llm-pi-ai` 路由引用 `OPENROUTER_API_KEY` 与 `OPENCODE_GO_API_KEY`，若再以用量专用名称存一份副本，任何一侧轮换时都会失同步。

## Decision

**降级放在载荷里，而不是传输层。** `usage/get` 总是以每个受支持提供商一份报告的形式成功返回；`code` 区分 `ok`、`unconfigured` 与 `error`。缺失的密钥、HTTP 失败或不可解析的响应体都会成为该提供商的条目并携带可展示的消息，因此一个提供商的故障只清空它自己的卡片，不影响其他。客户端渲染到达的任何内容，自身无需重试分类。

**凭据引用复用而非镜像。** 网关通过可选接缝解析 `credentialRef('OPENROUTER_API_KEY')` 与 `credentialRef('OPENCODE_GO_API_KEY')`——正是 pi-ai 路由为推理解析的同一批引用。一份存储的密钥同时服务于模型调用与卡片，轮换保持单点，面板也不新增设置面：缺失的引用读作 `unconfigured`，并指明要在 Models 页写入的引用。

**拉取胜过订阅。** 卡片在每次打开时重新拉取，外加显式刷新按钮；没有推送通道、后台轮询或会话事件。这里没有任何模型可见的内容，因此"模型可见即可记录"规则不会触发，而账单总额的变化节奏使得每次打开的新鲜度胜过穿过 `api-remotes` 接一条转发事件通路。

## Testing

`packages/host/usage/tests/loader-composition.spec.ts` 以桩凭据接缝和桩传输启动真实 Loader：断言端点注册进 `ctx.typert`、ok/unconfigured 混合与全错误快照、无接缝时的启动环境回退，以及 fiber 释放后注册表的撤销。`tests/providers.spec.ts` 覆盖解析器及 bearer/状态码/传输/非 JSON 各分支。客户端侧，`browser-plugin.client.spec.tsx` 在真实 Context 上启动插件，断言信封双向解包与自 `sidebar.footer.action` 的 HMR 安全撤销；`usage-panel.client.spec.tsx` 渲染每种报告形态、打开即刷新、刷新期间保留旧值以及告警呈现。

## Consequences

线路类型是按提供商增长的判别联合，客户端按 `code` 渲染，因此新增提供商触及网关、类型联合和一个渲染分支——从不触及端点的失败契约。可展示的错误消息是主机单独承担的义务：提供商响应体与请求头绝不能进入报告消息。由于报告是纯拉取，一直开着的卡片在交互之前显示冻结数字；刷新入口是决策的一部分，而非修饰。

## Alternatives considered

**共享的配额提供商接缝**（`providers/<name>/usage` 风格，OpenChamber 形状）。暂不采纳：两个载荷各异的消费者撑不起这层抽象，且线路形态差异足够大（额度总量 vs 窗口列表），公共接口只会变成字符串类型化。第三个提供商出现时再议。

**用量专用凭据引用**（`USAGE_OPENROUTER_API_KEY`）。不采纳：存储翻倍、轮换分裂，且 Models 页已拥有对现有引用的写权限。

**用转发的主机事件做实时更新。** 因拉取而不采纳：转发事件允许清单服务的是用户持续注视的状态（运行、流式）；用量数字是被查看的，不是被盯着的。
