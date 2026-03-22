# Phi-4 Mini ARM64 Cold-Start Research

**Date:** 2026-03-22
**Problem:** First `session.prompt()` call takes 29+ minutes on `windows-11-arm` CI runner, vs. 35-72s locally on Snapdragon X Elite.
**Confidence:** MEDIUM-HIGH -- root causes are well-supported by evidence; exact timing breakdowns are estimated because Edge's embedded ONNX Runtime is opaque.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Root Cause Analysis](#2-root-cause-analysis)
3. [Hardware Performance Gap](#3-hardware-performance-gap)
4. [ONNX Runtime Session Creation and Graph Optimization](#4-onnx-runtime-session-creation-and-graph-optimization)
5. [The "downloading" Availability Status Anomaly](#5-the-downloading-availability-status-anomaly)
6. [What session.prompt() Actually Does on Cold Start](#6-what-sessionprompt-actually-does-on-cold-start)
7. [Why Local Is 35-72s but CI Is 29+ Minutes](#7-why-local-is-35-72s-but-ci-is-29-minutes)
8. [Potential Mitigations](#8-potential-mitigations)
9. [What Cannot Be Changed](#9-what-cannot-be-changed)
10. [Open Questions](#10-open-questions)

---

## 1. Executive Summary

The 29+ minute cold-start for `session.prompt()` on the `windows-11-arm` CI runner is caused by a convergence of three factors:

1. **Dramatically slower per-core CPU performance on the CI runner.** The Azure Cobalt 100 (Arm Neoverse N2) processor has ~40-50% lower single-thread performance than the Snapdragon X Elite's Oryon cores. ONNX Runtime graph optimization and model loading are predominantly single-threaded operations.

2. **ONNX Runtime graph optimization runs every session creation.** Edge's embedded ONNX Runtime applies full graph optimizations (operator fusion, layout transformations, weight materialization) when creating a session from the raw ONNX model. For a ~4.86 GB model with billions of parameters, this is computationally expensive. There is no way to pre-serialize the optimized graph because the runtime is embedded inside Edge and not configurable externally.

3. **No cached inference artifacts on cold start.** The `adapter_cache.bin` and `encoder_cache.bin` files generated after first inference contain pre-compiled session data. Without them, every session creation pays the full optimization cost. The CI cache saves these post-test, but a cache miss means a full cold start.

The `session.prompt()` duration includes: ONNX session creation (graph optimization + weight loading) + tokenizer initialization + KV cache allocation + first-pass inference. On a 4-vCPU Neoverse N2 machine with 16 GB RAM running a 4.86 GB model, each of these steps is substantially slower than on a 12-core Snapdragon X Elite with 32 GB RAM.

**There is no configuration, flag, or environment variable that can significantly reduce the cold-start time.** The mitigation strategy must focus on ensuring cache hits for the profile directory (preserving inference artifacts) and accepting longer timeouts when cache misses occur.

---

## 2. Root Cause Analysis

### The Full Timeline of session.prompt() on Cold Start

Based on the observed behavior and ONNX Runtime architecture, the 29+ minutes likely breaks down as follows (estimated):

| Phase                   | What Happens                                               | Estimated Time (CI) | Estimated Time (Local) |
| ----------------------- | ---------------------------------------------------------- | ------------------- | ---------------------- |
| 1. Session creation     | ONNX Runtime loads 4.86 GB model into memory               | 2-5 min             | 30-60s                 |
| 2. Graph optimization   | Operator fusion, layout transforms, weight materialization | 10-15 min           | 2-5 min                |
| 3. KV cache allocation  | Pre-allocate attention KV cache in RAM                     | 1-3 min             | 10-30s                 |
| 4. Tokenizer init       | Load tokenizer vocabulary and configuration                | <30s                | <10s                   |
| 5. First inference pass | Prompt encoding + first token generation                   | 5-10 min            | 1-3 min                |
| **Total**               |                                                            | **~20-35 min**      | **~4-10 min**          |

**Important caveat:** These are estimates. Edge's embedded ONNX Runtime does not expose timing breakdowns. The phases may overlap or have different relative weights. The 29+ minutes observed in CI aligns with this estimate when all phases are at their worst case on the weaker hardware.

### Why LanguageModel.create() Completes in 3s

`LanguageModel.create()` likely performs a lightweight check: it verifies model files exist, confirms the ONNX Runtime component is present, and returns a session handle. It does NOT trigger full model loading or graph optimization. The heavy work is deferred to the first actual inference call (`session.prompt()`), which is a common lazy-initialization pattern in ML runtimes.

This explains the observed behavior:

- `LanguageModel.availability()` = "downloading" (even with files on disk) -- model registration is in progress
- `LanguageModel.create()` completes in 3s -- lightweight handle creation
- `edge://on-device-internals` shows "Ready" after 5s -- model is registered but not loaded
- `session.prompt('warmup')` hangs for 29+ min -- THIS is where full initialization happens

---

## 3. Hardware Performance Gap

### Runner Comparison

| Spec                        | CI Runner (`windows-11-arm`)       | Local Machine (Surface Laptop 7)              |
| --------------------------- | ---------------------------------- | --------------------------------------------- |
| **CPU**                     | Azure Cobalt 100 (Arm Neoverse N2) | Snapdragon X Elite X1E-80100 (Qualcomm Oryon) |
| **Cores**                   | 4 vCPU                             | 12 cores                                      |
| **RAM**                     | 16 GB                              | 32 GB                                         |
| **Geekbench 6 Single-Core** | ~1,629                             | ~2,400-2,780                                  |
| **Geekbench 6 Multi-Core**  | ~5,433 (4 threads)                 | ~14,000-14,250                                |
| **Architecture**            | Armv9-A, Neoverse N2               | Armv8.7-A, custom Oryon                       |
| **Core design**             | Throughput-optimized (server)      | Performance-optimized (consumer)              |
| **GPU**                     | None                               | Qualcomm Adreno X1-85                         |
| **NPU**                     | None                               | Qualcomm Hexagon                              |
| **Disk**                    | ~14 GB SSD (VM)                    | NVMe SSD                                      |

### Single-Core Performance: The Critical Factor

The Neoverse N2 core is a **throughput-optimized server core** designed for massive parallelism (128-core chips). Its per-core performance is comparable to Intel Skylake-era Xeons. The Qualcomm Oryon core is a **performance-optimized consumer core** with an 8-wide pipeline and very high reorder buffer capacity.

**Geekbench 6 single-core comparison:**

- Cobalt 100: ~1,629
- Snapdragon X Elite: ~2,400-2,780
- **Ratio: Oryon is 1.5-1.7x faster per core**

This matters because ONNX Runtime graph optimization is predominantly **single-threaded**. The graph walks, operator fusions, and layout transformations are sequential operations on a graph data structure. Even with 4 vCPUs on the CI runner, the graph optimization phase cannot parallelize across all cores. The actual matrix operations during inference benefit from multi-threading, but the startup/compilation phases do not.

### Memory Bandwidth and Capacity

The CI runner has 16 GB RAM for a 4.86 GB model. After OS overhead and browser processes, approximately 9-10 GB is available for model loading and inference. The model weights alone consume 4.86 GB, and the ONNX Runtime session requires additional memory for:

- Intermediate tensors during graph optimization
- KV cache for attention layers
- Tokenizer state
- ONNX Runtime internal buffers

On the local machine with 32 GB, memory pressure is negligible. On the CI runner, the OS may be paging during the graph optimization phase, which would dramatically slow everything down.

### Storage I/O

The CI runner uses a VM with Azure-managed storage. The local machine uses a direct-attached NVMe SSD. Loading 4.86 GB of model data from Azure VM storage is slower than from NVMe, but this difference is likely measured in seconds, not minutes. Storage I/O is not the primary bottleneck.

### Sources

- [Geekbench 6: Azure Cobalt 100](https://browser.geekbench.com/v6/cpu/9013329) -- single-core 1,629, multi-core 5,433
- [Arm Neoverse N2 product page](https://www.arm.com/products/silicon-ip-cpu/neoverse/neoverse-n2) -- 40% IPC over N1, throughput-optimized
- [GitHub Actions windows-11-arm runner docs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) -- 4 vCPU, 16 GB RAM, 14 GB SSD
- [Arm Learning Paths: GitHub ARM runners](https://learn.arm.com/learning-paths/laptops-and-desktops/gh-arm-runners-win/introduction/) -- Azure Cobalt 100, Armv9-A, SVE2

---

## 4. ONNX Runtime Session Creation and Graph Optimization

### Online Mode: The Startup Tax

ONNX Runtime applies graph optimizations during session creation in "online mode." This includes:

1. **Basic optimizations:** Constant folding, redundant node elimination, semantics-preserving node fusions (e.g., Conv + BatchNorm fusion)
2. **Extended optimizations:** Complex node fusions (e.g., attention layer fusion, GELU fusion), transposes optimization
3. **Layout optimizations:** Data layout transformations (e.g., NCHW to NCHWc), platform-specific weight pre-packing

For a 3.8B parameter model like Phi-4 Mini, the graph has thousands of nodes. Each fusion pass walks the entire graph, pattern-matches, and rewrites. This is computationally expensive and predominantly single-threaded.

### The 15-Minute Windows Loading Bug

A known ONNX Runtime issue ([#22219](https://github.com/microsoft/onnxruntime/issues/22219)) reports that a 52 MB XGBoost model takes **15 minutes to load on Windows** but only seconds on Linux. While this specific bug is about a different model type, it demonstrates that Windows-specific overhead in ONNX Runtime session creation is a documented phenomenon. The Phi-4 Mini model is ~100x larger.

### Offline Mode Is Not Available

The standard ONNX Runtime mitigation for slow session creation is "offline mode" -- serialize the optimized graph to disk and load it with optimizations disabled on subsequent runs. However, this requires programmatic access to `SessionOptions.optimized_model_filepath`, which is only available through the ONNX Runtime Python/C++ API.

**Edge's embedded ONNX Runtime does not expose this.** The session is created internally by Edge's LLM service (`onnxruntime-genai.dll`). There is no way to:

- Set graph optimization level
- Serialize the optimized model
- Load a pre-optimized model
- Configure thread count
- Enable the dynamic cost model

The `adapter_cache.bin` and `encoder_cache.bin` files in the profile directory appear to be Edge's proprietary equivalent of serialized session data. When these files exist, session creation is faster because some optimization work is cached. But they are only generated after the first successful inference.

### Sources

- [ONNX Runtime Graph Optimizations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html) -- online vs. offline mode
- [ONNX Runtime issue #22219](https://github.com/microsoft/onnxruntime/issues/22219) -- 15-minute model load on Windows
- [ONNX Runtime issue #19177](https://github.com/microsoft/onnxruntime/issues/19177) -- first inference slow despite warm-up
- [ONNX Runtime Troubleshooting](https://onnxruntime.ai/docs/performance/tune-performance/troubleshooting.html) -- latency variance, dynamic cost model

---

## 5. The "downloading" Availability Status Anomaly

### What "downloading" Means With Files Already on Disk

When `LanguageModel.availability()` returns `"downloading"` despite model files being present on disk, this likely indicates one of:

1. **ONNX Runtime component update in progress.** Edge downloads `onnxruntime.dll` and `onnxruntime-genai.dll` as a component update into the profile directory. The model weight files may be cached, but if the runtime DLLs need updating (version mismatch between cached DLLs and current Edge build), Edge reports "downloading" while fetching the updated runtime.

2. **Model registration not complete.** Edge's LLM service goes through a multi-step registration process: detect model files, verify integrity/checksums, register with the component updater, and initialize the runtime. During this process, `availability()` may return "downloading" even though no actual download is occurring.

3. **Component verification.** Edge may checksum or verify the cached files on every browser launch. While verification is in progress, the status is "downloading" rather than "available."

### Evidence

From Microsoft's Edge Prompt API documentation:

> "If `availability == "downloadable"` or `availability == "downloading"`, the model can be used, but it needs to be downloaded first."

The documentation conflates "downloading" with "not yet ready for use." The status does not necessarily mean bytes are being transferred from a server -- it may mean the local model/runtime pipeline is initializing.

### Implication for CI

The "downloading" status is likely transient and resolves within seconds to minutes. It does NOT indicate that the model files need to be re-downloaded. The real bottleneck is the subsequent `session.prompt()` call, not the availability check.

### Sources

- [Edge Prompt API documentation](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) -- availability states, download monitoring
- [Edge GenAI policy settings](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/genailocalfoundationalmodelsettings) -- ComponentUpdatesEnabled

---

## 6. What session.prompt() Actually Does on Cold Start

### The Complete Pipeline

When `session.prompt('warmup')` is called on a cold profile (no `adapter_cache.bin`/`encoder_cache.bin`), the following happens inside Edge's ONNX Runtime:

1. **Model deserialization:** Read the 4.86 GB ONNX model file from disk into memory. On the CI runner with 16 GB RAM, this alone consumes ~30% of available memory.

2. **Graph optimization (online mode):** Apply all enabled graph optimizations. This is the most expensive step:
   - Walk the entire graph (thousands of nodes for a 3.8B parameter model)
   - Pattern-match and fuse operators (attention blocks, GELU, LayerNorm)
   - Optimize memory layout for the target hardware
   - Pre-pack weights for efficient GEMM operations (MLAS int4 kernels)

3. **Execution provider initialization:** The CPU execution provider initializes its thread pool and MLAS kernel dispatch. On ARM64, this includes selecting the appropriate NEON/SVE2/I8MM kernels via MLAS dispatch.

4. **KV cache allocation:** Pre-allocate the key-value cache for the attention mechanism. For Phi-4 Mini with its context window, this requires several GB of contiguous memory.

5. **Tokenizer initialization:** Load the tokenizer vocabulary and configuration from the profile.

6. **Prompt tokenization:** Convert "warmup" to token IDs.

7. **Prefill pass:** Process the input tokens through all layers of the model. This is the first real computation and exercises every GEMM kernel.

8. **Token generation:** Generate output tokens autoregressively until the model produces a stop token.

9. **Cache serialization:** Write `adapter_cache.bin` and `encoder_cache.bin` to the profile directory for future sessions.

Steps 2 and 7 dominate the cold-start time. Step 2 is predominantly single-threaded. Step 7 can use multiple threads for GEMM operations but is still very slow on 4 vCPUs.

### ARM64 MLAS Kernel Performance

ONNX Runtime uses MLAS (Microsoft Linear Algebra Subprograms) for core GEMM operations. On ARM64, MLAS dispatches to NEON/SVE2 kernels. Recent versions (1.22+) include KleidiAI optimizations from Arm that deliver 28-51% performance improvements for int4 GEMM on Neoverse N2.

However, it is unknown whether Edge's embedded ONNX Runtime includes these KleidiAI optimizations. The `onnxruntime.dll` in the profile is downloaded as a component, and its version may lag behind the latest public ONNX Runtime release.

### Native ARM64 vs. Emulated

A critical performance factor: if Edge's ONNX Runtime DLLs are AMD64 (x86_64) rather than native ARM64, they would run under Windows' x86_64 emulation layer, which adds ~2-5x overhead. The `onnxruntime-genai` GitHub issue [#1417](https://github.com/microsoft/onnxruntime-genai/issues/1417) documents this exact problem: native ARM64 achieves 17 TPS on Snapdragon X Elite, but AMD64 emulation drops to 1 TPS.

**However**, since Edge Dev itself is a native ARM64 application on Windows 11 ARM, it is likely (but not confirmed) that its embedded ONNX Runtime DLLs are also native ARM64. If they were emulated, the cold start would be even longer than 29 minutes.

### Sources

- [ONNX Runtime GenAI ARM64EC issue](https://github.com/microsoft/onnxruntime-genai/issues/1417) -- 17 TPS native vs. 1 TPS emulated on Snapdragon X Elite
- [Arm blog: KleidiAI + ONNX Runtime on Cobalt 100](https://developer.arm.com/community/arm-community-blogs/b/servers-and-cloud-computing-blog/posts/accelerate-llm-inference-with-onnx-runtime-on-arm-neoverse-powered-microsoft-cobalt-100) -- 28-51% performance uplift with KleidiAI MLAS optimizations
- [ONNX Runtime CPU Performance Regression](https://github.com/microsoft/onnxruntime/issues/27513) -- DequantizeLinear 4x faster on Snapdragon vs. Intel

---

## 7. Why Local Is 35-72s but CI Is 29+ Minutes

The 25-50x performance difference between local (35-72s) and CI (29+ min = 1,740s) cannot be explained by the 1.5-1.7x per-core speed difference alone. The full explanation requires stacking all contributing factors:

### Factor Analysis

| Factor                    | Multiplier | Explanation                                                                |
| ------------------------- | ---------- | -------------------------------------------------------------------------- |
| Single-core performance   | 1.5-1.7x   | Neoverse N2 vs. Oryon per-core speed                                       |
| Core count                | 3x         | 4 vCPU vs. 12 cores (for parallelizable phases)                            |
| Memory capacity           | 2x+        | 16 GB with ~10 GB usable vs. 32 GB with ~25 GB usable; paging likely on CI |
| Memory bandwidth          | 1.5-2x     | VM shared memory bus vs. dedicated LPDDR5X                                 |
| I/O throughput            | 1.2-1.5x   | Azure VM storage vs. NVMe SSD                                              |
| OS overhead               | 1.1-1.2x   | VM overhead, Windows Defender scanning, background services                |
| Warm cache effect (local) | Variable   | If local runs have partially-warm `adapter_cache.bin` from previous runs   |

### Compound Effect

These factors multiply, not add. Taking conservative estimates:

- 1.5 (per-core) x 2 (core count for GEMM phases) x 2 (memory pressure) x 1.5 (memory bandwidth) x 1.2 (I/O) x 1.1 (OS) = **~12x slower on CI**

If the local 35-72s measurement was taken with a partially warm cache (i.e., `adapter_cache.bin` existed from a previous run), the local measurement is not a true cold start. A true cold start on the local Snapdragon X Elite would likely be 5-10 minutes, and the CI measurement of 29 minutes represents a ~3-6x slowdown which aligns better with the hardware gap.

### The Most Likely Explanation

**The local 35-72s measurement likely includes warm cache artifacts from previous runs.** The `adapter_cache.bin` and `encoder_cache.bin` files persist across browser launches in the profile directory. If these files exist from a previous session, Edge's ONNX Runtime can skip most of the graph optimization phase, reducing the first `session.prompt()` to just model loading + inference -- which takes 35-72s on the fast Snapdragon X Elite hardware.

On CI with a cache miss, there are no cached artifacts. The full graph optimization + first inference pipeline runs from scratch on the slower Cobalt 100 hardware. This is where the 29+ minutes comes from.

---

## 8. Potential Mitigations

### What Might Help (Confidence: MEDIUM)

#### 1. Ensure Cache Hits for the Profile Directory

The single most impactful mitigation is ensuring that `adapter_cache.bin` and `encoder_cache.bin` are present in the cached profile. The current CI workflow already does this by saving the cache post-test. Verify that:

- The cache key matches correctly on restore
- The `restore-keys` prefix matching picks up the latest cache
- The cache is not evicted due to the 10 GB repository cache limit

**Expected impact:** Reduce cold start from 29+ min to ~5-15 min (warm start with cached artifacts).

#### 2. Run Warm-Up Prompt During Bootstrap (Not Just create+destroy)

The bootstrap script currently calls `LanguageModel.create()` and validates availability but may not run a full `session.prompt('warmup')`. If the bootstrap script ran a full prompt during the initial profile setup, the resulting cache would include `adapter_cache.bin` and `encoder_cache.bin`, making the subsequent e2e warm-up faster.

**Caveat:** This would increase bootstrap time on cache miss by 29+ minutes, which is the same cost -- just shifted earlier. The net effect is zero unless the bootstrap cache is more reliably restored than the post-test cache.

#### 3. Increase CI Step Timeout to Accommodate Cold Start

The current 45-minute step timeout is tight for a 29+ minute cold start plus actual test execution. Consider increasing to 60 minutes for the Edge test step.

#### 4. Use a Larger Runner (Enterprise/Team Plan Only)

The `windows-11-arm` free runner has 4 vCPU and 16 GB RAM. Larger runners can be configured with more cores and RAM, which would directly reduce the graph optimization and inference time. However, larger ARM64 runners require a GitHub Team or Enterprise plan and are not free.

### What Will NOT Help

#### 1. Edge Flags or Environment Variables

There is no Edge flag, `chrome://flags` entry, or environment variable that can control ONNX Runtime session options, graph optimization level, thread count, or execution provider configuration. The `edge-llm-on-device-model-performance-param@3` flag configures Edge's hardware eligibility check, not ONNX Runtime behavior.

#### 2. `--disable-gpu` Flag

This flag affects Chromium's renderer GPU pipeline, not Edge's ONNX Runtime. On the CI runner with no GPU, it has no effect at all.

#### 3. Pre-optimized ONNX Model

You cannot replace Edge's bundled model with a pre-optimized one. The model is delivered and managed by Edge's component update system, and the model file path is not configurable.

#### 4. ORT Environment Variables

No `ORT_DISABLE_ALL`, `ORT_THREAD_COUNT`, `ORT_OPTIMIZATION_LEVEL`, or similar environment variables exist for Edge's embedded ONNX Runtime. These options are only available through the programmatic API, which Edge does not expose.

#### 5. Running the Prompt Before Model Status "Ready"

The warm-up code currently waits for Model Status "Ready" before running the prompt. However, "Ready" only means the model is registered (level 2), not that the inference pipeline is initialized (level 3). Running the prompt earlier would not help because the prompt triggers the same initialization regardless of when it is called.

---

## 9. What Cannot Be Changed

These constraints are fundamental and cannot be worked around:

1. **Edge's ONNX Runtime is a black box.** No session options, no graph optimization control, no serialization. The only interface is the LanguageModel API (`create`, `prompt`, `destroy`).

2. **The CI runner hardware is fixed.** The `windows-11-arm` free runner provides 4 vCPU Neoverse N2 + 16 GB RAM. This is the only free ARM64 Windows runner on GitHub Actions.

3. **Phi-4 Mini is a 3.8B parameter model.** It has a 4.86 GB model file. Loading and optimizing this on 4 vCPUs with 16 GB RAM will always be slow on cold start.

4. **First inference on a cold profile will always be slow.** The ONNX Runtime must compile the execution graph and generate inference artifacts. This is an inherent cost of on-device model deployment.

---

## 10. Open Questions

### HIGH Priority

1. **Are Edge's ONNX Runtime DLLs native ARM64 on the CI runner?** If they are AMD64 running under emulation, performance would be 5-17x worse. This could explain a significant portion of the 29+ minute cold start. Verification: check the DLL architecture in the profile directory with `dumpbin /headers onnxruntime.dll` or `file onnxruntime.dll`.

2. **Do `adapter_cache.bin`/`encoder_cache.bin` actually reduce startup time on the CI runner?** The current docs assume they do (by analogy with Chrome's equivalent files), but this has not been verified with precise timing on the ARM64 runner. Verification: compare `session.prompt()` timing with and without these cache files present.

3. **Is memory paging occurring during model loading?** With 16 GB RAM, 4.86 GB model, OS overhead, and browser processes, the runner may be paging during graph optimization. Verification: monitor `Process.WorkingSetSize` or `Performance Monitor` memory counters during the warm-up phase.

### MEDIUM Priority

4. **What version of ONNX Runtime does Edge Dev ship?** If it is an older version without KleidiAI optimizations, upgrading Edge Dev might provide 28-51% performance improvement on the Neoverse N2. But Edge Dev upgrades are automatic and not controllable.

5. **Is the 29+ minute measurement repeatable?** Was this a single observation or does it consistently take 29+ minutes on every cache-miss run? If inconsistent, there may be additional factors (network latency for component updates, Azure VM performance variability, etc.).

6. **Could a pre-warmed profile image be created and stored as a GitHub Actions artifact?** Instead of caching the profile via `actions/cache`, a pre-built profile (with all inference artifacts) could be stored as a release artifact and downloaded at the start of each CI run. This would be larger (~5 GB) but more reliable than cache hit/miss patterns.

### LOW Priority

7. **Does Phi-4 Mini Flash (a distilled, faster variant) work with Edge's LanguageModel API?** Microsoft released Phi-4-mini-flash-reasoning which is 10x faster. If Edge adopts this model variant, cold-start times could decrease significantly.

8. **Will Azure Cobalt 200 (Neoverse V3) runners improve this?** The Cobalt 200 delivers up to 50% better per-core performance. When/if GitHub Actions adopts Cobalt 200 runners, the cold start could drop to ~15-20 minutes.

---

## Summary of Findings

| Question                                                       | Answer                                                                                                                                                                                                             | Confidence |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Is ONNX Runtime on ARM64 known to be slow for first inference? | YES -- graph optimization in online mode is documented as adding significant startup overhead, especially for large models. Windows-specific slowness is a known issue.                                            | HIGH       |
| Does Edge's model system have a compilation phase on ARM64?    | YES -- ONNX Runtime applies graph optimizations during session creation. This is compute-intensive and predominantly single-threaded. The `adapter_cache.bin`/`encoder_cache.bin` files appear to cache this work. | HIGH       |
| Are there Edge flags or env vars to speed up first inference?  | NO -- Edge's embedded ONNX Runtime is not configurable externally. No flags, environment variables, or session options are exposed.                                                                                | HIGH       |
| What are the CI runner specs vs. local?                        | CI: 4 vCPU Neoverse N2, 16 GB RAM, no GPU. Local: 12-core Oryon, 32 GB RAM, GPU+NPU. Per-core performance ratio is ~1.5-1.7x, but compound factors (cores, memory, I/O) create a much larger effective gap.        | HIGH       |
| Does "downloading" mean files need re-downloading?             | NO -- it likely indicates model/runtime registration or component verification is in progress, not actual file transfer.                                                                                           | MEDIUM     |
| Are there known issues with Edge's Phi-4 Mini on ARM64 CI?     | No specific GitHub issues found for this exact configuration. The problem is a predictable consequence of running a 3.8B parameter model through ONNX Runtime graph optimization on weak hardware.                 | MEDIUM     |

---

## Sources

### Official Documentation

- [Edge Prompt API](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) -- LanguageModel API reference
- [ONNX Runtime Graph Optimizations](https://onnxruntime.ai/docs/performance/model-optimizations/graph-optimizations.html) -- online vs. offline mode
- [ONNX Runtime Troubleshooting](https://onnxruntime.ai/docs/performance/tune-performance/troubleshooting.html) -- latency variance, dynamic cost model
- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) -- runner specs table
- [Arm Neoverse N2](https://www.arm.com/products/silicon-ip-cpu/neoverse/neoverse-n2) -- architecture overview

### GitHub Issues

- [ONNX Runtime #22219: Very slow load of ONNX model in Windows](https://github.com/microsoft/onnxruntime/issues/22219) -- 15-min load for 52 MB model on Windows
- [ONNX Runtime #19177: First inference slow despite warm-up](https://github.com/microsoft/onnxruntime/issues/19177) -- warm-up does not eliminate all overhead
- [ONNX Runtime #11581: GPU inference slow first time](https://github.com/microsoft/onnxruntime/issues/11581) -- first inference latency spike
- [ONNX Runtime #27513: CPU performance regression ARM vs Intel](https://github.com/microsoft/onnxruntime/issues/27513) -- Snapdragon outperforms Intel on quantized kernels
- [onnxruntime-genai #1417: ARM64EC binaries needed](https://github.com/microsoft/onnxruntime-genai/issues/1417) -- 17 TPS native vs. 1 TPS emulated
- [MicrosoftEdge/MSEdgeExplainers #1054: Not Eligible despite Very High](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1054) -- model eligibility issues

### Benchmarks and Analysis

- [Geekbench 6: Azure Cobalt 100](https://browser.geekbench.com/v6/cpu/9013329) -- single-core 1,629
- [Arm blog: KleidiAI + ONNX Runtime on Cobalt 100](https://developer.arm.com/community/arm-community-blogs/b/servers-and-cloud-computing-blog/posts/accelerate-llm-inference-with-onnx-runtime-on-arm-neoverse-powered-microsoft-cobalt-100) -- 1.9x vs. AMD Genoa, 28-51% uplift
- [Arm Learning Path: Phi-4 mini on Cobalt 100](https://learn.arm.com/learning-paths/servers-and-cloud-computing/onnx/setup/) -- deployment guide
- [Arm Learning Path: Phi-3 on Windows on ARM](https://learn.arm.com/learning-paths/laptops-and-desktops/win_on_arm_build_onnxruntime/4-run-benchmark-on-woa/) -- 1.79s TTFT, 6.34 TPS
- [Thomas Van Laere: AI CPU Inference on Cobalt 100](https://thomasvanlaere.com/posts/2025/10/exploring-ai-cpu-inferencing-with-azure-cobalt-100/) -- llama.cpp benchmarks
- [GitHub Actions windows-11-arm announcement](https://blogs.windows.com/windowsdeveloper/2025/04/14/github-actions-now-supports-windows-on-arm-runners-for-all-public-repos/) -- runner availability
- [Arm Learning Path: GitHub ARM runners](https://learn.arm.com/learning-paths/laptops-and-desktops/gh-arm-runners-win/introduction/) -- runner hardware details

### Community and Blog Posts

- [ONNX Runtime Performance Diagnosis](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html)
- [GitHub Actions CPU benchmarks (RunsOn)](https://runs-on.com/benchmarks/github-actions-cpu-performance/)
- [Azure Cobalt 100 VMs generally available](https://azure.microsoft.com/en-us/blog/azure-cobalt-100-based-virtual-machines-are-now-generally-available/)
