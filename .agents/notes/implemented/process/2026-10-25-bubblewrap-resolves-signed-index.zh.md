# Agent Note: bubblewrap payload resolves through the signed index chain

Status: implemented

[English](2026-10-25-bubblewrap-resolves-signed-index.md) | 中文

## Problem

`scripts/prepare-ci-bubblewrap.sh` 原本把单个 `.deb` 版本连同其 SHA256 钉死，再从 `archive.ubuntu.com` 的 pool 拉取。pool 里每个 pocket 只保留最新的点发布：当 `0.9.0-1ubuntu0.3` 取代 `0.9.0-1ubuntu0.1` 时，钉死的 URL 开始返回 404，所有定时运行的 `E2E (real DeepSeek API)` 都在套件启动前失败。我方代码零改动，夜间信号却断了数周——这个 pin 是一颗任何归档安全更新都可能再次引爆的定时炸弹。

## Decision

脚本改为沿 apt 所走的同一条信任链来解析 payload，而不再钉版本。它从 `/etc/os-release` 读取发行版 codename，拉取 `<codename>-updates` 的 `InRelease`（缺失时回落到发行 pocket），用 runner 镜像自带的 `ubuntu-archive-keyring` 以 `gpgv` 验证其签名，从已签名正文中读出 `main/binary-amd64/Packages.xz` 的摘要，下载并校验该索引，再从中读取 `bubblewrap` 段落的 `Filename` 与 `SHA256`。随后从 `pool/` 下载 deb、按该摘要校验，然后执行与之前相同的 `dpkg-deb --extract` 与功能探针。

每个产物都对着一个已签名或已校验摘要的父级做检查，因此完整性强度与原先硬编码哈希持平，而解析到的版本现在随归档滚动。某个 pocket 缺少该段落时落到下一个 pocket；两个都耗尽或 keyring 缺失时**响亮失败**。

## Alternatives considered

**把 pin 抬到当前 pool 版本。** 一行改动、立刻转绿，但下一次归档更新会重演同样的轮替——修复必须拆掉腐化机制，而不是换个引信。

**`apt-get download bubblewrap`。** 三行就把解析与校验交给 apt，但会失去固定版本属性，还多一次 `apt-get update` 往返；更重要的是它把工具链准备混进 apt 语义（候选选择、`trusted=yes` 边界情形），而不是明确声明我们取哪个 payload、如何校验。只有当索引走查被证明脆弱时才值得考虑。

**snapshot.ubuntu.com 固定 URL。** 该快照服务当前一律返回 401，不是 CI 可依赖的取件端点。

## Consequences

夜间 e2e 现在按归档当前提供的点发布准备 bubblewrap，下一次轮替不再是事件而是无感——脚本~50 行 awk/curl 管道换来这一点。codename 从 runner 读取而非硬编码，`ubuntu-latest` 镜像漂移被自动吸收；`/etc/os-release` 或 keyring 偏离预期的 runner 会在前置检查处失败，而不是下载一个无法验证的 payload。末尾的功能探针依旧裁决解析出的 payload 是否真能沙箱——解析只改变我们拿到哪个 deb，不改变是否信任它能工作。
