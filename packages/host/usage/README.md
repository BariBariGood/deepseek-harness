# @deepseek-ai/dsh-host-usage

English | [中文](README.zh.md)

Connected-provider billing state for the web usage panel. `UsageGateway` registers the `usage` service and publishes one generated direct Remote, `usage/get`. Every call resolves both providers' credential refs through the optional credentials seam (falling back to the launch environment when the seam is absent), fetches each provider's usage endpoint in parallel with a bearer credential, and returns one report per provider.

OpenRouter reports credit totals (`totalCredits`/`totalUsage`, US dollars) from `https://openrouter.ai/api/v1/credits`; OpenCode Go reports its rate-limit windows from `https://opencode.ai/zen/go/v1/usage`, mapped to fixed `5h`/`weekly`/`monthly` ids. Reports are independent by construction: a missing key reads as `unconfigured`, any transport or parse failure becomes that provider's `error` entry carrying a display-safe message, and neither can fail the endpoint. The service owns no cache or history — each call is a fresh projection. Its public payload types live under `./types`; Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

## Config

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `15000` | Abort one provider request after this many milliseconds. |

## Model Experience

None, as this Host-side billing projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **No subscription** — the panel polls per open/refresh; there is no push channel or durable failure history.
- **Two hardcoded provider endpoints** — OpenRouter credits and OpenCode Go usage URLs are external spec constants; other providers need code, not configuration.
