# Agent Note: Classify gateway finish_reason network_error as transport

Status: implemented

English | [中文](2026-08-23-gateway-network-error-finish-reason-transport.zh.md)

## Problem

Some OpenAI-compatible gateways report a dropped upstream connection as a well-formed streaming completion whose terminal `finish_reason` is the non-standard value `network_error` (observed on OpenCode Zen Go's `/zen/go/v1` lane) instead of surfacing the drop as a thrown fetch error. pi-ai maps that finish reason to a generic error message, and the pi-ai adapter's classifier matched none of its transport wording, so the failure landed on the `PI_AI_ERROR` fallback. `PI_AI_ERROR` is in no default retry policy, so one mid-generation connection blip killed an otherwise healthy long agentic turn with zero retries — on turns issuing 100+ model requests, a per-request drop rate near one percent reliably terminated most long turns. The durable session traces showed the shape plainly: roughly 150 clean tool-call steps, a single `Provider finish_reason: network_error` finish, turn end.

## Decision

`classifyPiAiError` gains one alternative in its existing TRANSPORT branch, matching `finish_reason: network_error` prose. The failure therefore reaches the default retry policy under `TRANSPORT` — a code every shipped policy already treats as retryable — and provider policies can tune it like any transport failure. The classifier stays textual on purpose: pi-ai still flattens terminal errors to prose (see the existing XXX note above the function), so a structured upstream code is not available at this seam. The wording is pinned by a test case alongside the other transport phrasings.

## Consequences

`network_error` joins the pinned transport vocabulary, so vendored pi-ai updates that rephrase the prose will need this matcher revisited — the existing XXX note above the classifier is where that duty lives. Turns now survive transient gateway drops at the cost of retrying genuinely dead endpoints up to the policy budget, which every shipped policy already prices for `TRANSPORT`.

## Alternatives considered

**Retry `PI_AI_ERROR` broadly.** Repeating an unknown model-level failure can loop on genuinely non-retryable conditions; the classifier, not the budget, is where this failure belongs.

**Map at the pi-ai layer.** The finish-reason mapping lives in the vendored dependency, and its flattened prose is the contract this adapter already documents; patching there would not reach other gateways that phrase the same drop differently.

**Treat it as EMPTY_RESPONSE.** A dropped stream produced no durable content, but conflating the two codes would blur the degenerate-completion semantics `EMPTY_RESPONSE` documents.
