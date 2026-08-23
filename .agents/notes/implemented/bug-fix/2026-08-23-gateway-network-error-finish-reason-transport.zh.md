# Agent Note：将网关的 finish_reason network_error 归类为传输错误

Status: implemented

[English](2026-08-23-gateway-network-error-finish-reason-transport.md) | 中文

## 问题

部分兼容 OpenAI 的网关在上游连接中断时，不会抛出 fetch 错误，而是返回一条格式完好的流式完成，其终止 `finish_reason` 为非标准值 `network_error`（在 OpenCode Zen Go 的 `/zen/go/v1` 线路上观察到）。pi-ai 会把该 finish reason 映射为一段通用错误消息，而 pi-ai 适配器的分类器没有匹配到任何传输类措辞，于是该失败落入了 `PI_AI_ERROR` 兜底分类。没有任何默认重试策略包含 `PI_AI_ERROR`，因此生成中途的一次连接抖动就让一个原本健康的长时间智能体回合以零重试告终——在发出 100 多次模型请求的回合里，接近百分之一的单次请求失败率就足以稳定地终结大多数长回合。持久会话轨迹清楚地呈现了这一形态：约 150 步干净的 tool-call，随后一次 `Provider finish_reason: network_error` 终止，回合结束。

## 决策

`classifyPiAiError` 在既有的 TRANSPORT 分支中新增一个匹配项，识别 `finish_reason: network_error` 措辞。该失败因此会以 `TRANSPORT` 进入默认重试策略——所有已发布的策略都已将 `TRANSPORT` 视为可重试——提供方策略也可以像调其他传输失败一样对其进行调整。分类器仍刻意基于文本匹配：pi-ai 依然把终止错误压平为纯文本（见该函数上方已有的 XXX 注释），在这一接缝处拿不到结构化的上游错误码。该措辞由一条与其他传输措辞并列的测试用例固定下来。

## 已考虑的替代方案

**大范围重试 `PI_AI_ERROR`。** 重试未知的模型级失败可能在真正不可重试的条件上空转；正确的落点是分类器，而不是重试预算。

**在 pi-ai 层映射。** finish reason 的映射位于 vendored 依赖内，而压平后的文本正是该适配器已文档化的契约；在那里打补丁也无法覆盖以其他措辞表达同类断连的网关。

**视为 EMPTY_RESPONSE。** 被中断的流确实没有产生持久内容，但把两者混为一谈会模糊 `EMPTY_RESPONSE` 所文档化的"退化完成"语义。
