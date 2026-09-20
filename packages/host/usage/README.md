---
description: "Host usage billing projection for OpenRouter and OpenCode Go that powers the web usage panel."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-usage

English | [中文](README.zh.md)

## Summary

Host usage billing projection for OpenRouter and OpenCode Go. UsageGateway exposes usage/get that fetches both providers in parallel and returns independent reports.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

## Model Experience

None, as the gateway reads billing endpoints and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Two fixed providers** — the report roster is the OpenRouter/OpenCode Go pair this deployment uses; a provider roster configuration waits for a third billing surface.

<a id="dev-note"></a>
### Dev Note

Implementation details and maintenance notes.
