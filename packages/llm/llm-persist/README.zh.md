# `@deepseek-ai/dsh-llm-persist`

[English](README.md) | 中文

一个函数插件，在提供方的有界重试策略用尽后继续重试失败的模型请求，并且绝不切换提供方或模型。它在 agent loop 关闭步骤的 `agent/request-error` waterfall（瀑布式事件）上注册于 `dsh-llm-retry` 之后，因此有界策略总是先执行；只有该预算用尽（或不存在）时，本插件才会为它配置的提供方与失败 code 接管恢复。

配置位于用户设置文档的 `llm-persist:` 节，与其他 settings 命名空间一样支持热重载。空配置（默认值）不产生任何行为。`providers` 指明哪些路由持续重试，`codes` 指明哪些失败 code 可无限重试（默认 `[EMPTY_RESPONSE]`，即适配器对未产生任何持久内容的退化提供方完成所作的分类），`backoff` 则是有上限的带对称 jitter 指数退避（默认 2000 ms 起步、30000 ms 上限、0.2 jitter）。

每次持续尝试都先等待有界退避，再用相同的提供方/模型重试请求，直到成功、轮次被取消或插件 dispose。有效的 `providerRetryAfterMs` 不超过 `maxDelayMs` 时替换本地退避且不加 jitter；超出上限的提供方延迟回落到本地退避，确保持续重试不会因该指令而终止。

等待前，插件追加一条不进入表层的 `llm/persist` 事件，包含共享 `retryId`、提供方、进入持续重试的失败 code、已解析配置的规范 key、失败与计划延迟。该载荷由可安全用于浏览器的 `@deepseek-ai/dsh-llm-persist/types` 子路径导出。只有提供方与完整配置 key 都相同的事件才会延续重试编号。等待完成时，插件在返回 `{ kind: 'retry' }` 前立即追加 `llm/persist-started`，其中带有相同的 `retryId`、轮次、步骤与重试编号；退避期间取消则不会写入 started 事件。随后循环关闭失败轮次，并在同一持久历史上开启重试轮次。取消与插件 dispose 会中止活跃退避，并等待活跃恢复结算。

```yaml
- name: '@deepseek-ai/dsh-llm-persist'

llm-persist:
  providers: [zen-go]
  codes: [EMPTY_RESPONSE]
  backoff:
    initialDelayMs: 2000
    maxDelayMs: 30000
    jitterRatio: 0.2
```

本包的 `./invariant` 配套模块会校验每条 `llm/persist` 记录是否位于开启的轮次与步骤内，检查重试链编号与 `retryId` 连续性，要求每个 `llm/persist-started` 对应一条先前调度的尝试，并将所有延迟限制在定时器上限内。

## Model Experience

### Model-request persistence

#### What the model sees

持久事件、延迟、提供方错误与失败的部分输出都不可被模型看到。重试轮次根据持久表层历史重建完全相同的显式提供方/模型请求；失败的 chunk 不会进入派生消息。

#### Token effect

每次持续尝试都是一次新的提供方请求，可能重复计费输入 token，且没有固定预算，只受提供方可靠性与轮次取消约束。`llm/persist` 本身不贡献 token。

#### KV Cache effect

重建的请求保留先前的 prefix，在该提供方规则下可复用提供方缓存。非表层 persist 事件不会改变缓存身份。

## Known Limitations and Deferred Work

- **持续重试在设计上无上限** — 若某提供方对符合条件的 code 永久失败，步骤会一直保持开启，直到轮次被取消；将不可靠路由固定于此的部署需要自行承担相应延迟与成本。`dsh-llm-retry` 的有界阶段会先执行并吸收瞬时抖动。
- **Agent 轮次是唯一的重试边界** — 与 `dsh-llm-retry` 相同，直接消费 `ctx.llm.stream()` 的调用方仍是单次尝试。
- **配置 key 跟踪行为而非 code 顺序** — 规范 key 会先对符合条件的 code 排序，因此调整顺序不会拆分重试链；新增或删除 code 才会。
- **`llm/persist` 记录的是调度而非完成** — 后续步骤与轮次事件才能确定成功或取消。
