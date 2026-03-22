# CI and Testing Architecture

## Critical Constraints

- **No headless mode**: LanguageModel API requires headed browsers; Linux CI uses `xvfb-run`
- **Branded browsers only**: Chrome Beta / Edge Dev required, not bundled Chromium or JSDOM
- **ProcessSingleton** (Windows): `chrome_crashpad_handler` holds `FILE_FLAG_DELETE_ON_CLOSE` lockfile; POSIX uses advisory locks. Worker-scoped fixtures avoid close-relaunch. 5-attempt retry loop with 2s delay
- **Model readiness has 3 levels**: (1) files on disk, (2) registered, (3) first `session.prompt()` completes. Only level 3 eliminates 11+ min cold-start on ARM64. This is why warm-up runs `prompt('warmup')`, not just `create()` + `destroy()`
- **No macOS support**: ONNX Runtime CoreML passes capability check but crashes on resource allocation. No `ORT_DISABLE_GPU` exists. No GPU is better than inadequate GPU
- **Windows Server SKU rejected**: Edge model delivery requires Desktop (Win 10/11), not Server 2025

## Design Decisions

- **E2E before unit tests**: E2E warm-up initializes inference pipeline; unit tests reuse warm model. Cache saved post-test (not post-bootstrap) to capture inference artifacts (`adapter_cache.bin`, `encoder_cache.bin`)
- **Three-way warm-up duplication is intentional**: bootstrap, e2e fixture, Vitest global-setup each warm up independently — each is a separate entry point that might run alone
- **`@1` not `@2` for `optimization-guide-on-device-model`**: `@2` (BypassPerfRequirement) predates Chrome 140 CPU support, forces GPU backend on no-GPU machines
- **ONNX Runtime is Edge profile component**: DLLs download into profile dir, not browser install. Profile cache must include runtime + model + tokenizer
- **`open: 'never'` in HTML reporter**: Opening report launches Chrome Stable, triggering ProcessSingleton name-based conflict with test browser
- **npm caching split**: ubuntu-latest caches npm download cache; windows-11-arm caches `node_modules` directly (ARM64 native compilation is the bottleneck)

## Rejected Approaches

- `globalSetup` for E2E warm-up: separate browser process, ProcessSingleton blocks test worker
- Per-test browser fixtures: close-relaunch triggers ProcessSingleton every test
- Vitest `setupFiles`: runs in browser context, no `launchPersistentContext()` API access
- macOS runners (Intel + M1): GPU VRAM insufficient, no CPU-only fallback

## Deep Reference

- `docs/SUMMARY.md` — executive summary with quick-reference tables
- `docs/ci-workflow-architecture.md` — CI pipeline, caching, Docker strategy
- `docs/e2e-test-architecture.md` — Playwright fixtures, ProcessSingleton workarounds
- `docs/unit-test-architecture.md` — Vitest browser mode, global setup, guard tests
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
