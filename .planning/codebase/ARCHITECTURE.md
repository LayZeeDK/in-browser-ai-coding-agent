# Architecture

**Analysis Date:** 2026-03-24

## Pattern Overview

**Overall:** Angular SPA with in-browser AI inference, organized as an Nx monorepo

**Key Characteristics:**

- No server-side AI -- all inference happens in the browser via W3C LanguageModel API (Gemini Nano in Chrome Beta, Phi-4 Mini in Edge Dev)
- Signal-based reactivity throughout (Angular 21 signals, `signal()`, `computed()`, `inject()`)
- Two-level AI agent architecture: Claude Code plugin agents (`.claude/`) and GitHub-hosted agents (`.github/agents/`) for CI automation
- Nx task orchestration with per-browser CI targets, Nx Cloud self-healing integration

## Layers

**Application Layer:**

- Purpose: Angular UI for interacting with the on-device AI model
- Location: `apps/in-browser-ai-coding-agent/src/app/`
- Contains: Standalone components, root configuration, route definitions
- Depends on: `LanguageModelService`, Angular core, `marked` (Markdown rendering)
- Used by: Browser entry point `apps/in-browser-ai-coding-agent/src/main.ts`

**Service Layer:**

- Purpose: Wrap the W3C LanguageModel browser API with typed Angular-friendly methods
- Location: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`
- Contains: `LanguageModelService` (availability check, model download, prompt execution)
- Depends on: W3C `LanguageModel` global (browser API, available in Chrome Beta and Edge Dev only)
- Used by: `ModelStatusComponent`

**Shared Library Layer:**

- Purpose: Cross-project browser profile configuration as the single source of truth
- Location: `libs/shared/browser-profiles/src/lib/browser-profiles.ts`
- Contains: `BrowserProfile` interface, `allProfiles` array, `getLaunchOptions()`, `seedLocalState()`
- Depends on: `@nx/devkit` (workspaceRoot), Node.js `fs`/`path`
- Used by: Vitest configs, e2e fixtures, global setup files, bootstrap script

**Testing Infrastructure Layer:**

- Purpose: Warm the on-device AI model before tests run, configure browser instances
- Location: `apps/in-browser-ai-coding-agent/`
- Contains:
  - `browser-warmup.ts` -- Vitest setupFile (runs in browser process, preserves ONNX compilation state)
  - `global-setup.ts` / `global-setup.shared.ts` -- profile file seeding only (no browser launch)
  - `global-setup.chrome.ts` / `global-setup.edge.ts` -- per-browser globalSetup entry points
  - `vitest.shared.mts` -- factory producing Vitest config from profile definitions
  - `vitest.config.mts` / `vitest.config.chrome.mts` / `vitest.config.edge.mts`
- Depends on: `@layzeedk/browser-profiles`, `@vitest/browser-playwright`

**E2E Layer:**

- Purpose: End-to-end tests with real browser + real AI model inference
- Location: `apps/in-browser-ai-coding-agent-e2e/src/`
- Contains: Playwright fixtures with persistent context warm-up, basic and prompt specs
- Depends on: `@layzeedk/browser-profiles`, Playwright

## Data Flow

**User Prompt Flow:**

1. User types in `<input>` in `ModelStatusComponent` template
2. `promptText` signal updated via `(input)` event binding
3. `onSubmit()` called on form submit
4. `LanguageModelService.prompt(text)` called -- creates a new LanguageModel session
5. Session calls W3C `session.prompt(text)` -- runs local ONNX inference in the browser
6. Response returned, `response` signal set; session destroyed in `finally`
7. `responseHtml` computed signal renders Markdown via `marked.parse()`
8. `[innerHTML]` binding renders sanitized HTML (via `DomSanitizer.bypassSecurityTrustHtml`)

**Model Availability Flow:**

1. `ModelStatusComponent.ngOnInit()` calls `languageModel.checkAvailability()`
2. `LanguageModelService` calls `LanguageModel.availability()` (browser API)
3. Result mapped to typed `ModelAvailability` union: `'available' | 'downloadable' | 'downloading' | 'unavailable'`
4. `availability` signal set, `loading` signal cleared
5. If `'downloading'`, component polls every 2 seconds until `'available'`

**Browser Warm-up Flow (CI and local tests):**

1. Nx target invoked (e.g., `test-chrome` or `test-edge`)
2. Vitest `globalSetup` runs `seedLocalState()` -- writes browser flags to profile dir (file ops only, no browser)
3. Vitest launches browser via `@vitest/browser-playwright` with persistent context
4. `browser-warmup.ts` setupFile runs in the same browser process as tests
5. `LanguageModel.create()` called, then `session.prompt('warmup')` -- triggers ONNX compilation/caching
6. After warm-up completes, test files execute (all subsequent prompts respond in 1-3s)
7. `session.destroy()` called only after warm-up succeeds (premature destroy unloads model from memory)

**State Management:**

- All UI state lives in `ModelStatusComponent` as signals: `loading`, `availability`, `downloading`, `downloadProgress`, `promptText`, `prompting`, `response`, `error`
- Derived rendering via `computed()` (`responseHtml`)
- No shared state store -- `LanguageModelService` is stateless, component owns all UI state

## Key Abstractions

**LanguageModelService:**

- Purpose: Typed Angular facade over the W3C LanguageModel browser global
- File: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`
- Pattern: Singleton service (`providedIn: 'root'`), creates and destroys sessions per call, throws on missing API

**BrowserProfile:**

- Purpose: Typed descriptor for a browser+model combination (channel, profile dir, launch args, chrome://flags entries)
- File: `libs/shared/browser-profiles/src/lib/browser-profiles.ts`
- Pattern: Plain data objects in `allProfiles` array consumed by Vitest configs and Playwright fixtures

**createVitestConfig factory:**

- Purpose: Builds a Vitest config from the shared profile definitions, with optional instance filtering
- File: `apps/in-browser-ai-coding-agent/vitest.shared.mts`
- Pattern: Factory function accepting `{ instanceFilter?, globalSetup? }` -- per-browser configs call it with one filter

**Nx Task Targets:**

- Purpose: Separate named Nx targets (`test-chrome`, `test-edge`) rather than configurations, because `@angular/build:unit-test` silently ignores configuration overrides for `runnerConfig`
- Configured in: `apps/in-browser-ai-coding-agent/project.json`

## Entry Points

**Angular App:**

- Location: `apps/in-browser-ai-coding-agent/src/main.ts`
- Triggers: Browser navigation to the served URL
- Responsibilities: Bootstrap Angular application with `appConfig`

**Dev Server:**

- Location: Nx `serve` target on `in-browser-ai-coding-agent`
- Triggers: `npm start` / `npm exec nx serve in-browser-ai-coding-agent`

**Production Build:**

- Location: Nx `build` target, output to `dist/apps/in-browser-ai-coding-agent/`
- Triggers: `npm run build`

**E2E Tests:**

- Location: `apps/in-browser-ai-coding-agent-e2e/playwright.config.ts`
- Triggers: `npm exec nx -- e2e in-browser-ai-coding-agent-e2e -c chrome|edge`

**Bootstrap Script:**

- Location: `scripts/bootstrap-ai-model.mjs`
- Triggers: `node scripts/bootstrap-ai-model.mjs --browser <name> --profile <path>`
- Responsibilities: Seeds profile Local State, launches browser, triggers model download

## CI/CD Architecture

**Workflow file:** `.github/workflows/ci.yml`

**Job Dependency Graph:**

```
changes (ubuntu)
  |-- custom paths-filter action: detect code vs non-code changes
  |
  +-- format (ubuntu, always runs)
  |     |-- nx format:check
  |
  +-- lint-typecheck-build (ubuntu, skipped if no code changes)
  |     |-- nx run-many -t lint typecheck build
  |
  +-- build-chrome-image (ubuntu, skipped if no code changes)
  |     |-- builds/caches ghcr.io/{repo}/playwright-chrome-beta Docker image
  |     |-- tag formula: v{playwright_version}-node{node_version}-{dockerfile_sha8}
  |     |-- skips build if matching tag already exists in GHCR
  |     |
  |     +-- e2e-chrome (ubuntu container)
  |     |     |-- xvfb-run (headed mode on headless Linux)
  |     |     |-- nx e2e in-browser-ai-coding-agent-e2e -c chrome (45 min timeout)
  |     |
  |     +-- test-chrome (ubuntu container)
  |           |-- xvfb-run (headed mode on headless Linux)
  |           |-- nx test-chrome in-browser-ai-coding-agent (45 min timeout)
  |           |-- inline Node script extracts prompt responses to job summary
  |
  +-- e2e-edge (windows-11-arm, independent of build-chrome-image)
  |     |-- node_modules cache key: {OS}-{arch}-node{hash}-nm-{lockfile_hash}
  |     |-- AI model cache: .playwright-profiles/msedge-dev
  |     |     key: msedge-dev-e2e-edge-v1-run{run_number}
  |     |-- bootstrap if cache miss: scripts/bootstrap-ai-model.mjs
  |     |-- saves bootstrap cache after bootstrap success
  |     |-- nx e2e in-browser-ai-coding-agent-e2e -c edge (180 min timeout)
  |     |-- saves model cache only on test success (no corrupt profiles)
  |
  +-- test-edge (windows-11-arm, independent of build-chrome-image)
        |-- same node_modules + model cache pattern as e2e-edge
        |-- separate cache key: msedge-dev-test-edge-v1-run{run_number}
        |-- logs ONNX Runtime DLL versions + genai_config.json
        |-- nx test-edge in-browser-ai-coding-agent (180 min timeout)
        |-- extracts prompt responses to job summary
        |-- logs inference cache files (adapter_cache.bin, encoder_cache.bin)
```

**Change Detection (Custom Action):**

- Location: `.github/actions/paths-filter/`
- Implementation: `.github/actions/paths-filter/index.mjs` uses `git diff --name-only` with git pathspec exclusions
- Input format: Named filters with include/exclude patterns (YAML-like syntax)
- `code` filter: excludes `.planning/**`, `.claude/**`, `plans/**`
- Output: JSON object `{ code: boolean }` -- downstream jobs check `fromJSON(needs.changes.outputs.changes).code`

**Docker Image Strategy:**

- Location: `.github/docker/Dockerfile`
- Base: `ubuntu:24.04`, Node.js via NodeSource, Playwright system deps, Chrome Beta
- Rebuild triggers: Playwright version bump, Node version change, Dockerfile edit (content hash)
- Registry: GitHub Container Registry (`ghcr.io`)
- Build cache: GitHub Actions cache with `scope=playwright-chrome-beta`
- Concurrency: `cancel-in-progress` on PRs, persists on main-branch pushes

**Cache Keys:**

- npm download cache: `ubuntu-latest` via `actions/setup-node`
- node_modules (Windows ARM64): `{runner.os}-{runner.arch}-node{.node-version hash}-nm-{package-lock.json hash}`
- AI model (e2e Edge): `msedge-dev-e2e-edge-v1-run{run_number}` (restore: prefix match)
- AI model (unit Edge): `msedge-dev-test-edge-v1-run{run_number}` (restore: prefix match)
- Docker image layers: GHA cache with `scope=playwright-chrome-beta`

## Claude Code Agent Architecture (.claude/)

**Settings:** `.claude/settings.json`

- Registers `nx-claude-plugins` marketplace (`source: github, repo: nrwl/nx-ai-agents-config`)
- Enables `nx@nx-claude-plugins` plugin set (loads `.github/skills/` as Claude Code skills)

**Skills** (`.claude/skills/{name}/SKILL.md` + optional `references/`):
Skills are reusable prompt modules loaded on demand by Claude Code when the trigger description matches.

**`angular-developer` skill** (`.claude/skills/angular-developer/`):

- SKILL.md: `angular-developer/SKILL.md`
- Trigger: Creating Angular projects/components/services, reactivity, AI patterns, forms, DI, routing, SSR, security, accessibility, testing, CLI
- References: 40+ topic-specific Markdown files in `angular-developer/references/`
  - `ai-design-patterns.md` -- LLM integration, streaming, `resource.stream`
  - `signals-overview.md` -- signals, `computed`, reactive contexts
  - `testing-fundamentals.md` -- async-first testing, TestBed, signal inputs, `resource()` testing
  - `accessibility.md` -- ARIA, focus management, CDK a11y tools
  - 37 more covering components, DI, routing, forms, HTTP, error handling, performance, animations, styling
- License: MIT (Google LLC, 2026)

**`playwright-cli` skill** (`.claude/skills/playwright-cli/`):

- SKILL.md: `playwright-cli/SKILL.md`
- Trigger: Browser automation, web testing, form filling, screenshots, data extraction
- Allowed tools restricted to: `Bash(playwright-cli:*)` only
- References: `request-mocking.md`, `running-code.md`, `session-management.md`, `storage-state.md`, `test-generation.md`, `tracing.md`, `video-recording.md`

## GitHub AI Agent Architecture (.github/agents/ and .github/skills/)

**Relationship to .claude/:** The `.claude/settings.json` enables `nx@nx-claude-plugins`, which causes Claude Code to load `.github/skills/` as additional Claude Code skills alongside `.claude/skills/`. Both directories are active simultaneously.

**Agent:** `.github/agents/ci-monitor-subagent.agent.md`

- Model: haiku (lightweight, single-purpose)
- Role: Execute exactly one MCP tool call and return structured result -- no polling, no decisions
- Commands accepted: `FETCH_STATUS`, `FETCH_HEAVY`, `UPDATE_FIX`, `FETCH_THROTTLE_INFO`
- MCP tools used: `ci_information`, `update_self_healing_fix`

**Prompt file:** `.github/prompts/monitor-ci.prompt.md`

- Same content as `monitor-ci/SKILL.md` but in VS Code Copilot format with `${input:args}` placeholders
- Used when invoked as a VS Code Copilot prompt (`/monitor-ci`)

**Skills in `.github/skills/`:**

| Skill                     | File                               | Trigger                                    | Purpose                                                         |
| ------------------------- | ---------------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| `monitor-ci`              | `monitor-ci/SKILL.md`              | "monitor ci", "watch ci", CI tracking      | Orchestrates Nx Cloud CI polling + self-healing fix application |
| `nx-generate`             | `nx-generate/SKILL.md`             | scaffold, create, generate                 | Nx generator discovery, dry-run, pattern matching               |
| `nx-import`               | `nx-import/SKILL.md`               | adopt Nx, merge repos, import project      | `nx import` workflow with issue reference files                 |
| `nx-plugins`              | `nx-plugins/SKILL.md`              | discover/install plugins                   | `nx list` and `nx add` guidance                                 |
| `nx-run-tasks`            | `nx-run-tasks/SKILL.md`            | build, test, lint, serve                   | Nx task execution patterns                                      |
| `nx-workspace`            | `nx-workspace/SKILL.md`            | explore workspace, project config, targets | `nx show project`, `nx graph`, affected projects                |
| `link-workspace-packages` | `link-workspace-packages/SKILL.md` | new package wiring, resolution errors      | Correct workspace dep linking per package manager               |

**monitor-ci Skill Architecture:**

- Orchestrator pattern: skill spawns lightweight `ci-monitor-subagent` for MCP calls, runs deterministic Node scripts for decisions
- `ci-poll-decide.mjs` -- reads CI state, outputs `{ action: "poll"|"wait"|"done", code, message, delay? }`
- `ci-state-update.mjs` -- manages budget gates (max local-fix attempts), post-action state transitions, cycle classification
- Fix flows documented in `monitor-ci/references/fix-flows.md`
- MCP field sets: WAIT_FIELDS (3 fields), LIGHT_FIELDS (16 fields), HEAVY_FIELDS (4 fields) -- uses lightest sufficient set

## Error Handling

**Strategy:** Explicit error state in UI signals; no global error boundary for AI errors; service methods throw on missing API

**Patterns:**

- `LanguageModelService` throws `Error('LanguageModel API is not available')` if `typeof LanguageModel === 'undefined'`
- `ModelStatusComponent` catches all errors in `onSubmit()` and `onDownload()` with `try/catch`, sets `error` signal
- `try/finally` in `LanguageModelService.prompt()` ensures `session.destroy()` always runs
- CI: `monitor-ci` skill distinguishes environment failures (bail immediately, no budget consumed) from code failures (local-fix attempt with budget gate)

## Cross-Cutting Concerns

**Logging:** `console.log`/`console.warn` with `[browser-warmup]` prefix in setup files; inline Node.js scripts in CI parse tee'd log output for GitHub Actions job summaries using regex pattern `[unit] name: "prompt"\n[unit-response]...[/unit-response]`
**Validation:** Browser API availability checked via `typeof LanguageModel !== 'undefined'` before any API call
**Authentication:** None -- no server-side code, no auth
**Nx Cloud:** Connected via `nxCloudId` in `nx.json`; enables distributed task caching and Nx Cloud self-healing CI (auto-fix broken PRs)

---

_Architecture analysis: 2026-03-24_
