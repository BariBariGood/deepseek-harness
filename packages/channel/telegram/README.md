# @deepseek-ai/dsh-channel-telegram

English | [中文](README.zh.md)

Telegram channel into the agent: one bot token long-polls the Bot API and relays allowlisted chats into durable agent sessions. The plugin resolves its token per start through the optional credentials seam (`TELEGRAM_BOT_TOKEN` ref, launch-environment fallback); without a token it logs an idle warning instead of failing the surface.

Each chat key (`<chat>` direct, `<chat>:<topic>` for forum topics) maps deterministically to a session id minted through `ctx.agents.create`, so the session joins the default preset composition like every web-created session and carries header origin `telegram`. Turns serialize per chat: a second message queues behind the running turn rather than interleaving. Replies are pulled after quiescence — the log is snapshotted before submission, folded at `whenIdle()`, checkpointed via the session store flush, and the last committed assistant text goes back as one Telegram message with typing indicators while the turn runs. `/new` remaps the chat to a fresh generation-suffixed session, `/help` answers locally, groups answer only commands or bot mentions, and the allowlist denies every user by default.

## Model Experience

None, as this channel registers no prompt section, tool, message, or provider request of its own; the sessions it drives carry the composed preset's model-facing surface.

#### KV Cache effect

None directly; relayed user texts enter their sessions' history exactly like composer input.

## Known Limitations and Deferred Work

- **Final-text delivery only** — no streaming message edits, media inbound/outbound, voice transcription, or inline pickers yet.
- **No pairing flow** — access is allowlist-only until the owner extends the list; unknown users are silently ignored.
- **Cold resume joins the current default composition** rather than reconstructing the recorded one.
