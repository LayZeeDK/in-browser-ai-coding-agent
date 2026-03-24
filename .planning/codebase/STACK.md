# Technology Stack

**Analysis Date:** 2026-03-24

## Languages

**Primary:**

- TypeScript ~5.9.2 - All application and library source, Vitest configs, Playwright tests
- JavaScript (ESM .mjs) - Build scripts (`scripts/bootstrap-ai-model.mjs`), custom GitHub Action (`index.mjs`), Playwright global-setup files

**Secondary:**

- HTML/CSS - Angular component templates and styles
- PowerShell Core - CI diagnostic steps in `.github/workflows/ci.yml` (ONNX Runtime DLL version logging)

## Runtime

**Environment:**

- Node.js 24 (pinned via `.node-version`)
- Engine constraint: `^20.19.0 || ^22.12.0 || >=24.0.0` (in `package.json`)

**Package Manager:**

- npm
- Lockfile: `package-lock.json` committed

## Frameworks

**Core:**

- Angular ~21.2.0 - Full-stack SPA (standalone components, signals, inject(), OnPush, native control flow)
- `zone.js` 0.16.0 - Angular change detection
- `rxjs` ~7.8.0 - Reactive primitives (router/forms)
- `marked` ^17.0.5 - Markdown-to-HTML rendering in UI

**Browser AI:**

- W3C LanguageModel API (browser-native, no npm package) - On-device LLM inference
  - Chrome Beta: Gemini Nano
  - Microsoft Edge Dev: Phi-4 Mini
- Type definitions: `@types/dom-chromium-ai` ^0.0.15

**Testing:**

- Vitest 4.1 - Unit test runner (browser mode, not JSDOM)
- `@vitest/browser-playwright` 4.1 - Playwright-backed browser provider for Vitest
- `@vitest/coverage-v8` 4.1 - V8 coverage
- `@vitest/ui` 4.1 - Vitest interactive UI
- `@playwright/test` ^1.36.0 - E2E test framework
- `@playwright/cli` ^0.1.1 - Playwright CLI (used by Claude `playwright-cli` skill)

**Build/Dev:**

- Vite ^7.0.0 - Dev server and bundler (via `@nx/vite`)
- `@angular/build` ~21.2.0 - Angular application builder
- `@angular/cli` ~21.2.0 - Angular CLI
- `@swc/core` 1.15.8 + `@swc-node/register` 1.11.1 - Fast TypeScript transpilation for scripts
- `jiti` 2.4.2 - TypeScript/ESM interop for config files at load time

**Linting/Formatting:**

- ESLint ^9.8.0 (flat config, `eslint.config.mjs`)
- `typescript-eslint` ^8.40.0 - TypeScript lint rules
- `angular-eslint` 21.3.1 - Angular-specific lint rules
- `eslint-plugin-playwright` ^1.6.2 - Playwright test lint rules
- `eslint-config-prettier` ^10.0.0 - Prettier/ESLint integration
- Prettier ~3.6.2 - Code formatter (`.prettierrc`: `{"singleQuote": true}`)

## Monorepo Tooling

**Nx 22.6.0** - Monorepo orchestration, task caching, affected detection, CI integration

Active plugins (registered in `nx.json`):

- `@nx/playwright/plugin` - Infers `e2e` target from `playwright.config.ts`
- `@nx/eslint/plugin` - Infers `lint` target from `eslint.config.mjs`
- `@nx/vite/plugin` - Infers `build`, `serve`, `typecheck` targets from `vite.config.*`
- `@nx/vitest` - Infers `vite:test` target from `vitest.config.*`

Nx generator defaults (`nx.json`):

- Angular apps: Playwright for e2e, `vitest-analog` for unit tests, CSS styles
- Angular libraries: ESLint + `vitest-analog`

Nx Cloud:

- Connected (see `nx.json` for `nxCloudId`)
- Provides self-healing CI, affected SHA detection, remote caching

## Key Dependencies

**Critical:**

- `@types/dom-chromium-ai` ^0.0.15 - Without this, LanguageModel API calls won't type-check
- `@angular-devkit/build-angular` ~21.2.0 - Provides `@angular/build:unit-test` executor used by per-browser test targets

**Infrastructure:**

- `@swc/helpers` 0.5.18 - Runtime helpers for SWC-transpiled output
- `tslib` ^2.3.0 - TypeScript helper library (`importHelpers: true` in `tsconfig.base.json`)
- `undici` 7.24.5 (override via `overrides["@angular/build"]`) - Security patch for transitive HTTP client

## Configuration

**TypeScript:**

- `tsconfig.base.json` - Workspace root; strict mode inherited by projects; path alias `@layzeedk/browser-profiles` -> `libs/shared/browser-profiles/src/index.ts`; includes `dom-chromium-ai` types globally

**Build:**

- `nx.json` - Nx workspace config; task cache inputs; plugin registrations; generator defaults; `analytics: false`
- `vitest.workspace.ts` - Discovers per-project Vitest configs
- `.prettierrc` - `{"singleQuote": true}`
- `eslint.config.mjs` - Flat ESLint config; `@nx/enforce-module-boundaries` with `scope:shared/shop/api` and `type:data` constraints

**Per-project test configs:**

- `apps/in-browser-ai-coding-agent/vitest.config.mts` - Both browsers (default `test` target)
- `apps/in-browser-ai-coding-agent/vitest.config.chrome.mts` - Chrome Beta (`test-chrome` target)
- `apps/in-browser-ai-coding-agent/vitest.config.edge.mts` - Edge Dev (`test-edge` target)
- `apps/in-browser-ai-coding-agent/vitest.shared.mts` - Shared Vitest config factory
- `apps/in-browser-ai-coding-agent-e2e/playwright.config.ts` - Two Playwright projects: `chrome` + `edge`

**Environment:**

- No `.env` files; AI inference is browser-native with no API keys
- CI-only env vars: `GITHUB_TOKEN` (Docker registry), `GITHUB_STEP_SUMMARY` (test output), `CI` (headless override guard)

## CI Tooling (.github/)

**GitHub Actions workflow:** `.github/workflows/ci.yml`

- Triggers: push to `main`, all pull requests
- Concurrency: cancel-in-progress on PRs; group by SHA on push
- Permissions: `actions: read`, `contents: read`, `packages: write`

**CI Jobs:**

| Job                    | Runner                 | Condition    |
| ---------------------- | ---------------------- | ------------ |
| `changes`              | ubuntu-latest          | always       |
| `format`               | ubuntu-latest          | always       |
| `lint-typecheck-build` | ubuntu-latest          | code changed |
| `build-chrome-image`   | ubuntu-latest          | code changed |
| `e2e-chrome`           | ubuntu-latest (Docker) | code changed |
| `test-chrome`          | ubuntu-latest (Docker) | code changed |
| `e2e-edge`             | windows-11-arm         | code changed |
| `test-edge`            | windows-11-arm         | code changed |

**Smart job skipping:** Custom local action `.github/actions/paths-filter/` compares changed files against path filters. Jobs that require the AI model (Chrome/Edge) are skipped when only `.planning/**`, `.claude/**`, or `plans/**` change.

**Custom local action (.github/actions/paths-filter/):**

- `action.yml` - Declares `base`, `head`, `filters` inputs and `changes` (JSON) output
- `index.mjs` - Node.js 24 action; uses `git diff --name-only` with pathspecs; outputs `{"code": true/false}`
- Dependencies: `@actions/core` ^1.11.1, `@actions/exec` ^1.1.1 (vendored in `node_modules/`)

**GitHub Actions used:**

- `actions/checkout@v6` (with `filter: tree:0`, `fetch-depth: 0`)
- `actions/setup-node@v6` (reads `.node-version`)
- `nrwl/nx-set-shas@v5` - Base/head SHAs for Nx affected detection
- `docker/login-action@v4`, `docker/setup-buildx-action@v4`, `docker/build-push-action@v7`
- `actions/cache/restore@v5`, `actions/cache/save@v5` - npm, node_modules, browser profile caches

**Docker image (.github/docker/Dockerfile):**

- Base: `ubuntu:24.04`
- Installs Node.js via NodeSource (matches `.node-version`)
- Installs Playwright Chromium system deps + Chrome Beta
- Non-root user UID 1001 (matches GitHub Actions runner)
- Target: `chrome-beta` build stage
- Published to `ghcr.io/{repo}/playwright-chrome-beta` with tag `v{playwright}-node{node}-{dockerfile-hash}`
- Rebuild triggered by: Playwright version bump, Node version change, Dockerfile edit

**CI caching strategy:**

- `ubuntu-latest`: npm download cache (fast restoration)
- `windows-11-arm`: full `node_modules/` cache (avoids slow ARM64 native recompilation)
- AI model profiles: separate caches per browser per job type
  - `msedge-dev-e2e-edge-v1-run{N}` (e2e Edge)
  - `msedge-dev-test-edge-v1-run{N}` (unit test Edge)
  - Cache saved only on successful test run

**AI agent assets (.github/):**

- `.github/agents/ci-monitor-subagent.agent.md` - Claude subagent for single Nx Cloud MCP tool calls
- `.github/prompts/monitor-ci.prompt.md` - Orchestrator prompt for `/monitor-ci` CI monitoring workflow
- `.github/skills/` - Nx agent skills from `nrwl/nx-ai-agents-config` marketplace:
  - `nx-workspace/SKILL.md` - Workspace exploration
  - `nx-generate/SKILL.md` - Code generation
  - `nx-plugins/SKILL.md` - Plugin discovery/install
  - `nx-run-tasks/SKILL.md` - Task execution
  - `nx-import/SKILL.md` - Repository import
  - `link-workspace-packages/SKILL.md` - Workspace package linking

## Claude Code Configuration (.claude/)

**Settings:** `.claude/settings.json`

- Registers `nx-claude-plugins` marketplace from `github:nrwl/nx-ai-agents-config`
- Enables `nx@nx-claude-plugins` plugin (Nx Cloud MCP server integration)

**Skills (.claude/skills/):**

`angular-developer/SKILL.md` (v1.0, Google LLC):

- Triggers: component/service/project creation, architecture questions, reactivity, forms, DI, routing, testing, accessibility, animations, AI design patterns
- 44 reference docs in `.claude/skills/angular-developer/references/` covering signals, linked signals, resource API, AI design patterns, Tailwind, animations, accessibility, security, performance, web workers, CLI tooling

`playwright-cli/SKILL.md`:

- Browser automation via `playwright-cli` binary
- Allowed tools: `Bash(playwright-cli:*)`
- References: session management, test generation, tracing, video, request mocking, storage state

## Platform Requirements

**Development:**

- Node.js 24
- npm
- Chrome Beta (Gemini Nano) or Edge Dev (Phi-4 Mini) for AI inference
- Profile bootstrap: `node scripts/bootstrap-ai-model.mjs` downloads multi-GB model files into `.playwright-profiles/` (gitignored)
- Linux: requires `xvfb` for headed browser in CI-like environments

**Production:**

- No server runtime; SPA deployed as static files
- Users need Chrome Beta or Edge Dev with LanguageModel API enabled
- Not supported: macOS (ONNX Runtime CoreML GPU fallback issue), Windows Server (Edge model delivery requires Desktop SKU)

---

_Stack analysis: 2026-03-24_
