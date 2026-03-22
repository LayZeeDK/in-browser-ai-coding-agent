# Fix Edge Dev Phi-4 Mini Model Warm-up in CI

## Context

Angular 21 app using the W3C LanguageModel API for in-browser AI inference. Two browsers: Chrome Beta (Gemini Nano) on ubuntu-latest containers, Edge Dev (Phi-4 Mini) on windows-11-arm GitHub Actions runners.

**Chrome is stable** — e2e + unit tests pass in ~2-4 min. Model downloaded at runtime by the fixture (~2 min on ubuntu-latest). Container image is browser-only (no model baked in).

**Edge Dev on ARM64 CI is the problem.** The first `session.prompt()` call takes **23-44 minutes** on the 4-vCPU Azure Cobalt 100 runner (no GPU, no NPU), vs **17-48 seconds** locally on Snapdragon X Elite. This is a hardware performance gap, not a software bug. All ONNX Runtime optimizations (KleidiAI, NEON, I8MM, SVE2) are already active.

## What We Did (two sessions)

### Session 1: Core fixes

1. **Eliminated retry warm-up cascade** — Playwright/Vitest retries set to 0 in CI. Each retry created a new worker with a 12+ min warm-up, causing 45-min timeouts.

2. **Restructured warm-up flow** — `LanguageModel.create()` → wait for Model Status "Ready" → `session.prompt('warmup')`. The prompt completes in ~35s locally when Model Status reports Ready first (vs 12+ min without the wait). On CI ARM64 the prompt still takes 23-44 min due to hardware.

3. **Per-browser Nx test targets** — `test-chrome`, `test-edge` with separate Vitest configs and globalSetup files. `@angular/build:unit-test` ignores Nx configurations for `runnerConfig`, so separate targets were needed.

4. **PID-based dedup guard** — Vitest calls `globalSetup.setup()` twice in browser mode (root project + Angular project both invoke it). File-based `.warmup-pid` marker prevents double warm-up.

5. **Comprehensive diagnostics** — Device Performance Information (memory, cores, D3D, GPU/NPU), Model Status tab (crash count, Feature Adaptations, Supplementary Models), ONNX Runtime DLL versions, genai_config.json. Both e2e fixtures and Vitest globalSetup capture these.

6. **Debug logging flag** — `edge-llm-on-device-model-debug-logs@1` enabled in bootstrap.

7. **Perf-param matrix** — CI tests `edge-llm-on-device-model-performance-param` @1, @2, and @3 in parallel.

### Session 2: Chrome stabilization + CI architecture

8. **Split CI into separate jobs** — `build-chrome-image` → `test-chrome` (container) and `test-edge` (Windows ARM). No shared matrix. Chrome job depends on image build via `needs:`.

9. **Chrome image build caching** — Image tag includes Playwright version + Node version + Dockerfile hash. `docker manifest inspect` skips build when tag exists. Rebuilds only on version bumps or Dockerfile edits.

10. **Simplified Chrome image** — Browser + system deps only. No model baked in (Docker build can't launch Chrome due to missing `--ipc=host` for shared memory). Model downloaded at runtime by fixture in ~2 min.

11. **Flag seeding in e2e fixture** — `seedLocalState()` seeds chrome://flags entries (same flags as bootstrap). Single source of truth for both browsers. Creates profile directory if missing.

12. **Discovered `@angular/build:unit-test` forces `headless: true` in CI** — The builder's `browser-provider.js` overrides all browser instances to headless when `process.env.CI` is set and `headless` is not explicitly configured. LanguageModel API requires headed mode. Fixed by setting `"headless": false` in executor options in `project.json`.

13. **Removed Chrome process kill step** — `pkill -9 -f chrome` between e2e and unit tests was force-killing Chrome mid-cleanup, leaving the profile lockfile in a bad state. Playwright's `context.close()` handles cleanup cleanly.

14. **Removed Edge process kill step** — Edge doesn't have Chrome's ProcessSingleton lockfile issue. The kill step may have been truncating async ONNX Runtime cache writes.

### Research Findings (in .planning/research/)

- **phi4-mini-arm64-cold-start.md** — CI runner: Azure Cobalt 100 (4 vCPU Neoverse N2, 16 GB RAM, no GPU/NPU). Geekbench single-core ~1,629 vs Snapdragon X Elite ~2,400-2,780.
- **onnx-runtime-arm64-cold-start.md** — Edge ships ONNX RT 1.25 with KleidiAI. Cold-start phases: weight deserialization, graph optimization, EP partitioning, KV cache allocation, first inference.
- **arm64-ci-onnx-optimizations.md** — All 7 optimization vectors exhausted. Model targets WebGPU, falls back to CPU EP. `genai_config.json` is integrity-checked by Edge — modifying session_options causes model unavailability.
- **edge-flags-on-device-model.md** — 6 edge-llm-\* flags. None control ONNX internals. @3 bypasses perf check but doesn't speed inference.
- **ci-patterns-slow-model-inference.md** — Docker blocked for Edge (no Windows containers, no Linux Edge). No published patterns for on-device browser AI CI testing.
- **vitest-globalsetup-double-invocation.md** — Root cause: Vitest's `initializeGlobalSetup()` unconditionally adds root project + Angular CLI's plugin doesn't clear `test.globalSetup`.
- **`adapter_cache.bin` / `encoder_cache.bin` are 0 bytes** locally AND on CI. The inference artifact caching hypothesis was wrong. CPU EP does not populate them.

### Key Diagnostic Data

**Local (Snapdragon X Elite)**:

- GPU0: Qualcomm Adreno X1-85, NPU0: Qualcomm Hexagon
- WebNN: Enabled, DirectML 5.0, D3D11: 11_1, Hardware Concurrency: 12, RAM: 31 GB
- Software Rendering: No
- Warm-up prompt: 17-48s

**CI (Azure Cobalt 100)**:

- GPU0: Microsoft Basic Render Driver (software), No NPU
- WebNN: Software only, D3D11: Unknown, Hardware Concurrency: 4, RAM: 15 GB
- Software Rendering: Yes
- Warm-up prompt: 23-44 min (highly variable)

**CI (ubuntu-latest, Chrome container)**:

- GPU0: SwiftShader (software), No NPU
- WebNN: Software only, Hardware Concurrency: 2-4
- Warm-up prompt: 13-27s (Gemini Nano is much smaller than Phi-4 Mini)

## Current State

### What Works

- **Chrome e2e + unit tests**: PASS (~2-4 min total, model downloaded at runtime)
- **Chrome image build caching**: Skips build when version tag exists (~5s vs ~2 min)
- **Edge unit tests**: PASS when warm-up completes within timeout (12/13 or 13/13 tests)
- **Edge bootstrap + model cache**: Model profile cached via GitHub Actions cache
- **All diagnostics**: Device Performance Info, GPU/NPU, Feature Adaptations, ONNX RT version captured in CI logs
- **Flag seeding**: Single source of truth in fixture's `seedLocalState()` for both browsers
- **`headless: false`**: Set in both Vitest config AND executor options to prevent Angular builder override

### What's Uncertain

- **Edge e2e**: Warm-up prompt takes 23-44 min. With 45-min step timeout, it sometimes succeeds, sometimes times out. The variance is likely CI runner load / co-tenant interference.
- **Perf-param @1/@2 results**: Matrix jobs added but haven't all completed. Unknown whether different values trigger different model variants or loading behavior on the GPU-less CI runner.
- **Chrome process kill necessity**: Removed it, need to verify unit tests launch cleanly without it (ProcessSingleton may still hold lockfile briefly after `context.close()`).
- **Whether warm-up prompt is needed at all**: Model Status "Ready" means files are registered. The prompt loads model into ONNX RT memory. On CI, this takes 23+ min. Could we skip it and let tests absorb the cost? But test timeouts (300-600s) are much shorter than 23 min.

### What's Definitively Not Fixable

- **ARM64 CI cold-start speed**: 4-vCPU Azure Cobalt 100 with CPU-only ONNX Runtime running a 3.8B parameter model. All SIMD optimizations active. No flags, configs, or caching can speed this up.
- **`genai_config.json` tuning**: Edge integrity-checks the file. Any modification causes model unavailability.
- **Inference artifact caching**: `adapter_cache.bin`/`encoder_cache.bin` are 0 bytes on both platforms. CPU EP does not generate them.
- **Docker containers for Edge**: No Windows containers in GitHub Actions, no Linux ARM64 Edge build, Desktop SKU required for model delivery.

## Session 3: Perf-param matrix analysis + CI consolidation

### Findings

15. **Perf-param @1/@2/@3 are identical** — All three produce identical behavior on the software-rendering ARM64 runner: same model loading time, same ONNX Runtime config, same warm-up duration, same test results. Consolidated to single job with `@3` (the original default).

16. **E2e warm-up is wasted** — Each browser process starts ONNX compilation from scratch (~23-44 min). The e2e step runs a 45-min warm-up, but when the step ends (timeout or completion), the process dies. Unit tests launch a NEW process that must redo all compilation. The e2e warm-up contributes zero benefit to unit test performance.

17. **Unit test prompt success depends entirely on runner speed** — The global-setup warm-up runs for 20 min (then times out), and the per-test prompt timeout is 240-300s. Total processing time from process launch: 24-25 min. First inference needs 23-44 min. On a fast runner (23 min), tests pass. On a slow runner (30+ min), they fail.

### Completed run data (5 runs + 1 live)

| Run         | E2e warm-up  | Unit warm-up | Component (240s) | Service (300s) | Unit result |
| ----------- | ------------ | ------------ | ---------------- | -------------- | ----------- |
| 23402799639 | 30m TIMEOUT  | 20m TIMEOUT  | 167s PASS        | 241s PASS      | **13/13**   |
| 23404243696 | 40m CRASH+4m | 20m TIMEOUT  | 184s PASS        | 300s FAIL      | 12/13       |
| 23404218941 | 40m CRASH+4m | 20m TIMEOUT  | 242s FAIL        | 300s FAIL      | 11/13       |
| 23408368667 | 6.1m PASS    | 20m TIMEOUT  | 240s FAIL        | 300s FAIL      | 11/13       |
| 23409747058 | 45m TIMEOUT  | 20m TIMEOUT  | 240s FAIL        | running        | pending     |

### Changes made

18. **Removed perf-param matrix** — `ci.yml` test-edge job consolidated from 3 parallel variants to 1 job with `--perf-param 3`. Saves 2x ARM64 runner minutes per push.

## What to Do Next

### Immediate

1. **Verify Chrome unit tests pass without kill step** — The `pkill` was removed. Confirm `context.close()` releases the profile cleanly.
2. **Monitor unit test results from in-progress runs** — The oldest run's unit tests should complete or timeout within ~10 min.

### Short-term (make Edge CI reliable)

3. **Increase unit test warm-up timeout to 30+ min** — The 20-min warm-up timeout is too short. The process needs 23-44 min for first inference. Increasing to 35 min (or removing the timeout entirely) would let the warm-up complete on most runners.
4. **Consider `continue-on-error` for Edge e2e** — E2e always times out at 45 min on ARM64. Make it advisory while unit tests are the quality gate.
5. **Consider skipping e2e warm-up prompt** — Since e2e warm-up is wasted (process dies at step end), skip the warm-up prompt in e2e fixtures to save 45 min of runner time. Let unit tests handle the cold-start.

### Medium-term

6. **Update docs/** — CI workflow architecture, e2e test architecture, and unit test architecture docs are outdated.
7. **File upstream issues** — `@angular/build:unit-test` headless override in CI, Vitest double globalSetup invocation.

## Files Changed (both sessions)

### CI workflow

- `.github/workflows/ci.yml` — Split into build-chrome-image → test-chrome + test-edge jobs
- `.github/docker/Dockerfile` — Chrome Beta + system deps (no model)

### E2E tests

- `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` — `seedLocalState()`, warm-up reorder, diagnostics, refresh delay, `headless: false`
- `apps/in-browser-ai-coding-agent-e2e/playwright.config.ts` — Retries 0 in CI
- `apps/in-browser-ai-coding-agent-e2e/project.json` — E2e configurations (chrome, edge)

### Unit tests

- `apps/in-browser-ai-coding-agent/global-setup.shared.ts` — Shared warm-up logic, PID guard, diagnostics
- `apps/in-browser-ai-coding-agent/global-setup.ts` — Thin entry (all browsers)
- `apps/in-browser-ai-coding-agent/global-setup.chrome.ts` — Chrome-only entry
- `apps/in-browser-ai-coding-agent/global-setup.edge.ts` — Edge-only entry
- `apps/in-browser-ai-coding-agent/vitest.shared.mts` — Config factory, `headless: false`
- `apps/in-browser-ai-coding-agent/vitest.config.chrome.mts` — Chrome-only config
- `apps/in-browser-ai-coding-agent/vitest.config.edge.mts` — Edge-only config
- `apps/in-browser-ai-coding-agent/vitest.config.mts` — Default (both browsers)
- `apps/in-browser-ai-coding-agent/project.json` — test-chrome, test-edge targets, `headless: false`

### Bootstrap

- `scripts/bootstrap-ai-model.mjs` — `--perf-param` flag, debug logs flag

### Documentation

- `AGENTS.md` — Updated gotchas, design decisions, rejected approaches
- `.planning/research/*.md` — 7 research documents
- `plans/fix-edge-ci-model-warmup.prompt.md` — This file
