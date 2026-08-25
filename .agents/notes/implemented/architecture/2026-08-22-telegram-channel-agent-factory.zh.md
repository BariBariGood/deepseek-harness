# Agent Note：Telegram 通道挂在 agent 工厂上，而不是会话存储

Status: implemented

[English](2026-08-22-telegram-channel-agent-factory.md) | 中文

## Problem

为 agent 打开消息平台入口（先做 Telegram，镜像 hermes-agent 的 gateway）需要在不破坏既有不变量的情况下接好三件事：比单次请求更长久的入站传输、跨重启存活的会话↔聊天映射、以及送达用户的回复。诱人的捷径是 `ctx.sessions.create` 加手动事件监听——但存储自身的 JSDoc 拒绝这条路：在中继 fiber 上创建的会话会随错误的生命周期拆除，与循环的有序发布相互竞争。

第二个压力是访问控制。回复任何来消息者的 bot 相当于宿主机器上的远程代码执行端点，因此鉴权必须默认拒绝，并在未配置时失败关闭。

## Decision

**会话只经 `ctx.agents.create`/`resume` 铸造。** 中继维护每聊天键（`tg-<chat>`、论坛话题 `<chat>:<topic>`）到确定性会话 id 的映射，并镜像 apiproxy 的 `ensureSession`：活跃复用，否则带 preset 组合 setup 的新建。`/new` 递增代计数而不是销毁任何东西——上一段对话作为历史留在侧栏，这正是消息用户对"新聊天"的预期。

**授权默认拒绝并读取共享凭据面。** token 每次启动经凭据接缝在 `TELEGRAM_BOT_TOKEN` 引用下解析（回退启动环境），绝不在导入期读取；没有 token 时插件记录一条警告并保持空闲，而不是拖垮它挂载的 surface。空白名单不回应任何人。群聊额外要求斜杠命令或 bot 提及（hermes 的提及门控），潜伏的 bot 不会插嘴闲聊。

**回复以单条节流草稿气泡流式输出。** 每回合在 `followup` 前快照日志 seq，首段折叠文本一出现就发送，并对同一条消息按节流编辑直到 `whenIdle`；最终折叠是权威结果并经会话存储 flush 做检查点。被拒绝的编辑（相同文本、瞬时 429）保留草稿 id，下一跳继续编辑而不是重复发送。阻塞的回合绝不冻结轮询循环：handler 不等待地触发，中继按会话串行回合。

**模型选择是每聊天覆盖，不是新会话。** `/model` 镜像 hermes 的斜杠 UX：裸命令显示当前模型加 `llm` 的全部路由，`provider/model` 经 `resolveCallConfig` 校验后精确切换，裸名模糊匹配、有歧义时列出候选。选择保存在 `ChatState`，穿入 `ctx.agents.create`，并在 agent 的 setup 窗口安装 `ModelSelectionRef`——会话中途切换只改动引用即可重路由下一个回合，无需重建会话或丢失历史。

**Origin 是加宽的联合，不是新字段。** `SessionHeader.origin` 变为 `SessionOrigin = 'subagent' | 'telegram'`；每个校验器（header 检查、jsonl 编解码、sqlite 列检查、两个 zod wire schema）同时接受两个值，而所有 `'subagent'` 比较保持原义。侧栏的工作区树在其唯一可见性收口处排除 telegram 行，并在专属可折叠小节中渲染它们——与 hermes 按平台划分的侧栏小节同构。

## Testing

`packages/channel/telegram/tests/transport.spec.ts` 覆盖 Bot API 客户端（信封解包、类型化 429/409 错误、token 作用域 URL）、归一化（snake_case `update_id` 映射、bot/空丢弃、话题键、提及门控）和轮询循环（有序 offset 推进、retry-after 退避、冲突浮现、干净中止）。`tests/relay.spec.ts` 在假服务上驱动中继：确定性 id 与代后缀、复用、白名单拒绝、`/new` 与 `/help`、按会话串行、异常原因后缀、草稿流式，以及 `/model` 矩阵（列表、精确切换、模糊匹配、歧义、未命中）。`packages/client/ui-workspace/tests/tree.client.spec.ts` 断言分区（telegram 行离开 groups/flat、最新优先、归档/空白处理）。

## Consequences

下一个平台意味着一个复用 `TelegramRelay` 形状的兄弟包加上自己的传输——会话路由契约除 id 前缀外已平台中立。本通道对媒体、reaction 和流式编辑保持沉默；其中每一项都落为 `types.ts` 的扩展加一处 adapter 关注点，而不是核心改动。

## Alternatives considered

**现在就建通用消息平台接缝**（Service Definition + provider + consumer）。暂不采纳：只有一个已实现平台时接缝只能靠猜测，很可能猜错；relay 类已经是可复用部分。第二个平台出现时再议。

**逐 chunk `sendMessage`+`editMessageText` 流式。** 延后：速率限制使朴素编辑代价高，且折叠点已为 hermes 式带节流的草稿消费者保留。

**未知用户的配对码。** 延后：白名单加 Models 页已覆盖当前单所有者部署；配对需要属于自己的设计的审批面。
