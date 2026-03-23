# In-Browser AI Coding Agent

Angular 21 app using the W3C LanguageModel API to run AI inference entirely in the browser. No cloud APIs — models run on-device via Chrome Beta (Gemini Nano) or Edge Dev (Phi-4 Mini).

## Prerequisites

- Node 24 (see `.node-version`)
- npm (not pnpm/yarn — `package-lock.json` is committed)
- Chrome Beta or Edge Dev (branded browsers required for LanguageModel API)

## Local Dev Setup

After `npm install`, the app runs without AI models (`npm start`). To enable on-device inference locally:

```bash
# Bootstrap Chrome Beta with Gemini Nano
node scripts/bootstrap-ai-model.mjs --browser chrome-beta --profile .playwright-profiles/chrome-beta

# Or Edge Dev with Phi-4 Mini
node scripts/bootstrap-ai-model.mjs --browser msedge-dev --profile .playwright-profiles/msedge-dev
```

The bootstrap script seeds browser flags in the profile's `Local State` file, launches the browser, and triggers model download. First run downloads multi-GB model files into `.playwright-profiles/` (gitignored). Subsequent runs reuse the cached profile.

## Commands

All tasks run through Nx. Prefix with `npm exec` (or use the `package.json` scripts):

```bash
npm install                     # install dependencies (sets up .githooks via prepare)
npm start                       # dev server (nx serve in-browser-ai-coding-agent)
npm run build                   # production build
npm run lint                    # ESLint (--max-warnings=0)
npm run typecheck               # TypeScript type checking
npm test                        # unit tests — both browsers (Vitest browser mode)
npm exec nx -- test-chrome in-browser-ai-coding-agent  # Chrome Beta / Gemini Nano only
npm exec nx -- test-edge in-browser-ai-coding-agent    # Edge Dev / Phi-4 Mini only
npm run e2e                     # E2E tests (Playwright — needs branded browser + AI model)
npm run format                  # Prettier format
npm run format:check            # Prettier check
npm run ci                      # full CI pipeline locally
```

## Project Structure

```
apps/
  in-browser-ai-coding-agent/           # Angular app
    src/app/
      language-model.service.ts          # LanguageModel API wrapper service
      model-status.component.ts          # Model status display component
      app.ts                             # Root component
      app.config.ts                      # Angular app configuration
      app.routes.ts                      # Route definitions
    browser-warmup.ts                    # Vitest setupFile — warms model in test browser
    global-setup.ts                      # Vitest global setup — seeds all browser profiles
    global-setup.chrome.ts               # Vitest global setup — Chrome only
    global-setup.edge.ts                 # Vitest global setup — Edge only
    global-setup.shared.ts               # Shared setup logic (seedLocalState, no browser launch)
    vitest.config.mts                    # Vitest config — both browsers (default)
    vitest.config.chrome.mts             # Vitest config — Chrome only (test-chrome target)
    vitest.config.edge.mts               # Vitest config — Edge only (test-edge target)
    vitest.shared.mts                    # Shared Vitest config factory
  in-browser-ai-coding-agent-e2e/       # Playwright E2E tests
    src/
      fixtures.ts                        # Worker-scoped persistent context fixture
      example.spec.ts                    # Basic app tests
      prompt.spec.ts                     # Real inference tests
    playwright.config.ts                 # Playwright config (2 projects: chrome + edge)
libs/
  shared/
    browser-profiles/                    # @layzeedk/browser-profiles — shared browser config
      src/lib/browser-profiles.ts        # Profile definitions, seedLocalState(), getLaunchOptions()
scripts/
  bootstrap-ai-model.mjs                # Model download + profile setup (CI + local)
  rebase-format.sh                      # Rebase helper with format fixes
docs/                                   # Architecture documentation (see Deep Reference)
eslint.config.mjs                       # Root ESLint config (Nx flat config)
nx.json                                 # Nx workspace config (plugins, targets, generators)
vitest.workspace.ts                     # Vitest workspace — discovers per-project configs
tsconfig.base.json                      # Shared TypeScript paths and compiler options
```

## Gotchas

- **Pre-commit hook auto-formats**: `.githooks/pre-commit` runs `nx format` on staged files and re-stages them. Commits may silently include formatting changes
- **Unit tests need real browsers**: Vitest browser mode with `@vitest/browser-playwright` — JSDOM won't work (no LanguageModel API)
- **E2E imports from `./fixtures`**: Never import from `@playwright/test` directly — tests must use the shared persistent context (see Critical Constraints below)
- **`@angular/build:unit-test` ignores Nx configurations**: `runnerConfig` resolves from base `options` only — configuration overrides are silently ignored. Use separate targets (`test-chrome`, `test-edge`) instead of `test -c chrome-gemini-nano`
- **`@angular/build:unit-test` forces headless in CI**: When `process.env.CI` is set and `headless` is not explicitly configured, the builder forces `headless: true` on all browser instances. LanguageModel API requires headed mode. Set `"headless": false` in the executor options in `project.json`
- **Vite config files can't use tsconfig path aliases**: Nx plugins parse `vitest.config.mts` and `global-setup.*.ts` before Vite plugins load. Use relative imports with `eslint-disable-next-line @nx/enforce-module-boundaries`
- **Profile paths must use `workspaceRoot`**: `resolve('.playwright-profiles/...')` resolves relative to CWD. Nx `command` targets run from the project root, not workspace root. Always use `resolve(workspaceRoot, '.playwright-profiles/...')`
- **`session.destroy()` can unload the model**: Per the W3C Prompt API spec, destroying a session signals the browser to unload the model from memory if no other sessions reference it

## Troubleshooting

| Error                                                          | Cause                                                                       | Fix                                                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Browser window not found`                                     | Chrome's `chrome_crashpad_handler` holds profile lockfile after close       | Kill `chrome_crashpad_handler` process, or wait ~30s. Retry loop handles this automatically in CI |
| `UnknownError: Other generic failures occurred`                | `optimization-guide-on-device-model@2` forces GPU backend on no-GPU machine | Use `@1` (not `@2`) — Chrome 140+ auto-detects CPU                                                |
| `Not Ready For Unknown Reason` on `edge://on-device-internals` | Transient Edge model loading race                                           | Refresh the page — resolves in ~1s. Fixtures handle this automatically                            |
| `InvalidStateError: The device is unable to create a session`  | macOS GPU VRAM insufficient, no CPU fallback in ONNX Runtime CoreML         | Not fixable — macOS is not supported (see platform findings)                                      |
| Tests timeout at 240-300s                                      | Model not warm — first `session.prompt()` takes 23-110 min on CI ARM64      | Ensure `browser-warmup.ts` setupFile is configured. CI step timeout is 120 min for Edge           |
| Model download never starts on Windows Server                  | Server SKU rejected by Edge model delivery                                  | Use Windows 10/11 Desktop, not Server 2025                                                        |

## Content Search

Use `git grep` for searching tracked files. Use `rg` only for untracked/ignored files.

# Code Style

## TypeScript

- Strict type checking is enabled — do not weaken it
- Prefer type inference when the type is obvious; avoid redundant annotations
- Never use `any`; use `unknown` when the type is uncertain

## Angular Components

- All components are standalone (Angular 21+ default) — never set `standalone: true` in decorators
- Set `changeDetection: ChangeDetectionStrategy.OnPush` in every `@Component`
- Use `input()` and `output()` functions, not `@Input`/`@Output` decorators
- Use `host` object in `@Component`/`@Directive` for host bindings — never `@HostBinding`/`@HostListener`
- Keep components single-responsibility; prefer inline templates for small components
- Use `NgOptimizedImage` for all static images (does not work for inline base64)

## State and Reactivity

- Use signals for local component state; use `computed()` for derived state
- Update signals with `set` or `update` — never `mutate`
- Keep state transformations pure and predictable

## Templates

- Use native control flow (`@if`, `@for`, `@switch`) — never `*ngIf`, `*ngFor`, `*ngSwitch`
- Use `class` bindings, not `ngClass`; use `style` bindings, not `ngStyle`
- Use the `async` pipe for observables
- Do not assume browser globals (e.g., `new Date()`) are available in templates

## Forms

- Use Reactive forms, not Template-driven forms

## Services

- Single responsibility per service
- Use `providedIn: 'root'` for singleton services
- Use the `inject()` function, not constructor injection

## Routing

- Lazy-load feature routes

## Accessibility

- Must pass all AXE checks
- Must meet WCAG AA: focus management, color contrast, ARIA attributes

# CI and Testing Architecture

## Critical Constraints

- **No headless mode**: LanguageModel API requires headed browsers; Linux CI uses `xvfb-run`
- **Branded browsers only**: Chrome Beta / Edge Dev required, not bundled Chromium or JSDOM
- **ProcessSingleton** (Windows): `chrome_crashpad_handler` holds `FILE_FLAG_DELETE_ON_CLOSE` lockfile; POSIX uses advisory locks. Worker-scoped fixtures avoid close-relaunch. 5-attempt retry loop with 2s delay
- **Model readiness has 3 levels**: (1) files on disk, (2) registered, (3) first `session.prompt()` completes. Only level 3 eliminates 11+ min cold-start on ARM64. This is why warm-up runs `prompt('warmup')`, not just `create()` + `destroy()`
- **No macOS support**: ONNX Runtime CoreML passes capability check but crashes on resource allocation. No `ORT_DISABLE_GPU` exists. No GPU is better than inadequate GPU
- **Windows Server SKU rejected**: Edge model delivery requires Desktop (Win 10/11), not Server 2025

## Design Decisions

- **Warm-up runs in the test browser process**: `browser-warmup.ts` (Vitest setupFile) and the e2e fixture both call `LanguageModel.create()` + `session.prompt('warmup')` in the same browser that runs tests. ONNX compilation is per-process — warming a separate browser is wasted work
- **globalSetup only seeds profiles**: `global-setup.shared.ts` calls `seedLocalState()` (file operations) — no browser launch. The actual warm-up happens in `browser-warmup.ts` (unit tests) or the e2e fixture
- **Don't destroy warm-up sessions prematurely**: Per the W3C Prompt API spec, `session.destroy()` signals the browser to unload the model from memory. Only destroy after warm-up completes successfully
- **CI saves cache only on success**: Post-test cache save is gated on `steps.unit-tests.outcome == 'success'` to avoid persisting corrupt profiles from timed-out runs
- **E2E and unit tests are independent in CI**: Separate jobs on separate VMs with separate caches (`msedge-dev-e2e-edge-v1-*`, `msedge-dev-test-edge-v1-*`). No shared warm-up between them
- **Shared browser config in Nx lib**: `@layzeedk/browser-profiles` is the single source of truth for profile definitions, `seedLocalState()`, and `getLaunchOptions()`. Vite-processed files use relative imports with eslint-disable (Nx plugins parse configs before Vite resolves tsconfig paths)
- **Retries disabled in CI**: Playwright retries create new workers, each needing a full model warm-up on ARM64. ProcessSingleton is handled by the fixture's 5-attempt retry loop instead
- **Per-browser Nx targets, not configurations**: `@angular/build:unit-test` ignores Nx configuration overrides for `runnerConfig`. Separate targets (`test-chrome`, `test-edge`) with distinct Vitest config files provide proper cache isolation
- **`@1` not `@2` for `optimization-guide-on-device-model`**: `@2` (BypassPerfRequirement) predates Chrome 140 CPU support, forces GPU backend on no-GPU machines
- **ONNX Runtime is Edge profile component**: DLLs download into profile dir, not browser install. Profile cache must include runtime + model + tokenizer
- **`open: 'never'` in HTML reporter**: Opening report launches Chrome Stable, triggering ProcessSingleton name-based conflict with test browser
- **npm caching split**: ubuntu-latest caches npm download cache; windows-11-arm caches `node_modules` directly (ARM64 native compilation is the bottleneck)

## Rejected Approaches

- `globalSetup` browser warm-up: launches a separate browser that closes before tests start — ONNX compilation state is lost. Use globalSetup only for file operations (`seedLocalState`)
- Vitest `setupFiles` for launching browsers: runs in browser context, no `launchPersistentContext()` API access. However, `setupFiles` IS the correct place for model warm-up — it runs in the same browser process as tests, preserving ONNX compilation state
- `dependsOn: ["^test"]` on e2e target: pulls in aggregate test (both browsers) even for per-browser CI jobs. Use separate `run-many` calls instead
- CDP browser sharing between Playwright and Vitest: `connectOptions` and `persistentContext` are mutually exclusive in `@vitest/browser-playwright`; Playwright's `launchServer()` doesn't support persistent contexts (issue #1523, open since 2020)
- `parallelism: false` on Nx targets: acts as a global machine lock blocking ALL tasks, not just the conflicting pair
- Per-test browser fixtures: close-relaunch triggers ProcessSingleton every test
- macOS runners (Intel + M1): GPU VRAM insufficient, no CPU-only fallback
- Nx configurations for `runnerConfig`: `@angular/build:unit-test` resolves from base options only, silently ignoring configuration overrides
- Vitest/Playwright retries in CI: each retry recreates the worker-scoped fixture, triggering a full model warm-up on ARM64

## Deep Reference

- `docs/SUMMARY.md` — architecture summary with quick-reference tables, test flow, timeouts, caching
- `docs/platform-runner-findings.md` — runner compatibility, GPU fallback, BypassPerfRequirement

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
