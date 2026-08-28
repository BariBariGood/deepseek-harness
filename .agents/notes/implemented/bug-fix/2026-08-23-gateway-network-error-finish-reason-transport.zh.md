# Agent Note：将网关的 finish_reason network_error 归类为传输错误

Status: implemented

[English](2026-08-23-gateway-network-error-finish-reason-transport.md) | 中文

## 问题

部分兼容 OpenAI 的网关在上游连接中断时，不会抛出 fetch 错误，而是返回一条格式完好的流式完成，其终止 `finish_reason` 为非标准值 `network_error`（在 OpenCode Zen Go 的 `/zen/go/v1` 线路上观察到）。pi-ai 会把该 finish reason 映射为一段通用错误消息，而 pi-ai 适配器的分类器没有匹配到任何传输类措辞，于是该失败落入 `PI_AI_ERROR` 兜底分类。没有任何默认重试策略包含 `PI_AI_ERROR`，因此生成中途的一次连接抖动就让一个原本健康的长时间智能体回合以零重试告终——在发出 100 多次模型请求的回合里，接近百分之一的单次请求失败率就足以稳定地终结大多数长回合。持久会话轨迹清楚地呈现了这一形态：约 150 步干净的 tool-call，随后一次 `Provider finish_reason: network_error` 终止，回合结束。

## 决策

`classifyPiAiError` 在既有的 TRANSPORT 分支中新增一个备选项，匹配 `finish_reason: network_error` 的措辞。该失败由此进入默认重试策略的 `TRANSPORT`——每个已发布策略都已把该代码视为可重试——而提供商策略可以像对待其他传输失败一样对其进行调优。分类器刻意保持文本匹配：pi-ai 仍把终止错误扁平化为散文（见函数上方既有 XXX 注释），因此在这一接缝处拿不到结构化的上游代码。措辞由与其他传输措辞并列的测试用例固定。

## Consequences

`network_error` 加入被固定的传输词汇表，因此上游 pi-ai 更新若改写该措辞，需要重新审视此匹配器——分类器上方的既有 XXX 注释承载着这一职责。回合现在能挺过瞬时的网关断连，代价是按策略预算重试真正已死的端点，而每个已发布策略都已为 `TRANSPORT` 定价。

## Alternatives considered

**宽泛重试 `PI_AI_ERROR`。** 对未知的模型级失败反复重试，可能在真正不可重试的条件上循环；这类失败的归属在分类器，而不在预算。

**在 pi-ai 层映射。** finish reason 的映射位于 vendored 依赖内，且其扁平化散文正是本适配器已文档化的契约；在那里打补丁无法惠及以不同措辞表达同类断连的其他网关。

**按 EMPTY_RESPONSE 处理。** 断开的流没有产生任何持久内容，但把两者混为一谈会模糊 `EMPTY_RESPONSE` 所文档化的退化完成语义。
