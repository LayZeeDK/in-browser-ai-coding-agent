# External Integrations

**Analysis Date:** 2026-03-24

## APIs & External Services

**On-Device AI (W3C LanguageModel API):**

- Chrome Beta - Gemini Nano
  - SDK/Client: `LanguageModel` global (browser-native, typed by `@types/dom-chromium-ai`)
  - Auth: None (no API key)
  - Feature flag: `OptimizationGuideOnDeviceModel@1` seeded into profile `Local State`
  - Model: multi-GB download, cached in `.playwright-profiles/chrome-beta/`
  - Implementation: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`

- Microsoft Edge Dev - Phi-4 Mini
  - SDK/Client: `LanguageModel` global (same W3C API surface)
  - Auth: None
  - Feature flag: `edge-llm-prompt-api-for-phi-mini@1` seeded into profile `Local State`
  - Model: multi-GB download (ONNX Runtime DLLs + model weights in `.playwright-profiles/msedge-dev/EdgeLLMRuntime/` and `EdgeLLMOnDeviceModel/`)
  - Inference: `adapter_cache.bin`, `encoder_cache.bin` written after first warm-up run

The service wrapper at `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts` exposes:

- `isApiSupported: boolean` - feature detection
- `checkAvailability(): Promise<ModelAvailability>` - delegates to `LanguageModel.availability()`
- `downloadModel(onProgress?)` - triggers download with progress events
- `prompt(text): Promise<string>` - creates session, prompts, destroys session

## Data Storage

**Databases:**

- Not applicable - no persistent data storage

**File Storage:**

- Local filesystem only
  - Browser AI model profiles in `.playwright-profiles/` (gitignored; development and CI use only)
  - CI caches: `msedge-dev-e2e-edge-v1-run{N}` and `msedge-dev-test-edge-v1-run{N}` (GitHub Actions cache)

**Caching:**

- GitHub Actions cache for browser profiles (contains ONNX Runtime DLLs, model weights, tokenizer, inference caches)
- Nx remote cache via Nx Cloud (build/test task output caching)

## Authentication & Identity

**Auth Provider:**

- Not applicable - no user authentication
- App runs entirely in browser with no backend; no sessions or credentials

## Monitoring & Observability

**Error Tracking:**

- None configured

**Logs:**

- Browser console (runtime errors in `language-model.service.ts`)
- GitHub Actions step summary (`GITHUB_STEP_SUMMARY`): unit test prompt/response pairs extracted from Vitest output logs in CI (both `test-chrome` and `test-edge` jobs)
- PowerShell diagnostic step in `test-edge` CI job: logs ONNX Runtime DLL versions and `genai_config.json` after model bootstrap
- Post-test bash step in `test-edge` CI job: lists `adapter_cache.bin`, `encoder_cache.bin`, and ONNX DLLs to diagnose inference cache state

**Browser Diagnostics:**

- `chrome://on-device-internals` - Chrome Beta model registration status
- `edge://on-device-internals` - Edge Dev model registration status

## CI/CD & Deployment

**Hosting:**

- Static SPA; no deployment integration configured
- Build output: `dist/apps/in-browser-ai-coding-agent/`
- Deployable to GitHub Pages, Netlify, Vercel, or any static host

**CI Pipeline: GitHub Actions** (`.github/workflows/ci.yml`)

Pipeline overview (all jobs gated by `changes` output for code-only runs):

1. `changes` (ubuntu-latest) - Detects whether code files changed using `.github/actions/paths-filter/`. Skips all expensive jobs when only `.planning/**`, `.claude/**`, or `plans/**` changed.

2. `format` (ubuntu-latest) - Runs `nx format:check` on every push/PR regardless of path filter.

3. `lint-typecheck-build` (ubuntu-latest) - `nx run-many -t lint typecheck build`; skipped on docs-only changes.

4. `build-chrome-image` (ubuntu-latest) - Builds and pushes `ghcr.io/{repo}/playwright-chrome-beta` to GitHub Container Registry. Version tag is `v{playwright}-node{node}-{dockerfile-hash}`; skips build if tag already exists (idempotent). Uses `GITHUB_TOKEN` for registry auth.

5. `e2e-chrome` (ubuntu-latest, Docker container) - Runs `xvfb-run npm exec nx -- e2e in-browser-ai-coding-agent-e2e -c chrome`; 45-minute timeout.

6. `test-chrome` (ubuntu-latest, Docker container) - Runs `xvfb-run npm exec nx -- test-chrome in-browser-ai-coding-agent`; 45-minute timeout. Writes prompt/response pairs to job summary.

7. `e2e-edge` (windows-11-arm) - Installs `msedge-dev` via Playwright, restores profile cache, bootstraps AI model if cache miss, runs `nx e2e in-browser-ai-coding-agent-e2e -c edge`; 180-minute timeout. Saves cache only on success.

8. `test-edge` (windows-11-arm) - Same bootstrap as `e2e-edge` (separate cache key), runs `nx test-edge in-browser-ai-coding-agent`; 180-minute timeout. Logs ONNX DLL versions and inference cache state.

**Docker Container Registry:**

- Registry: `ghcr.io` (GitHub Container Registry)
- Image: `ghcr.io/{owner}/{repo}/playwright-chrome-beta`
- Auth: `secrets.GITHUB_TOKEN` (automatic, `packages: write` permission)

**Nx Cloud:**

- Remote caching and task distribution
- Self-healing CI: Nx Cloud analyzes failures and suggests/applies fixes
- CI monitoring via `/monitor-ci` prompt (`.github/prompts/monitor-ci.prompt.md`)
- MCP tools: `ci_information` (fetch CI status, suggested fixes, task output), `update_self_healing_fix` (APPLY / REJECT / RERUN_ENVIRONMENT_STATE)

## AI Coding Agent Integrations

**Claude Code** (`.claude/`):

Settings at `.claude/settings.json`:

- Registers `nx-claude-plugins` marketplace (`github:nrwl/nx-ai-agents-config`)
- Enables `nx@nx-claude-plugins` plugin - activates Nx Cloud MCP server inside Claude Code sessions

Skills:

- `.claude/skills/angular-developer/SKILL.md` - Angular code generation and architecture guidance; references 44 Angular docs under `references/`
- `.claude/skills/playwright-cli/SKILL.md` - Browser automation; gates tool use to `Bash(playwright-cli:*)`

**GitHub Copilot:**

- Business tier in use (per project `CLAUDE.md` / `AGENTS.md`)
- No repository configuration files for Copilot detected

**Nx Cloud MCP Server** (via `nx@nx-claude-plugins`):

- Provides `ci_information` and `update_self_healing_fix` tools to Claude Code
- Used by the `monitor-ci` skill and `ci-monitor-subagent`
- Workflow: `.github/prompts/monitor-ci.prompt.md` orchestrates polling loop; spawns `ci-monitor-subagent` (haiku) for single MCP calls

**CI Monitor subagent** (`.github/agents/ci-monitor-subagent.agent.md`):

- Purpose: executes one Nx Cloud MCP tool call and returns structured result
- Commands: `FETCH_STATUS`, `FETCH_HEAVY`, `UPDATE_FIX`, `FETCH_THROTTLE_INFO`
- Used exclusively by the `monitor-ci` orchestrator skill

**GitHub Skills** (loaded from `github:nrwl/nx-ai-agents-config` marketplace, stored in `.github/skills/`):

- `nx-workspace/SKILL.md` - Workspace/project/target exploration
- `nx-generate/SKILL.md` - Nx code generation (invoke before scaffolding)
- `nx-plugins/SKILL.md` - Plugin discovery and installation
- `nx-run-tasks/SKILL.md` - Task execution guidance
- `nx-import/SKILL.md` - Repository import into Nx workspace
- `link-workspace-packages/SKILL.md` - Workspace package dependency wiring

## Environment Configuration

**Required env vars (CI):**

- `GITHUB_TOKEN` - Auto-injected by GitHub Actions; used for Docker registry push (`packages: write`)
- `GITHUB_STEP_SUMMARY` - Auto-injected; unit test jobs append prompt/response markdown
- `CI` - Auto-set by GitHub Actions; guards against accidental `headless: true` forcing by `@angular/build:unit-test`

**Optional env vars (local dev/E2E):**

- `E2E_PORT` - Port for E2E dev server (default: 4200)
- `BASE_URL` - Base URL for E2E tests

**Secrets location:**

- No application secrets; browser flags seeded via `seedLocalState()` in `libs/shared/browser-profiles/src/lib/browser-profiles.ts`
- Docker registry auth via automatic `GITHUB_TOKEN` (no stored secret needed)

## Webhooks & Callbacks

**Incoming:**

- None

**Outgoing:**

- None

## Browser API Usage

**W3C LanguageModel API (experimental):**

- Session lifecycle: `LanguageModel.availability()`, `LanguageModel.create()`, `session.prompt()`, `session.destroy()`
- Progress events: `monitor.addEventListener('downloadprogress', ...)` during model download
- Test warm-up: `session.prompt('warmup')` in `browser-warmup.ts` and e2e fixtures; ensures ONNX compilation is cached before tests run

No other external REST, GraphQL, or third-party SDK integrations exist. This is an entirely browser-native, offline-capable application.

---

_Integration audit: 2026-03-24_
