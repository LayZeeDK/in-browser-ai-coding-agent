# Testing and CI Infrastructure Summary

**Project:** in-browser-ai-coding-agent
**Date:** 2026-03-23 (updated from 2026-03-22)
**Confidence:** HIGH -- all findings are empirically verified through CI runs and corroborated by browser source code analysis.

> **Session 3 update (2026-03-23):** Major architecture changes. CI split from 1 matrix job into 4 independent jobs (`e2e-chrome`, `test-chrome`, `e2e-edge`, `test-edge`). Unit test warm-up moved from globalSetup (separate browser, wasted) to `browser-warmup.ts` setupFile (same browser as tests). E2e fixture simplified (no diagnostics navigation). Shared browser config extracted to `@layzeedk/browser-profiles` Nx lib. See `AGENTS.md` for current architecture.

---

## Executive Summary

This project tests an Angular application that runs AI models entirely inside the browser using the W3C LanguageModel API. Two browser/model combinations are supported: Chrome Beta with Gemini Nano (CPU inference via XNNPACK on Linux) and Edge Dev with Phi-4 Mini (CPU inference via ONNX Runtime on Windows ARM64). The models are multi-gigabyte, require specific feature flags and persistent browser profiles, and have cold-start times measured in minutes. This makes the testing infrastructure fundamentally different from a typical web application: the browsers are not interchangeable rendering engines but the AI runtime itself.

The CI pipeline runs on two GitHub Actions runners -- `ubuntu-latest` (containerized, for Chrome Beta) and `windows-11-arm` (bare runner, for Edge Dev) across four independent test jobs. Both e2e tests (Playwright) and unit tests (Vitest browser mode) execute real model inference against real on-device models. There are no cloud APIs, no mocks, no simulations -- the tests launch actual branded browsers, load real on-device language models, and perform real inference. The architecture is constrained by three hard problems: Chrome's ProcessSingleton lockfile prevents rapid browser relaunches, Phi-4 Mini has a 23-110 minute cold-start on ARM64 CI, and macOS runners are entirely incompatible due to insufficient GPU memory with no CPU fallback in ONNX Runtime's CoreML execution provider. Every design decision -- worker-scoped fixtures, retry loops, in-browser warm-up, profile caching -- exists to work within these constraints.

## Key Findings

### CI Workflow Structure

> Detail: [ci-workflow-architecture.md](ci-workflow-architecture.md)

The CI workflow has seven jobs: `build-chrome-image` (Docker image), `format` (PR-only), `lint-typecheck-build` (static analysis + build), and four independent test jobs (`e2e-chrome`, `test-chrome`, `e2e-edge`, `test-edge`). Chrome jobs run in Docker containers on `ubuntu-latest`. Edge jobs run on bare `windows-11-arm` runners.

**Core design decisions:**

- **Four independent test jobs** -- each browser/test-type combination runs on its own VM. No shared disk state, no ProcessSingleton conflicts between e2e and unit tests.
- **E2e and unit tests warm up independently** -- each job runs its own warm-up in its own browser process. ONNX compilation is per-process, so sharing warm-up across jobs is not possible.
- **Cache saved only on success** -- `steps.unit-tests.outcome == 'success'` prevents saving corrupt profiles from timed-out runs (browser killed mid-ONNX write).
- **Separate cache namespaces** -- `msedge-dev-e2e-edge-v1-*` and `msedge-dev-test-edge-v1-*` prevent race conditions between parallel jobs.
- **120-min step timeout for Edge** -- ONNX cold-start on ARM64 CI takes 23-110 min depending on co-tenant load.

### E2E Test Architecture

> Detail: [e2e-test-architecture.md](e2e-test-architecture.md)

E2e tests use Playwright with a **worker-scoped persistent context** -- the browser launches once per worker and stays alive for all tests. Combined with `workers: 1`, this means exactly one browser process for the entire test run.

**Key patterns:**

- **Worker-scoped fixture** solves ProcessSingleton: no close-relaunch cycle between tests. 5-attempt retry loop with 2s delay handles residual lockfile contention.
- **Simplified warm-up**: fixture navigates to the app URL, then runs `LanguageModel.create()` + `session.prompt('warmup')` via `page.evaluate()`. No navigation to internal pages — the LanguageModel API is available on any secure-context page.
- **`seedLocalState()` from `@layzeedk/browser-profiles`** seeds chrome://flags and creates the profile directory before browser launch. Single source of truth shared with unit tests.
- **All tests import from `./fixtures`**, not `@playwright/test`, to ensure every test uses the shared persistent context.

### Unit Test Architecture

> Detail: [unit-test-architecture.md](unit-test-architecture.md)

Unit tests run in **real branded browsers** via Vitest browser mode with `@vitest/browser-playwright`. This is a hard requirement: the LanguageModel API only exists in branded Chromium builds, not in JSDOM, Playwright's bundled Chromium, or headless mode.

**Key patterns:**

- **Persistent contexts** via `@vitest/browser-playwright`'s `persistentContext` option preserve cached model files across runs.
- **`browser-warmup.ts` setupFile** warms the model in the **same browser process** as tests. This is critical: ONNX compilation state is per-process. The previous approach (globalSetup launching a separate browser) wasted 20+ min of compilation — the browser closed before tests started, losing all compilation state.
- **`globalSetup` only seeds profiles**: calls `seedLocalState()` from `@layzeedk/browser-profiles` (file operations — creates directory, seeds flags). No browser is launched.
- **`globalThis.__vitest_warmup_done` flag** prevents redundant warm-up across test files (Vitest `setupFiles` run per file, not once globally).
- **Model availability guard tests** fail fast with diagnostic messages when the environment is misconfigured.
- **Prompt error detection** uses a CSS selector race (`prompt-response` OR `prompt-error`) to fail immediately with the actual error instead of waiting for a timeout.
- **600-second test timeouts** accommodate Phi-4 Mini on ARM64 CI.

### Platform and Runner Compatibility

> Detail: [platform-runner-findings.md](platform-runner-findings.md)

Extensive experimentation across 6 runner types established which platforms work and which do not.

**What works:**

| Browser     | Runner           | Container                    | AI Model              | Inference Backend |
| ----------- | ---------------- | ---------------------------- | --------------------- | ----------------- |
| Chrome Beta | `ubuntu-latest`  | Docker (dbus pre-configured) | Gemini Nano (~4 GB)   | XNNPACK CPU       |
| Edge Dev    | `windows-11-arm` | Bare runner                  | Phi-4 Mini (~4.93 GB) | ONNX Runtime CPU  |

**Chrome Beta in Docker:** The container pre-configures dbus, which is required for headed Chrome via xvfb. Bare-runner testing was attempted but introduced dbus-related flakiness. The `@1` flag (not `@2`) is critical: the `optimization-guide-on-device-model@2` (BypassPerfRequirement) flag predates Chrome 140's CPU inference support and causes Chrome to incorrectly select the GPU inference backend on no-GPU machines, producing `UnknownError: Other generic failures occurred`. With `@1`, Chrome 147 auto-detects no GPU, verifies CPU requirements (16 GB RAM, 4+ cores -- both met exactly on `ubuntu-latest`), and correctly selects XNNPACK CPU inference.

**Edge Dev on `windows-11-arm`:** This is the only viable runner. Edge downloads ONNX Runtime (`onnxruntime.dll`, `onnxruntime-genai.dll`) as a component update into the browser profile directory -- not the browser installation directory. This means the ONNX Runtime DLLs must be cached along with the model weights; caching only the model files would force Edge to re-download the entire runtime. The runner has no GPU at all (Azure Cobalt 100 ARM64 VM), which is paradoxically why it works: ONNX Runtime's DirectML execution provider cannot initialize, so it cleanly falls back to CPU.

**Three levels of model readiness** (important for understanding warm-up design):

| Level | Check                                               | What It Confirms                                                             | Cold-Start Eliminated? |
| ----- | --------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------- |
| 1     | `LanguageModel.availability() === 'available'`      | Model files exist on disk                                                    | No                     |
| 2     | "Foundational model state: Ready" on internals page | Model registered with browser's LLM service                                  | No                     |
| 3     | First `session.prompt()` call completes             | Full inference pipeline initialized (ONNX session, weights loaded, KV cache) | **Yes**                |

This is why the warm-up runs `session.prompt('warmup')` and not just `create()` + `destroy()`. Only a full prompt-response cycle (Level 3) triggers the complete inference pipeline initialization.

**What does not work and why:**

| Runner                         | Failure Reason                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `windows-latest` (Server 2025) | Server SKU rejected by Edge's model delivery system (requires Windows 10/11 Desktop)                                        |
| `macos-26-intel`               | Intel iGPU has 1.5 GB VRAM; Phi-4 Mini needs 5.5 GB; CoreML crashes on GPU allocation (resource-level failure, no fallback) |
| `macos-latest` (M1)            | Only 7 GB RAM (16 GB minimum) and 1 GB MPS GPU cap; insufficient for both CPU and GPU inference                             |
| `ubuntu-24.04-arm`             | No Chrome Beta ARM64 .deb package available                                                                                 |

**The paradox:** No GPU is better than an inadequate GPU. When no GPU exists, ONNX Runtime cleanly falls back to CPU. When an inadequate GPU exists, CoreML's capability-level check passes (it can handle the operators), but it crashes during memory allocation (resource-level failure has no fallback). There is no environment variable or external mechanism to force CPU-only inference in Edge's embedded ONNX Runtime -- no `ORT_DISABLE_GPU`, no `ORT_USE_CPU_ONLY`, and `--disable-gpu` only affects Chromium's renderer pipeline, not Edge's separate ONNX Runtime process.

## Critical Constraints

These constraints shape every architectural decision and cannot be worked around:

### 1. Chrome ProcessSingleton

Chromium enforces single-process access to a user data directory via a lockfile. On Windows, `chrome_crashpad_handler` holds the lockfile for seconds after browser close. The lockfile enters a "delete pending" state where `CreateFile` with `CREATE_NEW` fails with `ERROR_ACCESS_DENIED`. This is tracked across multiple Playwright issues: [#2828](https://github.com/microsoft/playwright/issues/2828), [#6123](https://github.com/microsoft/playwright/issues/6123), [#6310](https://github.com/microsoft/playwright/issues/6310), [#12830](https://github.com/microsoft/playwright/issues/12830). Edge Dev does not exhibit this problem.

**Mitigations:** Worker-scoped fixtures (no close-relaunch cycle), 5-attempt retry loops with 2s delay, `retries: 2` in both Playwright and Vitest configs.

### 2. Phi-4 Mini Cold-Start (23-110 minutes on CI ARM64)

First `session.prompt()` call after a fresh profile launch requires ONNX Runtime to compile the execution graph and load ~4 GB of model weights. `LanguageModel.create()` alone completes in <1s -- the cost is specifically on the first inference call. The wide range (23-110 min) is due to co-tenant interference on shared Azure Cobalt 100 runners (4 vCPU, no GPU, software rendering only).

**Mitigations:** `browser-warmup.ts` (Vitest setupFile) and e2e fixture both run `session.prompt('warmup')` in the test browser process. No timeout on the warm-up — the CI step timeout (120 min) is the backstop. Rolling profile cache preserves `adapter_cache.bin` and `encoder_cache.bin` across CI runs. Cache saved only on success to avoid persisting corrupt state.

### 3. macOS Incompatibility

No macOS runner can run Phi-4 Mini. ONNX Runtime's CoreML execution provider has no resource-level GPU fallback, and there is no environment variable or external mechanism to force CPU-only inference in Edge's embedded ONNX Runtime. This is a hard platform restriction.

### 4. No Headless Mode

The LanguageModel API requires GPU or CPU inference pipelines not available in headless mode. All tests run headed. Linux CI requires `xvfb-run --auto-servernum` for a virtual display.

### 5. Branded Browsers Required

The LanguageModel API only exists in branded Chromium channels (Chrome Beta, Edge Dev), not in Playwright's bundled Chromium. Tests must install and launch real browser builds with specific feature flags.

## Quick Reference

### Test Execution Flow

```
CI Workflow
  |
  +-- build-chrome-image (Docker image for Chrome Beta)
  +-- format (PR-only)
  +-- lint-typecheck-build
  +-- e2e-chrome (ubuntu-latest container)
  |     +-- Fixture: navigate to app, LanguageModel.create() + session.prompt('warmup')
  |     +-- example.spec.ts, prompt.spec.ts
  +-- test-chrome (ubuntu-latest container)
  |     +-- globalSetup: seedLocalState() (file ops only, no browser)
  |     +-- browser-warmup.ts (setupFile): warm up in Vitest's browser
  |     +-- 3 test files (13 tests)
  +-- e2e-edge (windows-11-arm)
  |     +-- Restore model cache, bootstrap (cache miss only)
  |     +-- Fixture: navigate to app, LanguageModel.create() + session.prompt('warmup')
  |     +-- example.spec.ts, prompt.spec.ts
  |     +-- Save model cache (success only)
  +-- test-edge (windows-11-arm)
        +-- Restore model cache, bootstrap (cache miss only)
        +-- globalSetup: seedLocalState() (file ops only, no browser)
        +-- browser-warmup.ts (setupFile): warm up in Vitest's browser
        +-- 3 test files (13 tests)
        +-- Save model cache (success only)
```

### Timeouts

| Context                       | Timeout            | Reason                                 |
| ----------------------------- | ------------------ | -------------------------------------- |
| Bootstrap model download      | 10 min (600s)      | Large model download over network      |
| E2E fixture (worker scope)    | 3h (10,800,000ms)  | Matches CI step timeout                |
| Per-test prompt inference     | 10 min (600s)      | Phi-4 Mini worst-case on ARM64         |
| Element wait (component test) | 10 min (600,000ms) | Matches test timeout                   |
| CI step timeout (Chrome)      | 45 min             | Chrome warm-up is fast (~38s)          |
| CI step timeout (Edge)        | 180 min            | Edge ONNX cold-start takes 23-110+ min |

### Caching Strategy

| Cache                   | Scope            | Key Strategy                                                                                                                       |
| ----------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| npm download cache      | Ubuntu jobs      | `setup-node` with `cache: 'npm'`                                                                                                   |
| node_modules direct     | Windows ARM only | Keyed to `runner.os + runner.arch + .node-version + package-lock.json` hash; `restore-keys` for incremental install on partial hit |
| AI model profile (e2e)  | Edge e2e only    | `msedge-dev-e2e-edge-v1-run{N}`; saved only on e2e success                                                                         |
| AI model profile (unit) | Edge unit only   | `msedge-dev-test-edge-v1-run{N}`; saved only on unit test success                                                                  |
| Docker container image  | Chrome Beta only | Rebuilt on Node/Playwright/Dockerfile changes; versioned + `:latest` tags                                                          |

**Critical:** Model caches are saved only on test success (`steps.*.outcome == 'success'`). Timed-out runs may have corrupt profiles (browser killed mid-ONNX write). E2e and unit test jobs have separate cache namespaces to prevent race conditions.

### Feature Flags

| Browser     | Flag                                         | Value           | Purpose                                                                                                                     |
| ----------- | -------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Chrome Beta | `optimization-guide-on-device-model`         | `@1` (not `@2`) | Enable model system; `@2` (BypassPerfRequirement) predates Chrome 140 CPU support and forces GPU backend on no-GPU machines |
| Chrome Beta | `prompt-api-for-gemini-nano`                 | `@1`            | Expose LanguageModel API                                                                                                    |
| Edge Dev    | `edge-llm-prompt-api-for-phi-mini`           | `@1`            | Enable Phi-4 Mini via LanguageModel API                                                                                     |
| Edge Dev    | `edge-llm-on-device-model-performance-param` | `@3`            | Configure performance parameters                                                                                            |

### Playwright Default Args Removed

These four Playwright defaults must be removed via `ignoreDefaultArgs` for the LanguageModel API to function:

| Default Arg                               | What It Breaks                                |
| ----------------------------------------- | --------------------------------------------- |
| `--disable-features=...OptimizationHints` | Model delivery via Optimization Guide         |
| `--disable-field-trial-config`            | Model eligibility field trials                |
| `--disable-background-networking`         | Variations seed fetch and model update checks |
| `--disable-component-update`              | Model component registration                  |

### Chrome vs Edge Inference Stacks

| Aspect                 | Chrome (Gemini Nano)               | Edge (Phi-4 Mini)                    |
| ---------------------- | ---------------------------------- | ------------------------------------ |
| Inference runtime      | LiteRT-LM (TFLite)                 | ONNX Runtime                         |
| Runtime delivery       | Built into browser binary          | Downloaded as component into profile |
| GPU backend            | WebGPU via Dawn                    | DirectML (Windows), CoreML (macOS)   |
| CPU backend            | XNNPACK                            | ONNX Runtime CPU EP                  |
| `--disable-gpu` effect | YES (indirect, via WebGPU adapter) | NO (separate DX12/CoreML pipeline)   |
| Model format           | LiteRT/TFLite                      | ONNX                                 |
| Flag prefix            | `optimization-guide-*`             | `edge-llm-*`                         |
| Profile directory      | `OptGuideOnDeviceModel/`           | `EdgeLLMOnDeviceModel/`              |

## Detailed Documents

| Document                                                   | Scope                  | Key Topics                                                                    |
| ---------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| [platform-runner-findings.md](platform-runner-findings.md) | Platform compatibility | Runner viability, GPU vs CPU inference, macOS failures, BypassPerfRequirement |

CI workflow, E2E, and unit test architecture details are in `AGENTS.md` and the sections above.

---

_Summary compiled: 2026-03-22, updated: 2026-03-23_
