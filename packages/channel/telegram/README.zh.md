# @deepseek-ai/dsh-channel-telegram

[English](README.md) | 中文

通往 agent 的 Telegram 通道：一个 bot token 长轮询 Bot API，并把加入白名单的会话中继到持久 agent 会话。插件每次启动时经可选凭据接缝解析 token（`TELEGRAM_BOT_TOKEN` 引用，回退启动环境）；没有 token 时记录空闲警告，而不是使整个 surface 失败。

每个会话键（私聊 `<chat>`、论坛话题 `<chat>:<topic>`）确定性地映射到经 `ctx.agents.create` 创建的会话 id，因此该会话与其他网页创建的会话一样加入默认 preset 组合，并在 header 携带 origin `telegram`。回合按会话串行：第二条消息排在运行中回合之后，而不是交错。回复以单条草稿消息按节流编辑流式输出——提交前快照日志，`whenIdle()` 后折叠，经会话存储 flush 做检查点，最终文本落在同一气泡中，回合期间显示输入指示器。`/new` 把会话重映射到新一代后缀的会话，`/model` 查看或切换本会话的模型，`/help` 本地应答，群聊仅响应命令或 @提及，且白名单默认拒绝所有用户。

## 快速开始

1. 在 [@BotFather](https://t.me/BotFather) 用 `/newbot` 创建 bot 并复制 token。
2. 通过以下任一方式提供 token：
   - 应用 **Models 页面**的凭据存储，引用名 `TELEGRAM_BOT_TOKEN`；或
   - 启动环境中的 `TELEGRAM_BOT_TOKEN=…`。
3. 挂载插件（默认 surface 组合已包含）并启动应用；启动日志会打印 `polling as @<username> for N allowed user(s)`。
4. 用自己的账号给 bot 发消息。白名单默认拒绝所有人，所以先把自己加进去：获取你的数字 id（发任意消息后从服务端日志的 rejected-update 行读取，或询问 @userinfobot），填入插件的 `allowedUserIds` 配置列表，然后重启一次。
5. 会话内冒烟验证：`/help` 列出命令，`/model` 显示当前模型及部署暴露的全部 provider/model 路由，`/model <provider/model>` 切换本会话（`/model flash` 这类裸名模糊匹配；有歧义时列出候选），`/new` 开启全新对话。

## Model Experience

无：本通道不注册自己的提示段、工具、消息或提供商请求；它驱动的会话承载所组合 preset 的模型可见面。每会话的 `/model` 覆盖经 `llm.resolveCallConfig` 重路由下一个回合，无需重建会话。

#### KV Cache 效应

无直接影响；被中继的用户文本与输入框输入完全一样进入其会话历史。

## 已知限制与延后工作

- **纯文本草稿** —— 回复以一条节流编辑的消息流式呈现；媒体收发、语音转写与内联选择器仍在范围之外。
- **无配对流程** —— 在所有者扩展列表之前仅有白名单访问；未知用户被静默忽略。
- **冷恢复加入当前默认组合**，而非重建已记录的组合。
