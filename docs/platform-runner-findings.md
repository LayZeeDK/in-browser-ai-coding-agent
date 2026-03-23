# Platform and Runner Findings

**Compiled:** 2026-03-22
**Source:** Extensive CI experimentation across 6 GitHub Actions runner types (ubuntu-latest, windows-11-arm, windows-latest, macos-14, macos-15/26, macos-26-intel), 2 browser engines (Chrome Beta, Edge Dev), and 2 AI models (Gemini Nano, Phi-4 Mini).
**Confidence:** HIGH -- findings are empirically verified through CI runs, corroborated by Chromium source code analysis (`gpu_blocklist.cc`), ONNX Runtime documentation, filesystem inspection of browser profile directories, and official GitHub/Microsoft/Google docs.

---

## Table of Contents

1. [Chrome Beta + Gemini Nano on ubuntu-latest](#1-chrome-beta--gemini-nano-on-ubuntu-latest)
2. [Edge Dev + Phi-4 Mini on windows-11-arm](#2-edge-dev--phi-4-mini-on-windows-11-arm)
3. [windows-latest (Windows Server 2025)](#3-windows-latest-windows-server-2025)
4. [macOS Runners](#4-macos-runners)
5. [GPU vs CPU Inference Control](#5-gpu-vs-cpu-inference-control)
6. [Chrome ProcessSingleton on Windows](#6-chrome-processsingleton-on-windows)
7. [npm/node_modules Caching](#7-npmnode_modules-caching)
8. [Runner Viability Summary](#8-runner-viability-summary)

---

## 1. Chrome Beta + Gemini Nano on ubuntu-latest

**Status:** Working (Docker container).
**Runner:** `ubuntu-latest` (4 vCPU, 16 GB RAM, no GPU, Intel Xeon 8272CL with AVX2/AVX-512).

### The BypassPerfRequirement Bug

The `optimization-guide-on-device-model@2` flag sets `BypassPerfRequirement`, which was designed before Chrome 140 added CPU inference support. On Chrome 147 (the current Beta channel), this flag causes Chrome to incorrectly select the GPU inference backend on machines with no GPU, producing the error:

```
UnknownError: Other generic failures occurred.
```

The model downloads successfully and `LanguageModel.availability()` returns `'available'` because the download path and the inference path are separate. The download path checks component registration; the inference path loads the model into LiteRT-LM via either the GPU delegate (WebGPU/Vulkan) or the CPU delegate (XNNPACK). With `@2`, Chrome skips the performance shader test that would have detected "no GPU" and routed to CPU.

**Discovery:** A developer on the Chrome AI discussion group reported Chrome incorrectly selecting "GPU (highest quality)" backend on a no-GPU PC when flags were manually set. The Chromium team's advice was clear: do not set flags manually, let Chrome auto-detect. This directly led to the switch from `@2` to `@1`.

**Fix:** Switch from `@2` to `@1` (Enabled, normal performance detection). Chrome 147 then auto-detects no GPU, verifies the CPU static requirements (16 GB RAM, 4+ cores -- both met exactly), and selects XNNPACK CPU inference.

**Source:** [Chrome AI dev group: Backend Type mismatch](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/TFVnnmIoJPE)

### Docker Container vs Bare Runner

The Docker container works for the Chrome Beta job. Key considerations:

| Factor         | Docker Container                                                                                          | Bare Runner                                                |
| -------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| GPU detection  | May return anomalous results from SwiftShader (partially succeeds rather than cleanly returning "no GPU") | Cleanly returns "no GPU"                                   |
| dbus           | Pre-configured in the custom image                                                                        | Must be configured; missing dbus causes flaky e2e failures |
| `/dev/shm`     | 64 MB default (mitigated by `--ipc=host`)                                                                 | System default (larger)                                    |
| Chrome sandbox | Needs `--no-sandbox` (non-root user)                                                                      | Native namespace sandbox works                             |
| TFLite CPU     | Works -- XNNPACK is pure userspace, no kernel access or GPU needed                                        | Works                                                      |

The bare runner approach was also tested. It eliminates the container isolation layer but introduced dbus-related flakiness in e2e tests. The Docker container has dbus pre-configured, making it more reliable for headed Chrome (via xvfb).

**Docker does not block TFLite CPU inference.** XNNPACK is a pure userspace library that runs CPU inference without special kernel access or GPU. A Docker container for CPU-only TFLite inference is a well-tested pattern. The container approach works because the `@1` flag lets Chrome correctly auto-detect CPU -- even if Docker's environment causes the GPU shader probe to partially succeed via SwiftShader rather than cleanly failing, Chrome's auto-detection logic (not bypassed by `@1`) still correctly routes to CPU.

### Hardware Requirements for Gemini Nano CPU Inference

| Requirement | Minimum                                               | ubuntu-latest                           | Margin      |
| ----------- | ----------------------------------------------------- | --------------------------------------- | ----------- |
| RAM         | 16 GB                                                 | 16 GB                                   | Exact match |
| CPU cores   | 4                                                     | 4                                       | Exact match |
| Free disk   | 22 GB (Chrome's pre-flight check)                     | ~29 GB default, ~50-60 GB after cleanup | Comfortable |
| AVX2        | Helpful but not required (XNNPACK falls back to SSE2) | Yes (Cascade Lake)                      | N/A         |

The model on disk is ~4 GB (v3Nano 2025.06.30.1229 = 4,072 MiB). Chrome's 22 GB requirement is a safety margin, not actual usage.

### Profile Directory Structure (Chrome)

The Chrome profile directory (`OptGuideOnDeviceModel/`) contains:

| Path                                      | Purpose                                      |
| ----------------------------------------- | -------------------------------------------- |
| `OptGuideOnDeviceModel/`                  | Model weights and metadata                   |
| `OptGuideOnDeviceModel/adapter_cache.bin` | Pre-compiled inference adapter data          |
| `OptGuideOnDeviceModel/encoder_cache.bin` | Pre-compiled encoder session data            |
| `GPUPersistentCache/`                     | GPU shader cache (pre-computed for GPU path) |
| `GraphiteDawnCache/`                      | Dawn/WebGPU pipeline cache                   |
| `GrShaderCache/`                          | Skia GPU shader cache                        |

The `adapter_cache.bin` and `encoder_cache.bin` files are likely pre-computed weight projections or compiled inference kernels that speed up subsequent runs. Caching the entire profile directory preserves these.

### Inference Backend Chain

```
LanguageModel.create() / session.prompt()
    |
    v
Chrome Optimization Guide (C++)
    |
    v
LiteRT-LM (inference pipeline)
    |
    v
LiteRT (model execution runtime, formerly TFLite)
    |
    v
[GPU: WebGPU/Dawn/Vulkan]  OR  [CPU: XNNPACK]
```

Chrome's backend selection logic (Chrome 140+):

1. Run GPU performance shader test.
2. If GPU VRAM > 4 GB: GPU backend, download 4B parameter model.
3. If GPU VRAM <= 4 GB but > 0: GPU backend, download 2B parameter model.
4. If no GPU AND RAM >= 16 GB AND cores >= 4: CPU backend via XNNPACK.
5. Otherwise: model unavailable.

**Research files:** [gemini-nano-ci-runner-requirements.md](../research/gemini-nano-ci-runner-requirements.md), [docker-vs-bare-runner-chrome-ai.md](../research/docker-vs-bare-runner-chrome-ai.md)

---

## 2. Edge Dev + Phi-4 Mini on windows-11-arm

**Status:** Working. The only viable runner for Edge Dev's Phi-4 Mini.
**Runner:** `windows-11-arm` (4 vCPU ARM64, 16 GB RAM, **no GPU**, Azure Cobalt 100 / Arm Neoverse N2).

### Runner Hardware: Confirmed No GPU

The `windows-11-arm` runner is an Azure Cobalt ARM64 VM (Ampere Altra architecture) with **no GPU hardware at all**. No DirectX 12, no DirectML, no discrete or integrated GPU. This was confirmed by:

1. Research into the Azure Cobalt 100 processor specifications.
2. Identical performance between `--disable-gpu` and default (GPU-enabled) CI matrix variants: both take ~15-17 minutes. If a GPU existed, the default variant would be faster.

### Why It Works

This is paradoxically why the runner works: ONNX Runtime's DirectML execution provider cannot initialize (no DirectX 12 GPU), so it falls back to CPU inference automatically. The fallback is clean because the GPU never partially initializes -- there is simply nothing to attempt GPU with. Compare this to macOS runners where an inadequate GPU _does_ exist and causes crashes (Section 4).

### ONNX Runtime as a Profile Component

Edge uses ONNX Runtime for inference -- **not** LiteRT-LM like Chrome. Critically, Edge downloads the ONNX Runtime as a component update into the browser profile directory, not the browser installation directory. Filesystem inspection of the profile revealed:

```
EdgeLLMOnDeviceModel/
    onnxruntime.dll          # ONNX Runtime inference library
    onnxruntime-genai.dll    # ONNX Runtime GenAI extension
    [model weights]          # ~4.86 GB main data file
    [tokenizer]              # ~15.5 MB
```

This means the runtime itself must be cached along with the model files. Caching only the model weights without the runtime DLLs would force Edge to re-download the entire ONNX Runtime component.

### Three Levels of Model Readiness

Model readiness is not binary. There are three distinct levels, each with different performance characteristics:

| Level | Check                                                             | What It Confirms                                                                                        | Cold-Start Eliminated? |
| ----- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1     | `LanguageModel.availability() === 'available'`                    | Model files exist on disk                                                                               | No                     |
| 2     | "Foundational model state: Ready" on `edge://on-device-internals` | Model registered with Edge's LLM service                                                                | No                     |
| 3     | First `session.prompt()` call completes                           | Inference pipeline fully initialized (ONNX Runtime session created, weights loaded, KV cache allocated) | **Yes**                |

**The 11+ minute cold-start on ARM is specifically the first `session.prompt()` call.** `LanguageModel.create()` followed by `session.destroy()` completes quickly -- it is not sufficient to eliminate cold-start. Only a full prompt-response cycle (Level 3) triggers the complete inference pipeline initialization: ONNX Runtime session creation, model weight loading into RAM, KV cache allocation, and first-token generation.

### Performance Characteristics

| Metric                                                      | Value                           |
| ----------------------------------------------------------- | ------------------------------- |
| Cold-start (first `session.prompt()`, no cached adapters)   | 11+ minutes                     |
| Warm-start (cached adapter_cache.bin + encoder_cache.bin)   | Faster (not precisely measured) |
| Typical end-to-end test time                                | ~15-17 minutes                  |
| Model size on disk (model.onnx.data)                        | 4.86 GB                         |
| Total profile size (model + runtime + tokenizer + metadata) | ~4.93 GB                        |
| RAM usage for short-context inference                       | ~9-12 GB                        |

### Profile Directory Structure (Edge)

| Path                                         | Purpose                                                  |
| -------------------------------------------- | -------------------------------------------------------- |
| `EdgeLLMOnDeviceModel/`                      | Model weights, runtime DLLs, tokenizer                   |
| `EdgeLLMOnDeviceModel/onnxruntime.dll`       | ONNX Runtime inference library (downloaded as component) |
| `EdgeLLMOnDeviceModel/onnxruntime-genai.dll` | ONNX Runtime GenAI extension                             |
| `EdgeLLMOnDeviceModel/adapter_cache.bin`     | Pre-compiled ONNX Runtime session data                   |
| `EdgeLLMOnDeviceModel/encoder_cache.bin`     | Pre-compiled encoder session data                        |

The `adapter_cache.bin` and `encoder_cache.bin` files are likely pre-computed weight projections or compiled inference kernels. Caching the full profile directory via `actions/cache` preserves these and avoids both the ~4.93 GB model re-download and the cold-start penalty on subsequent CI runs.

### Inference Stack

```
LanguageModel API (Prompt API)
    |
    v
Edge LLM Service (proprietary)
    |
    v
ONNX Runtime (onnxruntime.dll + onnxruntime-genai.dll)
    -- Downloaded into profile as component update, NOT part of browser install --
    |
    v
[DirectML (GPU via DirectX 12)]  OR  [CPU EP (fallback)]
```

On `windows-11-arm` (no GPU): DirectML cannot initialize, so ONNX Runtime uses the CPU execution provider exclusively.

### ARM64 Native Dependencies

The runner executes Node.js natively (not under QEMU). The project has ARM64-native optional packages for all major tools:

| Package           | ARM64 Binary                      |
| ----------------- | --------------------------------- |
| `@swc/core`       | `@swc/core-win32-arm64-msvc`      |
| `esbuild`         | `@esbuild/win32-arm64`            |
| `nx`              | `@nx/nx-win32-arm64-msvc`         |
| `@parcel/watcher` | `@parcel/watcher-win32-arm64`     |
| `lmdb`            | `@lmdb/lmdb-win32-arm64`          |
| `@rollup/rollup`  | `@rollup/rollup-win32-arm64-msvc` |

**Research file:** [edge-dev-gpu-vs-cpu-inference-control.md](../research/edge-dev-gpu-vs-cpu-inference-control.md)

---

## 3. windows-latest (Windows Server 2025)

**Status:** Not supported.
**Runner:** `windows-latest` / `windows-2025` (4 vCPU x64, 16 GB RAM, Windows Server 2025).

### Why It Fails

Microsoft's Prompt API documentation states:

> "The Prompt API is currently limited to: Operating system: Windows 10 or 11 and macOS 13.3 or later."

Windows Server 2025 is a **Server SKU**, not a Desktop SKU. Edge Dev's Phi-4 Mini model delivery system checks for Windows 10/11 (desktop) and rejects Server editions. The model download times out because it never starts -- Edge does not even attempt to download the model on an unsupported OS.

This is a hard platform restriction, not a configuration issue.

**Research file:** [phi4-mini-edge-macos-intel.md](../research/phi4-mini-edge-macos-intel.md) (general platform support analysis)

---

## 4. macOS Runners

**Status:** All failed. No macOS runner can run Edge Dev's Phi-4 Mini.
**Scope of testing:** Extensive -- 6 matrix entries tested across `macos-14`, `macos-15`, `macos-26`, and `macos-26-intel` with various flag combinations including `--disable-gpu`, `--in-process-gpu`, `--no-sandbox`, and performance parameter overrides.

### macOS Intel (`macos-26-intel`)

| Property          | Value                                                        |
| ----------------- | ------------------------------------------------------------ |
| Architecture      | Intel x86_64                                                 |
| RAM               | 14 GB                                                        |
| GPU               | Intel integrated (UHD/Iris)                                  |
| GPU VRAM          | ~1.5 GB (shared from system RAM, hard driver limit of ~2 GB) |
| Required GPU VRAM | 5.5 GB                                                       |
| **Deficit**       | **3.5-4 GB**                                                 |

**Failure mode:** Browser crashes after ~9 minutes. The sequence:

1. Minutes 0-1: Edge launched, flags applied.
2. Minutes 1-8: Model downloaded successfully (~4-6 GB over GitHub Actions network).
3. Minute 8-9: Edge attempted to load model into GPU memory via ONNX Runtime + CoreML + Metal.
4. Minute 9: Metal GPU memory allocation failed (requested ~5.5 GB, Intel iGPU provides 1.5 GB max). **Process crash**, not a graceful error.

The crash happens because ONNX Runtime's CoreML execution provider declares it can handle the model operators (capability-level check passes), but then crashes when it actually tries to allocate GPU memory (resource-level failure has no fallback).

### macOS ARM (`macos-latest` / `macos-14` / `macos-15`, Apple Silicon M1)

| Property          | Value                                          |
| ----------------- | ---------------------------------------------- |
| Architecture      | ARM64 (M1)                                     |
| RAM               | 7 GB                                           |
| GPU               | Apple MPS (paravirtualized)                    |
| GPU VRAM          | ~1 GB (MPS paravirtualization cap in VM)       |
| Required GPU VRAM | 5.5 GB                                         |
| **Deficit**       | **4.5 GB (GPU), 9 GB (RAM for CPU inference)** |

Even worse than Intel: only 7 GB total RAM (16 GB minimum for CPU inference) and a ~1 GB MPS GPU memory cap imposed by Apple's Virtualization framework. The bootstrap fails before the model even finishes downloading, with only 0.6 GB free RAM remaining.

### The Paradox: No GPU Is Better Than an Inadequate GPU

| Runner              | GPU                 | ONNX Runtime Behavior        | Phi-4 Mini Result     |
| ------------------- | ------------------- | ---------------------------- | --------------------- |
| `windows-11-arm`    | **None**            | CPU fallback (clean)         | **SUCCESS** (~15 min) |
| `macos-26-intel`    | Intel iGPU (1.5 GB) | CoreML attempts GPU, crashes | **CRASH** (9 min)     |
| `macos-latest` (M1) | Apple MPS (1 GB)    | CoreML attempts GPU, crashes | **CRASH** (bootstrap) |

When no GPU hardware exists, ONNX Runtime cleanly falls back to CPU. When an inadequate GPU exists, ONNX Runtime's CoreML EP initializes successfully but crashes during memory allocation. There is no resource-level fallback -- only capability-level fallback. ONNX Runtime's fallback mechanism works at the operator level ("can this EP handle this operator?") but **not** at the resource level ("does this EP have enough memory?").

### No Workaround Exists

There is **no environment variable or external mechanism** to force ONNX Runtime to use CPU-only inference:

- No `ORT_DISABLE_GPU`, `ORT_USE_CPU_ONLY`, or `ORT_COREML_COMPUTE_UNITS` variable exists.
- CoreML's `MLComputeUnits` setting (which has a `CPUOnly` option) can only be set programmatically at session creation time, and Edge's embedded ONNX Runtime does not expose this.
- `--disable-gpu` only affects Chromium's renderer/WebGPU pipeline, not Edge's native ONNX Runtime process (see Section 5).
- `edge-llm-on-device-model-performance-param@3` bypasses Edge's hardware eligibility check but does not change the inference backend from GPU to CPU.

### The --in-process-gpu --no-sandbox Discovery

The `--in-process-gpu --no-sandbox` flags were the most useful diagnostic tool across the macOS test matrix. Their effect:

| Flags                           | Behavior                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Default (no flags)              | Edge crashes with opaque "Browser context closed unexpectedly" after ~9 minutes. No actionable error.                                       |
| `--in-process-gpu --no-sandbox` | **Prevented the crash** and revealed Edge's explicit rejection. The error becomes a JavaScript-level exception rather than a process crash. |

With `--in-process-gpu --no-sandbox`, Edge explicitly reports:

```
InvalidStateError: The device is unable to create a session
```

This confirms the GPU memory is insufficient and Edge has no CPU fallback for the Phi-4 Mini model. The `--in-process-gpu` flag runs the GPU process inside the browser's main process, which converts what would be an inter-process crash into a catchable in-process error. `--no-sandbox` was required alongside it to avoid sandbox violations from the merged process model.

**Research files:** [phi4-mini-edge-macos-intel.md](../research/phi4-mini-edge-macos-intel.md), [onnx-runtime-macos-cpu-gpu.md](../research/onnx-runtime-macos-cpu-gpu.md)

---

## 5. GPU vs CPU Inference Control

### Key Finding: `--disable-gpu` Does NOT Control AI Model Inference Directly

The `--disable-gpu` Chromium flag affects the **renderer's GPU pipeline** (compositing, WebGPU, WebGL, video decode). It does NOT directly control the AI model inference backend. However, it has an **indirect effect** on Chrome's inference backend (only Chrome, not Edge) through this chain:

```
--disable-gpu
    |
    v
Prevents GPU subsystem initialization
    |
    v
WebGPU adapter creation returns null (gpu_blocklist.cc)
    |
    v
On-device model service detects kGpuConfigError
    |
    v
Falls back to CPU inference (XNNPACK)
```

Chrome's `gpu_blocklist.cc` (in `services/on_device_model/ml/`) uses `api.QueryGPUAdapter()` to determine GPU availability. When `--disable-gpu` prevents adapter creation, the on-device model service receives `GpuBlockedReason::kGpuConfigError` and falls back to CPU. The flag does **not** contain an explicit `--disable-gpu` check -- the effect propagates indirectly through the GPU subsystem.

### Two Completely Separate GPU Paths in Edge

**This is confirmed by Chromium source code analysis of `gpu_blocklist.cc`.** Edge has **two independent GPU initialization paths**:

1. **Chromium renderer GPU path**: Controlled by `--disable-gpu`. Manages WebGPU/Dawn, GPU compositing, hardware video decode. This is standard Chromium code shared between Chrome and Edge.

2. **Edge ML inference GPU path**: NOT controlled by any Chromium flag. Uses ONNX Runtime (`onnxruntime.dll` + `onnxruntime-genai.dll`, downloaded as a component into the profile) with platform-specific execution providers:
   - **Windows:** DirectML (DirectX 12 GPU, separate DX12 pipeline built specifically for ML inference)
   - **macOS:** CoreML (Metal GPU, Neural Engine, or CPU -- but no way to force CPU externally)

When `--disable-gpu` is set on Edge:

- Path 1 switches to software rendering (adds CPU overhead for compositing).
- Path 2 is **completely unaffected** -- the ONNX Runtime native process has its own GPU initialization independent of Chromium's GPU process. CoreML still initializes Metal GPU, DirectML still initializes DirectX 12.

This architectural separation was further evidenced by Edge's Video Super Resolution feature documentation, which describes Edge building "a new flexible DX12 pipeline into the Chromium engine" specifically for ML inference, separate from Chromium's DX11 rendering pipeline.

### Performance Parity on windows-11-arm Proves No GPU

Both the "GPU-enabled" and `--disable-gpu` CI matrix variants show identical ~15-17 minute timings on `windows-11-arm`. This is expected and proves the runner has no GPU: both configurations are already running CPU inference. The `--disable-gpu` flag has no observable effect because there is no GPU to disable in either path.

**Recommendation:** Remove the `--disable-gpu` matrix variant for `windows-11-arm`. It adds CI time without providing any differentiation.

### Chrome vs Edge Inference Stacks

| Aspect                              | Chrome (Gemini Nano)                                                                                    | Edge (Phi-4 Mini)                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Inference runtime                   | LiteRT-LM (TFLite)                                                                                      | ONNX Runtime                                                                             |
| Runtime delivery                    | Built into browser binary                                                                               | Downloaded as component update into profile (`onnxruntime.dll`, `onnxruntime-genai.dll`) |
| GPU backend                         | WebGPU via Dawn                                                                                         | DirectML (Windows), CoreML/Metal (macOS)                                                 |
| CPU backend                         | XNNPACK                                                                                                 | ONNX Runtime CPU EP                                                                      |
| `--disable-gpu` effect on inference | YES (indirect, via WebGPU adapter in `gpu_blocklist.cc`)                                                | **NO** (separate DX12/CoreML pipeline, independent of Chromium renderer)                 |
| Model format                        | LiteRT/TFLite                                                                                           | ONNX                                                                                     |
| Model delivery                      | Optimization Guide Component Updater                                                                    | Edge-proprietary LLM service                                                             |
| Profile directory                   | `OptGuideOnDeviceModel/`                                                                                | `EdgeLLMOnDeviceModel/`                                                                  |
| Flag prefix                         | `optimization-guide-*`                                                                                  | `edge-llm-*`                                                                             |
| Inference caches                    | `adapter_cache.bin`, `encoder_cache.bin`, `GPUPersistentCache/`, `GraphiteDawnCache/`, `GrShaderCache/` | `adapter_cache.bin`, `encoder_cache.bin`                                                 |

**Research file:** [edge-dev-gpu-vs-cpu-inference-control.md](../research/edge-dev-gpu-vs-cpu-inference-control.md)

---

## 6. Chrome ProcessSingleton on Windows

**Status:** Known issue with a reliable workaround (retry loop with 2s delay).

### The Problem

Chrome exits with code 0 when it detects the profile `lockfile` from a previous instance. This is not a crash -- it is Chrome's deliberate `ProcessSingleton` enforcement (implemented in `process_singleton_win.cc`). The second `launchPersistentContext` call (from test fixtures after `globalSetup`) finds the lockfile still exists and Chrome silently exits.

### Root Cause Chain

1. Chrome creates `lockfile` in the user data directory using `CreateFile` with `FILE_FLAG_DELETE_ON_CLOSE`.
2. `context.close()` sends a shutdown signal to Chrome's main process.
3. Child processes -- particularly `chrome_crashpad_handler` -- outlive the main process. The crashpad handler monitors crash state and waits for ALL connected clients (including child processes it monitors) to exit.
4. `chrome_crashpad_handler` holds a `FILE_FLAG_DELETE_ON_CLOSE` handle on the lockfile, keeping it in "delete pending" state.
5. In "delete pending" state, `CreateFile` with `CREATE_NEW` fails with `ERROR_ACCESS_DENIED`.
6. The second Chrome instance interprets this as "profile in use" and exits with code 0 (deliberate single-instance enforcement, not a crash).
7. Playwright reports: `Protocol error (Browser.getWindowForTarget): Browser window not found`.

### Known Playwright Issues

| Issue                                                          | Description                                               |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| [#2828](https://github.com/microsoft/playwright/issues/2828)   | Multiple calls to `launchPersistentContext` fail          |
| [#6123](https://github.com/microsoft/playwright/issues/6123)   | Chromium not closed in headful mode, crashpad holds locks |
| [#6310](https://github.com/microsoft/playwright/issues/6310)   | `launchPersistentContext` "cannot read data directory"    |
| [#12830](https://github.com/microsoft/playwright/issues/12830) | `launchPersistentContext` hangs when used twice           |

### Fix: Retry Loop

The implemented fix retries `launchPersistentContext` with a 2-second delay between attempts. This gives `chrome_crashpad_handler` and other child processes time to exit and release their file handles. A poll-based approach (checking `lockfile` existence) is also viable but must account for the "delete pending" state where `existsSync` returns `true` even though the process has exited.

### Edge Does Not Have This Issue

Edge Dev on `windows-11-arm` does not exhibit the profile lock problem. Likely reasons: different crashpad configuration, faster shutdown path, or different `ProcessSingleton` implementation.

**Research file:** [chrome-persistent-context-profile-lock.md](../research/chrome-persistent-context-profile-lock.md)

---

## 7. npm/node_modules Caching

### Dual-Layer Caching Strategy (Windows ARM)

The Windows ARM jobs use two complementary cache layers:

1. **Primary: `node_modules` direct cache** with `restore-keys` -- skips install entirely on exact hit, enables incremental install on partial hit
2. **Secondary: npm download cache** via `setup-node` with `cache: 'npm'` -- speeds up full installs when `node_modules` cache is completely cold

```yaml
- uses: actions/setup-node@v6
  with:
    node-version-file: '.node-version'
    cache: 'npm' # Secondary: npm download cache

- name: Restore node_modules cache
  id: node-modules
  uses: actions/cache/restore@v5
  with:
    path: node_modules
    key: ${{ runner.os }}-${{ runner.arch }}-node${{ hashFiles('.node-version') }}-nm-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-${{ runner.arch }}-node${{ hashFiles('.node-version') }}-nm-

# Two-step install: validate lockfile, then incremental update
- name: Validate lockfile
  if: steps.node-modules.outputs.cache-hit != 'true'
  run: npm ci --dry-run --ignore-scripts

- name: Install dependencies
  if: steps.node-modules.outputs.cache-hit != 'true'
  run: npm install --no-save --prefer-offline
```

### Why Two-Step Instead of `npm ci`

`npm ci` always deletes `node_modules/` before installing -- by design. On `windows-11-arm`, this takes **499-568 seconds** even with a warm npm download cache, because Windows ARM filesystem I/O is dramatically slower than Linux for extracting ~1,466 packages.

npm lacks a single command equivalent to `pnpm install --frozen-lockfile` or `yarn install --immutable` that combines frozen lockfile enforcement with incremental install. The two-step workaround splits the guarantees:

- **`npm ci --dry-run --ignore-scripts`**: Validates lockfile integrity (fails if `package.json` and `package-lock.json` are out of sync) without deleting `node_modules/`. Completes in ~2s.
- **`npm install --no-save --prefer-offline`**: Diffs the actual `node_modules/` against the lockfile via Arborist and only installs changed packages. Never modifies `package-lock.json`.

### Why `restore-keys` Works Here (Unlike With `npm ci`)

The previous guidance ("do not use `restore-keys` with `node_modules/` caching") was correct when using `npm ci` -- a partial match would restore stale modules that `npm ci` would immediately delete and rebuild.

With the two-step approach, `restore-keys` is the key optimization. When the lockfile changes:

1. `restore-keys` prefix match restores the most recent `node_modules/` (from the previous lockfile)
2. `npm install --no-save` diffs the stale tree against the new lockfile and patches only the delta
3. Result: **~10 seconds** instead of **~500 seconds**

`actions/setup-node`'s npm download cache also uses `restore-keys` internally, so even the secondary cache benefits from partial matches.

### Performance Comparison (Benchmarked on windows-11-arm CI)

| Scenario                                 | `npm ci` (old) | Two-step + `restore-keys` (new) |
| ---------------------------------------- | -------------- | ------------------------------- |
| **Exact cache hit** (lockfile unchanged) | ~15s (skip)    | ~15s (skip)                     |
| **Partial hit** (lockfile changed)       | **499-568s**   | **~10s**                        |
| **Full miss** (no node_modules at all)   | 499-568s       | ~448s                           |

### Platform-Specific Notes

**On `windows-11-arm`:** `npm ci` is **10-15x slower** than on Linux for the same project (499-568s vs ~30-60s). The bottleneck is Windows NTFS filesystem I/O: extracting ~1,466 packages and running install scripts for native modules. The two-step incremental approach avoids this entirely on partial cache hits.

**On `ubuntu-latest`:** The npm download cache via `setup-node` with `cache: 'npm'` is sufficient. `npm ci` runs inside the Docker container and completes in ~30-60 seconds. The overhead of the two-step approach is not justified.

### Cache Key Design

```
key:          Windows-ARM64-node<hash(.node-version)>-nm-<hash(package-lock.json)>
restore-keys: Windows-ARM64-node<hash(.node-version)>-nm-
```

- **`runner.os` + `runner.arch`**: Prevents cross-platform cache pollution (Linux vs Windows, x64 vs ARM64)
- **`hashFiles('.node-version')`**: Invalidates cache on Node.js major/minor version changes (native module ABI). Uses file hash instead of resolved version to avoid churn on patch updates
- **`hashFiles('package-lock.json')`**: Invalidates on any dependency change
- **`restore-keys` prefix**: Matches any previous cache for the same OS/arch/Node combination

### Cache Storage Budget

| Cache Entry                                           | Estimated Compressed Size |
| ----------------------------------------------------- | ------------------------- |
| Linux node_modules                                    | ~200-300 MB               |
| Windows node_modules                                  | ~200-300 MB               |
| Windows npm download cache                            | ~200-300 MB               |
| Edge Dev AI model profile (including onnxruntime.dll) | ~500 MB - 2 GB            |
| Chrome Beta AI model profile                          | ~500 MB - 2 GB            |
| **Total**                                             | **~1.6 - 4.9 GB**         |

Well within the 10 GB GitHub Actions cache limit. The AI model caches are the largest consumers.

### Pitfalls

1. **`npm install --no-save` does not validate lockfile sync.** That is why the `npm ci --dry-run` validation step is required before it. Without validation, a desynchronized `package.json`/`package-lock.json` would silently install incorrect versions.
2. **`npm install` may trigger the [lockfile idempotency bug](https://github.com/npm/cli/issues/3652)** (trivial whitespace/metadata changes). The `--no-save` flag suppresses lockfile writes, mitigating this.
3. **Cache save is moved to end of job** to avoid blocking test execution. The `!cancelled()` guard ensures the cache is saved even if tests fail.

**Research files:** [npm-ci-caching-optimization.md](../.planning/research/npm-ci-caching-optimization.md), [npm-incremental-frozen-lockfile-install.md](../.planning/research/npm-incremental-frozen-lockfile-install.md)

---

## 8. Runner Viability Summary

### For Chrome Beta + Gemini Nano

| Runner                     | Meets RAM?    | Meets Cores? | GPU          | CPU Inference?                      | Verdict                      |
| -------------------------- | ------------- | ------------ | ------------ | ----------------------------------- | ---------------------------- |
| `ubuntu-latest` (x64)      | 16 GB = 16 GB | 4 = 4        | None         | YES (Chrome 147, XNNPACK)           | **WORKS** (Docker container) |
| `ubuntu-24.04-arm` (ARM64) | 16 GB = 16 GB | 4 = 4        | None         | BLOCKED (no Chrome Beta arm64 .deb) | Not viable                   |
| `macos-latest` (M1)        | 7 GB < 16 GB  | 3 < 4        | ~1 GB MPS    | NO                                  | Not viable                   |
| `macos-26-intel`           | 14 GB < 16 GB | 4 = 4        | ~1.5 GB iGPU | NO                                  | Not viable                   |

### For Edge Dev + Phi-4 Mini

| Runner                         | RAM   | GPU                           | ONNX Runtime Behavior                                            | Verdict       |
| ------------------------------ | ----- | ----------------------------- | ---------------------------------------------------------------- | ------------- |
| `windows-11-arm`               | 16 GB | **None** (Azure Cobalt ARM64) | CPU fallback (clean -- no GPU to partially init)                 | **WORKS**     |
| `windows-latest` (Server 2025) | 16 GB | None                          | N/A (Server SKU rejected, model download never starts)           | Not supported |
| `macos-26-intel`               | 14 GB | Intel iGPU 1.5 GB             | CoreML attempts GPU alloc, crashes (resource-level, no fallback) | Not viable    |
| `macos-15` (M1)                | 7 GB  | MPS 1 GB                      | Insufficient RAM + GPU (fails during bootstrap)                  | Not viable    |
| `macos-14` (M1)                | 7 GB  | MPS 1 GB                      | Same as macos-15                                                 | Not viable    |
| `macos-26` (M1)                | 7 GB  | MPS 1 GB                      | Same as macos-15                                                 | Not viable    |

### Final Configuration

| Browser         | Runner           | Container                    | AI Model              | Inference Runtime                | Inference Backend | Cold-Start             |
| --------------- | ---------------- | ---------------------------- | --------------------- | -------------------------------- | ----------------- | ---------------------- |
| Chrome Beta 147 | `ubuntu-latest`  | Docker (dbus pre-configured) | Gemini Nano (~4 GB)   | LiteRT-LM                        | XNNPACK CPU       | Moderate               |
| Edge Dev        | `windows-11-arm` | Bare runner                  | Phi-4 Mini (~4.93 GB) | ONNX Runtime (profile component) | CPU EP            | 11+ min (first prompt) |

### Key Architectural Insight

The two browser/model combinations use fundamentally different inference architectures:

- **Chrome + Gemini Nano:** Inference is controlled through Chromium's standard GPU subsystem. `--disable-gpu` indirectly forces CPU via `gpu_blocklist.cc`. The `@1` vs `@2` flag controls whether Chrome auto-detects or bypasses performance checks. Backend selection is transparent through `chrome://on-device-internals`.

- **Edge + Phi-4 Mini:** Inference runs through a completely separate native pipeline. ONNX Runtime is downloaded as a component into the profile (not compiled into the browser). No Chromium flag, environment variable, or edge://flags entry can control the ONNX Runtime execution provider selection. The only way to force CPU is to remove the GPU entirely (which `windows-11-arm` does by nature of its hardware).

### Supplementary Findings

**Vitest retry support:** Vitest 4.1 supports `retry` with count, delay, and condition (regex/function). The `github-actions` reporter surfaces flaky tests (passed on retry) in the Job Summary. Persistent browser contexts survive retries, so the downloaded AI model persists across retry attempts. The Playwright e2e "mystery retries" come from `@nx/playwright/preset` which sets `retries: process.env.CI ? 2 : 0` at line 70 of `nxE2EPreset`. See [vitest-retry-flakiness-support.md](../research/vitest-retry-flakiness-support.md).
