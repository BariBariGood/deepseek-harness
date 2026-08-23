# @deepseek-ai/dsh-host-usage

[English](README.md) | 中文

面向 Web 用量面板的已连接提供商账单状态。`UsageGateway` 注册 `usage` 服务并发布一个生成的直接 Remote `usage/get`。每次调用都会通过可选的凭据接缝解析两个提供商的凭据引用（接缝缺省时回退到启动环境），并行携带 Bearer 凭据请求各提供商的用量端点，并为每个提供商返回一份报告。

OpenRouter 从 `https://openrouter.ai/api/v1/credits` 报告额度总量（`totalCredits`/`totalUsage`，美元）；OpenCode Go 从 `https://opencode.ai/zen/go/v1/usage` 报告其限流窗口，映射为固定的 `5h`/`weekly`/`monthly` 标识。各报告相互独立：缺少密钥读作 `unconfigured`，任何传输或解析失败都成为该提供商的 `error` 条目并携带可展示的消息，二者都不会使端点失败。本服务不持有缓存或历史——每次调用都是一次全新投影。公开载荷类型位于 `./types`；Typert 生成经 `./typert` 与 `./remote` 暴露的 Host 与 Client Remote 工件。

客户端包经由显式的 [`api-remotes`](../../api/remotes/README.zh.md) 装配消费它，而不是导入 Host 实现。

## Config

| 键 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `15000` | 单个提供商请求超过该毫秒数即中止。 |

## Model Experience

无：此 Host 侧的账单投影不注册任何提示段、工具、消息或提供商请求。

#### KV Cache 效应

无；本包从不组装模型输入。

## 已知限制与延后工作

- **无订阅** —— 面板按打开/刷新轮询；没有推送通道或持久失败历史。
- **两个硬编码的提供商端点** —— OpenRouter credits 与 OpenCode Go usage 的 URL 是外部规格常量；接入其他提供商需要改代码而非配置。
