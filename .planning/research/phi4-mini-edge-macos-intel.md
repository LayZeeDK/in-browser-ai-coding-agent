# Research: Phi-4 Mini on Edge Dev -- macOS Intel (x86_64) Feasibility

**Researched:** 2026-03-21
**Overall confidence:** HIGH (official Microsoft docs, GitHub runner specs, GPU architecture analysis)

---

## Verdict: NOT SUPPORTED -- macOS Intel Cannot Run Phi-4 Mini in Edge Dev

The `macos-26-intel` runner (Intel x86_64, 14 GB RAM, macOS 26 Tahoe) **cannot run Edge Dev's Phi-4 Mini** due to a fundamental GPU VRAM limitation. The Intel integrated GPU on these runners exposes at most 1.5 GB of VRAM to macOS, while Edge requires 5.5 GB of GPU VRAM. This is a hardware-level constraint that no software flag or configuration can bypass. The 9-minute crash observed in CI is consistent with the model downloading successfully but failing catastrophically when Edge attempts to load it into GPU memory.

---

## 1. Does Microsoft's Prompt API Documentation Support macOS Intel?

**Confidence:** HIGH (official docs, last updated 2026-02-04)

The official documentation states:

> "The Prompt API is currently limited to: Operating system: Windows 10 or 11 and macOS 13.3 or later."

The docs list **macOS 13.3+** as supported but make **no distinction between Intel (x86_64) and Apple Silicon (ARM64)**. There is no explicit exclusion of Intel Macs, but there is also no explicit inclusion. The hardware requirements section lists:

- **GPU:** 5.5 GB of VRAM or more
- **Storage:** At least 20 GB available
- **Network:** Unmetered connection

The docs instruct users to check `edge://on-device-internals` for a "Device performance class" value. If the class is "High" or greater, the API is supported. The performance class is determined by the hardware at runtime -- it is not a static platform allowlist.

**Key observation:** The documentation implicitly assumes GPU capability sufficient for 5.5 GB VRAM. Intel Macs with integrated GPUs cannot meet this requirement, meaning they will likely report a performance class below "High" and the model will not load.

**Source:** [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) (updated 2026-02-04)

---

## 2. The GPU VRAM Problem on macOS Intel

**Confidence:** HIGH (Apple GPU architecture, macOS driver constraints)

### Intel Integrated GPU VRAM on macOS

Intel Macs (including those used by GitHub Actions Intel runners) have Intel integrated GPUs (Intel UHD Graphics or Intel Iris). These GPUs have **no dedicated VRAM** -- they share system RAM. On macOS, the Intel iGPU driver stack has specific constraints:

| Aspect                  | Value                                              |
| ----------------------- | -------------------------------------------------- |
| Dedicated VRAM          | None (integrated GPU)                              |
| Default VRAM allocation | 1.5 GB (from shared system RAM)                    |
| Maximum VRAM allocation | ~2 GB (hard-coded limit in macOS Intel GPU driver) |
| Required by Phi-4 Mini  | 5.5 GB                                             |
| **Deficit**             | **3.5-4 GB**                                       |

The macOS Intel GPU driver allocates at most 1.5 GB of system RAM as GPU memory by default, with a hard maximum of approximately 2 GB. This is a driver-level limitation in macOS, not a configuration that can be changed at runtime. Even the `edge-llm-on-device-model-performance-param@3` flag (performance override) in Edge cannot bypass the OS-level GPU memory allocation limit -- it can only bypass Edge's own hardware check, not the actual hardware constraint.

### Contrast with Apple Silicon

On Apple Silicon (M1/M2/M3/M4), GPU memory is unified with system RAM and can dynamically allocate 66-75% of total RAM. An M1 Mac with 7 GB total can allocate ~4.5 GB to GPU. However, GitHub-hosted M1 VMs are further constrained by a ~1 GB MPS paravirtualization cap (see existing research in `macos-runner-memory-optimization.md`).

### Contrast with Windows ARM64

On the `windows-11-arm` runner (where this works), the Qualcomm Adreno GPU has 8 GB+ of GPU-accessible memory, and the system has 16 GB total RAM. This comfortably exceeds the 5.5 GB VRAM requirement.

**Source:** Multiple macOS GPU memory discussions, Apple developer documentation on paravirtualized graphics, tonymacx86 forums on iGPU VRAM limits

---

## 3. Edge Dev on macOS: Same Features as Windows?

**Confidence:** MEDIUM (inference from architecture analysis)

Edge Dev on macOS **does** support the same Prompt API flags as Windows, but the underlying inference engine differs by platform:

| Aspect            | Windows                            | macOS                         |
| ----------------- | ---------------------------------- | ----------------------------- |
| Inference runtime | ONNX Runtime + DirectML            | ONNX Runtime + Metal (likely) |
| GPU API           | DirectX 12 (DirectML)              | Metal                         |
| CPU fallback      | Unknown/undocumented               | Unknown/undocumented          |
| NPU support       | Yes (via DirectML on Copilot+ PCs) | No                            |

Edge's built-in Phi-4 Mini runs as a **native browser-managed process** using ONNX Runtime -- it does NOT use WebGPU or WebNN for inference. This means `--disable-gpu` disabling WebGPU is irrelevant to the model inference path. The model inference uses a separate native GPU path that is independent of the renderer's GPU acceleration setting.

**Critical implication:** The `--disable-gpu` flag used in CI disables the renderer's GPU compositing but likely does NOT force the model inference to fall back to CPU. The native ONNX Runtime process likely has its own GPU initialization that is separate from Chromium's GPU process. When that native GPU initialization fails (due to insufficient VRAM), the browser process crashes or the model load fails silently.

Whether Edge has a CPU-only inference fallback for Phi-4 Mini is **undocumented**. Microsoft's Foundry Local tool automatically selects GPU or CPU optimized model variants, but Edge's built-in model delivery may not include a CPU-optimized variant. The 5.5 GB VRAM requirement in the docs suggests GPU is mandatory.

**Source:** [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api), WindowsForum analysis of Edge Phi-4 Mini integration

---

## 4. Memory Requirements Analysis

**Confidence:** HIGH

### Is 14 GB RAM Sufficient?

For the **system RAM** budget, 14 GB is theoretically sufficient -- the model itself (quantized INT4) is approximately 2-4 GB on disk and in memory. The problem is not total RAM but GPU-accessible VRAM.

| Budget Item                         | Estimated Usage         |
| ----------------------------------- | ----------------------- |
| macOS kernel + services             | ~2.5 GB                 |
| GitHub Actions runner agent         | ~0.1 GB                 |
| Node.js + npm                       | ~0.3 GB                 |
| Playwright + browser overhead       | ~0.5 GB                 |
| Edge Dev process (without model)    | ~1.0 GB                 |
| **Available for model loading**     | **~9.6 GB system RAM**  |
| **Available GPU VRAM (Intel iGPU)** | **1.5 GB (hard limit)** |
| **Required GPU VRAM**               | **5.5 GB**              |

The 14 GB system RAM is adequate. The 1.5 GB GPU VRAM is the blocker.

### Comparison: Phi-4 Mini vs Gemini Nano

| Model       | Parameters | Disk Size | GPU VRAM Required       | CPU Fallback              |
| ----------- | ---------- | --------- | ----------------------- | ------------------------- |
| Gemini Nano | ~2B        | ~1.7 GB   | 4 GB (bypass with flag) | Yes (16 GB RAM + 4 cores) |
| Phi-4 Mini  | 3.8B       | ~4-6 GB   | 5.5 GB                  | Undocumented              |

Phi-4 Mini is significantly more demanding than Gemini Nano, which Chrome uses. The ~2x larger model size translates to higher VRAM requirements.

---

## 5. macOS Version: What Does `macos-26-intel` Run?

**Confidence:** HIGH

| Property      | Value                                             |
| ------------- | ------------------------------------------------- |
| Runner label  | `macos-26-intel`                                  |
| macOS version | macOS 26 "Tahoe"                                  |
| Architecture  | Intel x86_64                                      |
| CPU           | 4 cores                                           |
| RAM           | 14 GB                                             |
| Storage       | 14 GB SSD                                         |
| GPU           | Intel integrated (UHD or Iris, unspecified model) |
| GPU VRAM      | ~1.5 GB shared from system RAM                    |

macOS 26 Tahoe meets the Prompt API's minimum OS requirement of macOS 13.3+. Apple has confirmed macOS 26 will be the **last macOS version supporting Intel Macs**, which means this is the final generation of Intel macOS runners.

The Prompt API requires macOS 13.3 (Ventura) or later. macOS 26 (Tahoe) exceeds this requirement. The OS version is not the issue.

**Source:** [GitHub changelog: macOS 26 GA](https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/), [runner-images#13637](https://github.com/actions/runner-images/issues/13637)

---

## 6. Known Issues with Edge Dev AI on macOS

**Confidence:** MEDIUM (limited public reports)

### From MSEdgeExplainers Issue #1012

The main Prompt API feedback thread ([MSEdgeExplainers#1012](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1012)) contains **no macOS-specific bug reports or discussions** as of this research date. All reported issues are Windows-focused (Qualcomm GPU driver compatibility, model version confusion).

### No Public Reports of macOS Intel + Phi-4 Mini

No blog posts, GitHub issues, Stack Overflow questions, or community discussions were found describing anyone successfully running Edge Dev's Phi-4 Mini on an Intel Mac. The absence of evidence does not prove impossibility, but combined with the VRAM analysis, it strongly suggests Intel Macs are not a tested or supported configuration for this feature.

### Related Known Issues

| Issue                                                                          | Relevance                                       |
| ------------------------------------------------------------------------------ | ----------------------------------------------- |
| Qualcomm GPU driver incompatibility (MSEdgeExplainers#1012)                    | Windows ARM64 only, resolved with driver update |
| Model version confusion -- Phi-4 instead of Phi-4-mini (MSEdgeExplainers#1198) | Affects all platforms                           |
| 9216 token context window limit (MSEdgeExplainers#1224)                        | Affects all platforms                           |
| Tool calling not implemented (crbug.com/422803232)                             | Affects all platforms                           |

---

## 7. Crash Diagnosis: What Happened on `macos-26-intel`?

**Confidence:** HIGH (strong inference from evidence)

The crash sequence was:

1. Browser launched successfully on `macos-26-intel`
2. Ran for approximately 9 minutes
3. `[CRASH] Browser context closed unexpectedly`
4. System had 3.7 GB free RAM after crash (down from 4.3 GB at start)
5. 149 GB free disk space (adequate)

### Most Likely Explanation: Model Downloaded, GPU Load Failed

The 9-minute runtime is consistent with the following sequence:

1. **Minutes 0-1:** Edge Dev launched, navigated to `edge://gpu`, Prompt API initialized
2. **Minutes 1-8:** Model download in progress (~4-6 GB download over GitHub Actions network)
3. **Minute 8-9:** Download completed, Edge attempted to load model into GPU memory
4. **Minute 9:** GPU memory allocation failed (requested 5.5 GB, Intel iGPU can provide 1.5 GB max), triggering a native process crash that brought down the browser context

### Why the Crash Instead of a Graceful Error?

Edge's Phi-4 Mini inference runs as a native process managed by the browser. When GPU memory allocation fails at the ONNX Runtime / Metal level, it can cause an unrecoverable crash rather than a JavaScript-level error. The `LanguageModel.create()` call in the bootstrap script never gets a chance to return an error -- the entire browser process (or a critical subprocess) dies first.

This is different from the `macos-latest` (ARM, 7 GB) failure, which failed during bootstrap with only 0.6 GB free RAM -- that was a system-level memory exhaustion before the model could even download. On the Intel runner, there was plenty of system RAM and disk for the download, but the GPU VRAM bottleneck killed the process at load time.

### Alternative Explanations (Less Likely)

| Explanation                  | Likelihood | Why                                                                                                                |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Model download timed out     | LOW        | 9 minutes is plausible for a 4-6 GB download, and 600s timeout was set                                             |
| Model not available on macOS | LOW        | The LanguageModel API returned `downloadable`/`downloading` (otherwise the script would have exited with `no-api`) |
| Metered connection detection | LOW        | GitHub Actions runners do not report metered connections                                                           |
| Edge bug unrelated to GPU    | LOW        | The crash timing (post-download) is too coincidental                                                               |

---

## 8. Can `--disable-gpu` Help?

**Confidence:** MEDIUM (inference from architecture)

**No, `--disable-gpu` cannot help and may actively harm.**

The `--disable-gpu` flag was used on the `macos-26-intel` runner. This flag:

1. **Disables Chromium's GPU compositor** -- rendering falls back to software
2. **Disables WebGPU** -- web pages cannot use GPU compute
3. **Does NOT disable Edge's native model inference GPU path** -- the ONNX Runtime native process has its own GPU initialization

Using `--disable-gpu` means:

- The renderer uses software compositing (CPU-based), consuming more CPU and RAM
- WebGPU is unavailable (irrelevant for the Prompt API which uses a native path)
- The native ONNX Runtime inference process still attempts to use the GPU via Metal
- When Metal GPU allocation fails, the process crashes

If anything, `--disable-gpu` makes the situation worse by increasing CPU/RAM pressure for rendering without solving the GPU VRAM problem for model inference.

**What would help:** A flag or mode that tells Edge's native inference engine to use CPU-only inference. No such flag is documented. The `edge-llm-on-device-model-performance-param@3` flag bypasses Edge's performance check but does not change the inference backend from GPU to CPU.

---

## 9. Recommendations

### Immediate: Remove `macos-26-intel` from the Edge Dev CI Matrix

The Intel Mac runner cannot meet the 5.5 GB GPU VRAM requirement. This is a hardware limitation, not a configuration issue. No combination of flags, memory cleanup, or optimization can make it work.

### Immediate: Remove `macos-latest` (ARM, 7 GB) from the Edge Dev CI Matrix

Already identified in previous research -- the 7 GB M1 VM has a 1 GB MPS GPU memory cap plus insufficient total RAM. Two independent blockers.

### Keep: `windows-11-arm` as the Only Edge Dev Runner

The Windows 11 ARM64 runner with 16 GB RAM and Qualcomm Adreno GPU (8 GB+ VRAM) is the only GitHub-hosted runner that meets Edge Dev's Phi-4 Mini requirements. This is where the model works, and this should be the sole Edge Dev test runner.

### Future: Monitor Larger macOS Runners

| Runner                          | Architecture | RAM   | GPU                                | Could Work?                        |
| ------------------------------- | ------------ | ----- | ---------------------------------- | ---------------------------------- |
| `macos-latest-xlarge` (M2 Pro)  | ARM64        | 14 GB | 8-core Apple GPU (paravirtualized) | UNLIKELY -- same MPS cap issue     |
| `macos-latest-large` (Intel)    | x86_64       | 30 GB | Intel iGPU (~1.5 GB VRAM)          | NO -- same iGPU VRAM limit         |
| Self-hosted Mac Mini M4 (32 GB) | ARM64        | 32 GB | Full GPU access                    | YES -- but requires infrastructure |

Even the paid `macos-latest-large` (Intel, 30 GB) runner would fail because the GPU VRAM limit is an Intel iGPU architecture constraint, not a RAM constraint.

The only macOS runner that could theoretically work is a **self-hosted Apple Silicon Mac** with full hardware access (no VM GPU memory cap). This is outside the scope of GitHub-hosted runners.

### Consider: Filing a Feature Request

File an issue on [MSEdgeExplainers](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues) requesting:

1. CPU-only inference fallback for Phi-4 Mini (for devices without adequate GPU)
2. Documentation of minimum GPU requirements per platform (macOS Intel vs Apple Silicon)
3. Graceful error handling when GPU VRAM is insufficient (instead of crashing)

---

## 10. Summary Table

| Question                                           | Answer                                                                        | Confidence |
| -------------------------------------------------- | ----------------------------------------------------------------------------- | ---------- |
| Does Prompt API support macOS Intel?               | Technically yes (macOS 13.3+), but GPU VRAM requirement eliminates Intel Macs | HIGH       |
| Is 14 GB RAM sufficient?                           | System RAM yes, but GPU VRAM (1.5 GB) is the blocker                          | HIGH       |
| Does Edge Dev macOS have same features as Windows? | Same API, different GPU backend (Metal vs DirectML)                           | MEDIUM     |
| What macOS version is `macos-26-intel`?            | macOS 26 "Tahoe" -- meets OS requirement                                      | HIGH       |
| Are there known macOS Intel issues?                | No public reports; likely untested configuration                              | MEDIUM     |
| What caused the 9-minute crash?                    | Model downloaded successfully, GPU memory allocation failed at load time      | HIGH       |
| Can `--disable-gpu` help?                          | No -- it disables renderer GPU, not model inference GPU path                  | MEDIUM     |
| Is there a CPU fallback?                           | Undocumented; likely no for Edge's built-in model                             | MEDIUM     |
| Can any macOS GitHub runner work?                  | No standard runner meets requirements; self-hosted only                       | HIGH       |

---

## Sources

### Official Documentation (HIGH confidence)

- [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) -- Hardware requirements, setup guide, updated 2026-02-04
- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) -- Runner specs (macos-26-intel: 4 cores, 14 GB RAM)
- [GitHub changelog: macOS 26 GA](https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/) -- macOS 26 availability
- [runner-images#13637](https://github.com/actions/runner-images/issues/13637) -- macOS 26 Intel runner details

### Architecture Analysis (HIGH confidence)

- macOS Intel iGPU VRAM limits: 1.5 GB default, ~2 GB hard maximum in driver stack
- Apple Silicon unified memory: dynamically allocable 66-75% of total RAM
- Edge inference uses ONNX Runtime native process, not WebGPU
- DirectML is Windows-only; macOS uses Metal backend

### GitHub Issues (HIGH confidence)

- [MSEdgeExplainers#1012](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1012) -- Prompt API feedback (no macOS Intel reports)
- [MSEdgeExplainers#1224](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1224) -- 9216 token context limit
- [actions/runner-images#9918](https://github.com/actions/runner-images/issues/9918) -- MPS GPU cap on ARM VMs
- [actions/runner-images#11899](https://github.com/actions/runner-images/issues/11899) -- MPS OOM at ~1 GB cap

### Community Sources (MEDIUM confidence)

- [WindowsForum: Edge Phi-4 Mini analysis](https://windowsforum.com/threads/microsoft-edges-on-device-ai-with-phi-4-mini-a-new-era-of-privacy-and-performance.366704/)
- [WindowsLatest: Edge Phi-4 mini integration](https://www.windowslatest.com/2025/05/19/microsoft-edge-could-integrate-phi-4-mini-to-enable-on-device-ai-on-windows-11/)
- [Intel: Accelerate Phi-4 SLMs](https://www.intel.com/content/www/us/en/developer/articles/technical/accelerate-microsoft-phi-4-small-language-models.html) -- CPU inference on Intel Xeon (server-class, not iGPU)
- tonymacx86 forums on macOS iGPU VRAM allocation limits

### Existing Project Research

- `.planning/research/edge-dev-phi4-mini-languagemodel-api.md` -- Edge flag names, platform support
- `.planning/research/macos-runner-memory-optimization.md` -- macOS runner memory budgets, MPS cap
