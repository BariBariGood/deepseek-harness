# @deepseek-ai/dsh-channel-telegram

English | [中文](README.zh.md)

Telegram channel into the agent: one bot token long-polls the Bot API and relays allowlisted chats into durable agent sessions. The plugin resolves its token per start through the optional credentials seam (`TELEGRAM_BOT_TOKEN` ref, launch-environment fallback); without a token it logs an idle warning instead of failing the surface.

Each chat key (`<chat>` direct, `<chat>:<topic>` for forum topics) maps deterministically to a session id minted through `ctx.agents.create`, so the session joins the default preset composition like every web-created session and carries header origin `telegram`. Turns serialize per chat: a second message queues behind the running turn rather than interleaving. Replies stream as one draft message edited on a throttle — the log is snapshotted before submission, folded at `whenIdle()`, checkpointed via the session store flush, and the final text lands in the same bubble with typing indicators while the turn runs. `/new` remaps the chat to a fresh generation-suffixed session, `/model` shows or switches the chat's model, `/help` answers locally, groups answer only commands or bot mentions, and the allowlist denies every user by default.

## Getting started

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and copy the token.
2. Provide the token through one of:
   - the app's **Models page** credential store under the ref `TELEGRAM_BOT_TOKEN`, or
   - `TELEGRAM_BOT_TOKEN=…` in the launch environment.
3. Mount the plugin (it ships in the default surface composition) and start the app; the startup log prints `polling as @<username> for N allowed user(s)`.
4. Message the bot from your own account. The allowlist denies everyone by default, so add yourself: find your numeric id (send any message, then read it from the server log's rejected-update line, or ask @userinfobot) and put it in the plugin's `allowedUserIds` config list. Restart once.
5. Sanity check in chat: `/help` lists commands, `/model` shows the active model plus every provider/model route the deployment exposes, `/model <provider/model>` switches this chat (bare names like `/model flash` fuzzy-match; ambiguity lists candidates), `/new` starts a fresh conversation.

## Model Experience

None, as this channel registers no prompt section, tool, message, or provider request of its own; the sessions it drives carry the composed preset's model-facing surface. The per-chat `/model` override re-routes the next turn through `llm.resolveCallConfig` without recreating the session.

#### KV Cache effect

None directly; relayed user texts enter their sessions' history exactly like composer input.

## Known Limitations and Deferred Work

- **Text-only drafts** — replies stream as one throttled edited message; media inbound/outbound, voice transcription, and inline pickers are still out of scope.
- **No pairing flow** — access is allowlist-only until the owner extends the list; unknown users are silently ignored.
- **Cold resume joins the current default composition** rather than reconstructing the recorded one.
