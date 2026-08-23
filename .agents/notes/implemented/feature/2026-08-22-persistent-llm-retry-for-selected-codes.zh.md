# Agent Note: 针对选定失败 code 的持久 LLM 重试

Status: implemented

[English](2026-08-22-persistent-llm-retry-for-selected-codes.md) | 中文

## Problem

每条提供方路由都携带由 `dsh-llm-retry` 在 `agent/request-error` 上执行的有界重试策略（见 [bounded LLM request recovery](../architecture/2026-06-21-bounded-llm-request-recovery.zh.md)）。当某提供方的符合条件的失败——最常见的是 `EMPTY_RESPONSE`，即适配器对未产生任何内容的退化完成响应的分类——超过该预算时，步骤以终端错误结束。`mode: 'always'` 可以无限制重试，但对 code 无感知：它也会永远重试 `AUTH` 这类永久失败。钉住不稳定但免费路由的部署希望只为近似瞬时的 code 提供无上限的持久重试，既无预算，也无模型回退。

## Decision

发布 `@deepseek-ai/dsh-llm-persist`，一个在同一个 `agent/request-error` waterfall 上注册于 `dsh-llm-retry` 之后的函数插件。有界策略总是先执行；只有在其委托或用尽预算时，本插件才会接管它配置的 `providers` 与 `codes`，以带上限的指数退避与对称 jitter 重试相同的提供方/模型请求，直到成功、轮次中止或插件 dispose。它绝不切换提供方或模型。

配置位于热重载的 `llm-persist:` 用户设置节：`providers`（默认空——未配置时插件不起作用）、`codes`（默认 `[EMPTY_RESPONSE]`）与 `backoff`（默认 2000 ms 起步、30000 ms 上限、0.2 jitter）。每次调度的等待都会追加不进入表层的持久 `llm/persist` 事件（共享 `retryId`、提供方、code、规范配置 key、失败与延迟），完成后追加 `llm/persist-started`；退避期间取消则不写入 started 事件。载荷类型通过包的 `./types` 子路径提供给浏览器使用，包的 `./invariant` 配套模块校验轮次/步骤位置、链式编号、`retryId` 连续性、started 配对与延迟边界。有效的 `providerRetryAfterMs` 不超过 `maxDelayMs` 时替换本地退避；超出上限的提供方延迟回落到本地退避，确保持久重试不会因该指令而终止。

## Consequences

- 插件在 `dsh-llm-retry` 之后加入 base bundle；注册顺序即是有界阶段与无界阶段之间的组合契约。
- 持久重试在设计上无上限：若某提供方对符合条件的 code 永久失败，步骤会保持开启，直到轮次被取消。钉住不可靠路由的部署需自行承担该延迟与成本；有界阶段会先吸收普通瞬时抖动。
- 会话词汇表新增两种持久事件类型（`llm/persist`、`llm/persist-started`），已重新生成进 `known-event-types.ts` 与持久化目录；由于插件随 base bundle 发布，每个产品构建都认识它们。
- 从 `codes` 中删除某 code 会开启新的重试链（规范配置 key 包含排序后的 codes）；仅调整 code 顺序不会。

## Alternatives considered

- **在提供方 retryPolicy 上使用 `mode: 'always'`** — 否决：它会重试每个模型请求失败，因此认证、配额与无效请求失败会与瞬时空响应一起无限制重试。
- **扩展 `dsh-llm-retry`，加入按 code 区分的 always 变体** — 否决：这会扩大已发布包的策略词汇表及其按提供方的配置面，而独立插件可以在不动有界执行器的前提下满足该消费方。
- **重试用尽后回退到其他模型** — 否决：切换模型会悄悄改变操作者钉住的表层；持久重试改为让被钉住的请求保持存活，提供方真正死亡时操作者可以取消轮次。
- **在适配器内部重试（pi-ai 的 `retryProviderRequest`）** — 否决：该层只重试抛出的传输错误；成功但没有内容的 HTTP 响应会以完成响应到达 harness，只有 loop 级恢复扩展点能对其进行分类。
