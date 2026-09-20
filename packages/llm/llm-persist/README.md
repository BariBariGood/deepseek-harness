---
description: "Provider-pinned unbounded retry persistence for selected LLM failure codes that outlives the bounded retry budget."
kind: "package-reference"
---

# `@deepseek-ai/dsh-llm-persist`

English | [中文](README.zh.md)

## Summary

Provider-pinned unbounded retry persistence for selected LLM failure codes. It runs behind the bounded retry policy and keeps retrying the same provider until success or abort.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

## Model Experience

### Persistent request recovery

#### What the model sees

No persist event, delay, or provider error is model-visible. Each retry re-dispatches the same assembled request through the llm adapter waterfall; the durable `llm/persist` events record the schedule without entering derived messages.

#### Token effect

Each retry is a new provider request and may repeat input-token billing. The configured code list has no retry cap, so an outage keeps consuming requests until success or cancellation. `llm/persist` itself contributes no tokens.

#### KV Cache effect

The retried request re-enters the adapter unchanged, so provider-side prefix caching sees the identical request body under that provider's rules.

## Known Limitations and Deferred Work

- **Synchronous log reads** — the persist lookup and invariant inspect the log through the deprecated synchronous snapshot reader; the async handle-based read is the migration path.

<a id="dev-note"></a>
### Dev Note

Implementation details and maintenance notes.
