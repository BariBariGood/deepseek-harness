---
description: "Client usage panel that renders the host usage Remote in the web sidebar."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-usage

English | [中文](README.zh.md)

## Summary

Client usage panel that renders the host usage Remote in the web sidebar footer and floating panel, polling per open and refresh.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

## Model Experience

None, as the panel is a browser-side provider billing card; usage totals never enter the Session log, model context, or telemetry.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Mirror of the host roster** — the provider list and display titles track dsh-host-usage's fixed pair; a shared roster contract waits for a third provider.

<a id="dev-note"></a>
### Dev Note

Implementation details and maintenance notes.
