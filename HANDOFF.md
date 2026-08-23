# DSH Customization — Handoff Doc

For the next agent session started with this repo (`~/apps/deepseek-harness`) as its workspace.
Status as of: this session (2026-08-22, ~15:45).

---

## 1. The map — three installs, one home

| Install | Path | Role | Customizations |
|---|---|---|---|
| npx cache (npm install) | `~/.npm/_npx/1e7f6d9597241db0/node_modules` | **retire this** — still serving port 3080 as of this doc | hand-patched compiled JS (search + ox-alpha) |
| **Your fork** (source of truth) | `~/apps/deepseek-harness` | **primary runtime going forward** — built & verified | search (committed), ox-alpha (moved to config) |
| Desktop app (anywhere-labs) | `/Applications/DSH Desktop.app` | consume as-is, never fork | sealed asar — shares `~/.dsh` but ships stock 0.1.1-rc.2 code |

Shared state: `$DSH_HOME` = `~/.dsh` (settings.yaml, .credentials.yaml, profiles/, sessions/, storages/). All three surfaces read it.

## 2. Done

- **Model search** in composer model menu — fork commit `18f4174e7a` (cherry-picked from dustinwloring1988/deepseek-harness `our-branch`, upstream-quality with tests).
- **ox-alpha via OpenCode Zen Go** — the flaky OpenRouter "Stealth" route was retired. `~/.dsh/settings.yaml` declares a hand-declared `zen-go` route (`baseURL: https://opencode.ai/zen/go/v1`, model `ox-alpha-free`, deepseek-compat thinking, retryPolicy maxRetries 15) and the default model is `opencode-go`/`deepseek-v4-pro` @ max. The old `stealth` route and the pi-ai OpenRouter catalog patch were both removed.
- **`@deepseek-ai/dsh-llm-persist`** — new package in `packages/llm/llm-persist` (base bundle, after `llm-retry`): unbounded retry persistence for selected failure codes on pinned providers, configured via a hot-reloaded `llm-persist:` settings section; inert until configured. No model fallback by design. See `.agents/notes/implemented/feature/2026-08-22-persistent-llm-retry-for-selected-codes.md`.
- **Fork build verified**: `pnpm install --frozen-lockfile` + `pnpm run build` pass; built CLI `node apps/cli/lib/bin.js --help` and `--dump-config` work.
- Recoverable backups in `~/apps/dsh-spike/`: `model-search.patch`, `ox-alpha.patch`, `*.orig`, recovered old session transcript (`recovered/`).

## 3. Immediate next steps (user action)

1. **Cut over**: in the terminal running `npm exec @deepseek-ai/dsh web`, Ctrl+C, then:
   ```sh
   cd ~/apps/deepseek-harness && pnpm dsh web
   ```
2. Verify in the GUI: search field in model pane; "Stealth (OpenRouter) → Ox Alpha" group in the model dropdown.
3. The npx-cache install can then be retired (`npx clear npx` whenever).

## 4. Work queue (for the next session in this workspace)

### A. Usage panel — "OpenChamber-style" session side panel

Goal: show connected-provider usage in DSH's web UI like OpenChamber's Usage card (OpenRouter credits, OpenCode Go 5-hour/weekly/monthly limits, Codex credits optional).

Reference endpoints (from OpenChamber's local install `@openchamber/web@1.19.0`, `server/` + `dist/`):
- `GET https://openrouter.ai/api/v1/credits` (Bearer key) → `data.total_credits` / `data.total_usage`
- `GET https://opencode.ai/zen/go/v1/usage` (OpenCode Go key)
- OpenChamber's own proxy pattern: `/api/provider/<name>/...`

⚠️ **License**: `@openchamber/web` ships **no LICENSE file** and no license field — do **not** copy its code. Adapt the endpoint calls and UX concept only.

DSH implementation sketch (read `docs/architecture.md` first — AGENTS.md):
- Host side: small service (new package e.g. `packages/web/usage/` or extend an existing web-host plugin) that calls the two endpoints with credentials from `ctx.credentials`; expose via the existing API gateway/remotes pattern (see `packages/api/remotes`, `packages/api/gateway`).
- Client side: new `@deepseek-ai/dsh-client-ui-usage` plugin occupying a sidebar/session slot (see `packages/client/ui-sidebar` + how `dsh-client-ui-model-selection` registers into `conversation.input.model`; also the sidebar slot registry in `dsh-client-ui-sidebar`).
- Register the plugin in the web profile roster (`apps/cli/config/web.cordis.yml` / base roster) + `__DSH_BOOT__` entries flow from the client-plugin build.
- v1 scope: OpenRouter credits + OpenCode Go usage. Codex usage is OAuth-bound (chatgpt backend) — defer.
- Repo conventions: Agent Note required for non-trivial PRs (`.agents/notes/`), bilingual README pairs, snapshot test for user-visible behavior, `pnpm run build` + focused tests before push (see `.agents/skills/dsh-pre-push-checks`).

### B. Tailscale remote access — "control from other laptops"

DSH-native recipe (no code changes needed):
- **Option A (preferred)**: keep `dsh web` on loopback and proxy via `tailscale serve`:
  ```sh
  tailscale serve --bg --https=443 http://127.0.0.1:3080
  ```
  then launch with the trust fence primed:
  ```sh
  pnpm dsh web --trusted-host <machine>.<tailnet>.ts.net
  ```
- **Option B**: bind to the tailnet IP directly: `pnpm dsh web --host 100.x.y.z --trusted-host 100.x.y.z`. Note DSH **refuses `--host 0.0.0.0`** by design (web-app README); binding a specific interface is the sanctioned remote mode.
- OpenChamber inspiration (verified from its local install): `--host <ip>` / `OPENCHAMBER_HOST` env + `x-forwarded-host` handling + Tailscale mentions in its README. Its recipe is "bind wider + UI password"; DSH's is "allowlist hosts + trusted fence".
- **Agents-Anywhere verdict**: it's a phone-first remote-control *plane* (FastAPI backend + Next.js + per-device Connectors) for Codex/Claude. Overkill for "open the same GUI from another laptop" — Tailscale + Option A gives that with zero new code. Revisit only if phone UX / device management becomes a real need.

### C. Upstream graduation (kills fork burden)

- PR the model-search commit (`18f4174e7a`) to `deepseek-ai/deepseek-harness`.
- ox-alpha needs no PR now (it's user config over the `zen-go` route). If "Stealth" should sit inside the OpenRouter group instead of its own group someday, that's an upstream catalog question.
- PR `dsh-llm-persist` to `deepseek-ai/deepseek-harness` together with the model-search commit.
- After merges: reset the fork to track upstream and drop local commits.

## 5. Gotchas

- **Running surfaces rewrite `~/.dsh/settings.yaml`.** Observed live: the agent-default-model changed (v4-pro→v4-flash) and an edit got re-applied over a server-side write, producing duplicate keys (YAML invalid → boot failure). Edit `~/.dsh` config while all dsh surfaces are stopped, or verify YAML right before restart.
- **Don't run two backends against the same `~/.dsh`** (e.g. desktop + fork server) — session/storage contention.
- Fork branch is **`master`** (not `main`). Lefthook pre-commit/pre-push hooks are installed and run (whitespace, vendor manifest, typecheck — the typecheck hook is why a push can exceed 60s; just retry).
- The desktop app will show the config-level `zen-go` route but **not** the search box (code-level) until upstream merges it.
- `dsh-spike/` is scratch: keep the `.patch`/`.orig` files until the npx install is retired, then delete.

## 6. Suggested kickoff prompt for the next session

> "Read HANDOFF.md. Then start work queue item A (usage panel): design the host usage service + client plugin per the sketch, following AGENTS.md conventions, build, and report back. Don't touch ~/.dsh/settings.yaml while the server is running."
