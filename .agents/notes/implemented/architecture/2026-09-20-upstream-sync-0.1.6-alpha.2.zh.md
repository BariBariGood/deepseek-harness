# Agent Note：上游同步至 dsh 0.1.6-alpha.2 后，telegram origin 保留为字段级的 fork 词汇

Status: implemented

[English](2026-09-20-upstream-sync-0.1.6-alpha.2.md) | 中文

## Problem

本 fork 携带四个自定义包（channel/telegram、host/usage、client/ui-usage、llm/llm-persist）和一处对共享 session 栈的有意分歧：`SessionOrigin` 包含 `'telegram'`，且 telegram 通道在它创建的每个会话上打上该标记，供 Web 侧栏对 bot 会话分组。上游的持久化类型历史门禁（`verify-persistence-changes`，在 fork 的 0.1.2-alpha.2 基线之后引入）把该放宽归类为需要版本号提升的持久化变更，在历史中记录真实的 `SESSION_FORMAT_VERSION` 迁移之前拒绝整棵树。

## Decision

**保留字段放宽；排除的是门禁，不是规则本身。** 本次同步合入 upstream/master（dsh-v0.1.6-alpha.2），并端到端保留 `origin: 'telegram'`——会话 header 校验、JSONL header 行、format-catalog 逻辑 header、session-log-deepseek 的 wire header、session-controller 摘要。fork 本地把格式升到 4 会在上游开发最活跃的 seam（格式目录、迁移、快照期望）里埋下永久冲突面，却换不到任何互操作收益：不认识 `'telegram'` 的读取方已经在字段校验时响亮地拒绝该日志，其可观察行为与版本号拒绝一致。因此仅在 `scripts/run-gates.ts` 的 `doc-sync` 中单独移除 `verify-persistence-changes`，并注明回指本备注；其余持久化门禁（catalog、releases、formats、session-format-catalog）照常运行且全部通过。

**其余适配一律跟随上游。** 3599 个提交的增量更换了播种 API（`seedLength` → `isSeeded` + `inheritedEventCount`）、让 agent 创建变为 await、把会话读取移到已弃用的 `snapshotEvents()` 之下（逐行抑制并配一条已知限制，直至迁移到 handle 读取）、删除了 sqlite 持久化后端（连同 llm-persist 对它的过期 devDependency），并重构了客户端基础组件。fork 包已移植到这些 API 之上；没有引入任何垫层。

## Testing

fork 包测试（telegram relay/transport、llm-persist persist/invariant/composition、host usage、ui-usage、ui-workspace tree、ui-model-selection）357/357 通过；仓库 typecheck、oxlint 与 `doc-sync`（除被排除的门禁外）全部干净。生成的目录（config、tool、cordis API、persistence、doc graphs）已从合并后的源码重新生成，受本次同步影响的双语对均已重新记录。

## Consequences

未来的上游同步会命中一组已知冲突点：`doc-sync` 门禁清单（保留排除）、六处 `origin` 放宽位点（重新套用放宽）、以及生成的目录（重新生成）。如果上游未来发布自己的多值 `SessionOrigin`，fork 的联合类型与门禁排除一并坍缩进去。如果 telegram 通道今后需要第二个持久化字段，那就是重新审视字段级立场、考虑真实 fork 格式升版的时机。

## Alternatives considered

**fork 本地 `SESSION_FORMAT_VERSION = 4` 配恒等 v3-to-v4 迁移。** 否决：需要照搬上游 v2-to-v3 的约 700 行迁移机制；上游发布自己的 v4 时必然冲突；互操作性反而更差——上游构建会在版本检查处拒绝所有 fork 日志，而不只是 telegram-origin 日志在字段检查处被拒。

**重设计特性以放弃持久化标记**（通道经 Remote 发布 chat 到 session 的注册表；侧栏查询它）。本次同步否决：它会在合并节点重写一个已验证可用的特性，且没有真实 bot 的验证路径；若排除门禁未来真的造成漂移问题，再回到这个方案。
