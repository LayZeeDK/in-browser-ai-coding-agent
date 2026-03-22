# Testing and CI Infrastructure Summary

**Project:** in-browser-ai-coding-agent
**Date:** 2026-03-22
**Confidence:** HIGH -- all findings are empirically verified through CI runs and corroborated by browser source code analysis.

---

## Executive Summary

This project tests an Angular application that runs AI models entirely inside the browser using the W3C LanguageModel API. Two browser/model combinations are supported: Chrome Beta with Gemini Nano (CPU inference via XNNPACK on Linux) and Edge Dev with Phi-4 Mini (CPU inference via ONNX Runtime on Windows ARM64). The models are multi-gigabyte, require specific feature flags and persistent browser profiles, and have cold-start times measured in minutes. This makes the testing infrastructure fundamentally different from a typical web application: the browsers are not interchangeable rendering engines but the AI runtime itself.

The CI pipeline runs on two GitHub Actions runners -- `ubuntu-latest` (containerized, for Chrome Beta) and `windows-11-arm` (bare runner, for Edge Dev). Both e2e tests (Playwright) and unit tests (Vitest browser mode) execute real model inference against real on-device models. There are no cloud APIs, no mocks, no simulations -- the tests launch actual branded browsers, load real on-device language models, and perform real inference. The architecture is constrained by three hard problems: Chrome's ProcessSingleton lockfile prevents rapid browser relaunches, Phi-4 Mini has an 11+ minute cold-start on ARM64, and macOS runners are entirely incompatible due to insufficient GPU memory with no CPU fallback in ONNX Runtime's CoreML execution provider. Every design decision -- worker-scoped fixtures, retry loops, model warm-up sequences, profile caching -- exists to work within these constraints.

The recommended approach is fully implemented and working. The key risk is fragility around model availability: Chrome and Edge's on-device model systems are pre-release features with transient failure modes ("Not Ready For Unknown Reason") that require polling and retrying. The infrastructure handles this today, but changes in browser behavior across Chrome Beta and Edge Dev releases could require ongoing maintenance.

## Key Findings

### CI Workflow Structure

> Detail: [ci-workflow-architecture.md](ci-workflow-architecture.md)

The CI workflow has four jobs: `ghcr` (container image name resolution), `format` (PR-only formatting check), `lint-typecheck-build` (static analysis and production build), and `test` (matrix job running e2e and unit tests with real AI models). The first three are fast and stateless. The test job is the expensive one.

**Core design decisions:**

- **Two-entry test matrix** with `fail-fast: false` -- Chrome and Edge run independently; a failure in one does not suppress results from the other.
- **E2e runs before unit tests** -- e2e serves as model warm-up; unit tests benefit from a pre-warmed inference engine. The e2e fixture runs `session.prompt('warmup')` which triggers the full inference pipeline initialization (11+ minutes on ARM), so by the time unit tests run, the model's ONNX Runtime session, weights, and KV cache are already in memory.
- **Unit tests run even if e2e fails** -- gated only on bootstrap success (`steps.bootstrap.outcome != 'failure'`), not on e2e outcome.
- **Rolling model cache** -- cache key includes `run_number` for immutable GHA cache entries; `restore-keys` prefix matching implements a rolling cache pattern. The cache is saved **post-test** (not post-bootstrap) because inference-time artifacts (`adapter_cache.bin`, `encoder_cache.bin`, compiled model shards) are generated during actual inference and must be captured for subsequent runs to start warm.

### E2E Test Architecture

> Detail: [e2e-test-architecture.md](e2e-test-architecture.md)

E2e tests use Playwright with a **worker-scoped persistent context** -- the browser launches once per worker and stays alive for all tests. Combined with `workers: 1`, this means exactly one browser process for the entire test run.

**Why worker-scoped fixture (and not alternatives):** Three other approaches were tried and failed. `globalSetup` (commit `4f4326d`) ran warm-up in a separate Node.js process, which launched its own browser and then closed it -- when test workers tried to launch against the same profile, Chrome's ProcessSingleton rejected the second launch because `chrome_crashpad_handler` from the globalSetup browser was still holding the lockfile. Per-test fixtures meant closing and relaunching the browser for each test, directly triggering ProcessSingleton conflicts. Vitest's `setupFiles` runs in the browser context and has no access to Playwright's `launchPersistentContext()` API. The worker-scoped fixture avoids the close-relaunch cycle entirely: the browser launches once and stays alive for all tests.

**Key patterns:**

- **Worker-scoped fixture** solves ProcessSingleton: no close-relaunch cycle between tests.
- **5-attempt retry loop with 2s delay** handles residual lockfile contention from `chrome_crashpad_handler`.
- **`retries: 2` unconditionally** (not just CI) because ProcessSingleton flakiness affects local development equally.
- **All tests import from `./fixtures`**, not `@playwright/test`, to ensure every test uses the shared persistent context. Importing from `@playwright/test` caused Playwright to launch a second managed Chrome instance alongside the persistent one, triggering ProcessSingleton conflicts.
- **`internal_only_uis_enabled` seeded in Local State** before browser launch to bypass the gate page on `chrome://on-device-internals`. This flag is seeded in three places (bootstrap script, e2e fixture, Vitest global-setup) for redundancy -- each entry point must ensure the flag is set regardless of whether previous entry points ran. Programmatic seeding was chosen because clicking the enable button in Docker containers crashes the browser (the button opens a new tab in Chrome's default profile, escaping the Playwright context).

### Unit Test Architecture

> Detail: [unit-test-architecture.md](unit-test-architecture.md)

Unit tests run in **real branded browsers** via Vitest browser mode with `@vitest/browser-playwright`. This is a hard requirement: the LanguageModel API only exists in branded Chromium builds, not in JSDOM, Playwright's bundled Chromium, or headless mode.

**Key patterns:**

- **Persistent contexts** via `@vitest/browser-playwright` v4.1.0's `persistentContext` option preserve cached model files across runs.
- **Global setup warm-up** (`global-setup.ts`) front-loads the cold-start cost before any test runs. Critically, the warm-up must run `session.prompt('warmup')` -- not just `LanguageModel.create()` followed by `session.destroy()`. `create()` only loads model files into memory; the first actual `prompt()` call triggers additional pipeline initialization (tokenizer setup, attention weight materialization, KV cache allocation) which takes 11+ minutes on ARM. This was discovered the hard way: removing the warm-up prompt caused test timeouts, and it was restored in commit `7aa55ad`.
- **Model availability guard tests** fail fast with diagnostic messages when the environment is misconfigured, instead of timing out after 240 seconds.
- **Prompt error detection** uses a CSS selector race (`prompt-response` OR `prompt-error`) to fail immediately with the actual error instead of waiting for a timeout.
- **300-second test timeouts** accommodate Phi-4 Mini worst-case cold-start on ARM64 CI.

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

### 2. Phi-4 Mini Cold-Start (11+ minutes on ARM64)

First `session.prompt()` call after a fresh profile launch requires ONNX Runtime to compile the execution graph and load ~4 GB of model weights. `LanguageModel.create()` alone completes quickly -- the 11+ minute cost is specifically on the first inference call, which triggers tokenizer setup, attention weight materialization, and KV cache allocation.

**Mitigations:** Warm-up runs `session.prompt('warmup')` (not just create+destroy) to front-load the full pipeline initialization. Rolling profile cache preserves `adapter_cache.bin` and `encoder_cache.bin` across CI runs. 300-second per-test timeouts, 600-second global setup deadline, 20-minute e2e fixture timeout.

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
  +-- ghcr (resolve container image name)
  +-- format (PR-only, parallel with lint)
  +-- lint-typecheck-build (parallel with format)
  +-- test (matrix: chrome-beta + msedge-dev)
        |
        +-- Restore model profile cache
        +-- Bootstrap AI model (cache miss only)
        +-- E2E tests (Playwright, worker-scoped persistent context)
        |     +-- Fixture: warm-up model via on-device-internals
        |     |     +-- LanguageModel.create() + session.prompt('warmup')
        |     |     +-- Wait for "Foundational model state: Ready"
        |     +-- example.spec.ts (basic app tests)
        |     +-- prompt.spec.ts (real inference, logs to GITHUB_STEP_SUMMARY)
        +-- Unit tests (Vitest browser mode, persistent context)
        |     +-- global-setup.ts: warm-up model independently
        |     |     +-- Same warm-up sequence (fast -- model already warm from e2e)
        |     +-- language-model.service.spec.ts (API + prompt tests)
        |     +-- model-status.component.spec.ts (component + prompt tests)
        +-- Save model profile cache (post-test, captures inference artifacts)
```

### Timeouts

| Context                       | Timeout         | Reason                                     |
| ----------------------------- | --------------- | ------------------------------------------ |
| Bootstrap model download      | 10 min (600s)   | Large model download over network          |
| E2E fixture warm-up           | 20 min (1,200s) | First-time model download + compilation    |
| Global setup warm-up          | 10 min (600s)   | Model compilation on cold profile          |
| Per-test prompt inference     | 5 min (300s)    | Phi-4 Mini worst-case cold-start           |
| Element wait (component test) | 4 min (240s)    | Leaves 60s buffer within 300s test timeout |
| CI step timeout               | 45 min          | Outer safety net against hangs             |

### Caching Strategy

| Cache                  | Scope              | Key Strategy                                                                                                         |
| ---------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| npm download cache     | Ubuntu (container) | `setup-node` with `cache: 'npm'`                                                                                     |
| node_modules direct    | Windows ARM only   | Keyed to `runner.os + runner.arch + package-lock.json` hash; skip `npm ci` on hit                                    |
| AI model profile       | Both runners       | Rolling key with `run_number` suffix; `restore-keys` prefix matching; saved post-test to capture inference artifacts |
| Docker container image | Chrome Beta only   | Rebuilt on Node/Playwright/Dockerfile changes; versioned + `:latest` tags                                            |

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

| Document                                                   | Scope                  | Key Topics                                                                                               |
| ---------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| [ci-workflow-architecture.md](ci-workflow-architecture.md) | CI pipeline            | Job structure, test matrix, Docker strategy, caching, bootstrap script, step guards, concurrency         |
| [e2e-test-architecture.md](e2e-test-architecture.md)       | E2E tests              | Worker-scoped fixtures, ProcessSingleton handling, model warm-up, persistent profiles, Playwright config |
| [unit-test-architecture.md](unit-test-architecture.md)     | Unit tests             | Vitest browser mode, persistent contexts, global setup, guard tests, prompt error detection, timeouts    |
| [platform-runner-findings.md](platform-runner-findings.md) | Platform compatibility | Runner viability, GPU vs CPU inference, macOS failures, BypassPerfRequirement bug, npm caching           |

---

_Summary compiled: 2026-03-22_
