# Docker vs Bare Runner for Chrome Built-in AI Inference

**Researched:** 2026-03-21
**Overall confidence:** HIGH
**Verdict:** Switch the Chrome Beta Linux job from Docker container to bare `ubuntu-latest` runner.

## Executive Summary

The `UnknownError: Other generic failures occurred.` error when calling `session.prompt()` inside a Docker container on GitHub Actions is almost certainly caused by TFLite/LiteRT inference failing due to Docker's isolation of GPU devices and/or the GPU performance shader check returning invalid results in the containerized environment. The model downloads successfully and reports as `available` because the `BypassPerfRequirement` flag skips the hardware eligibility check for download, but it does not skip the actual inference execution path, which still attempts to use GPU resources that are inaccessible inside the container.

The recommended fix is to **run Chrome Beta directly on the bare `ubuntu-latest` runner** instead of inside the custom Docker image. This is feasible, well-supported by Playwright, and eliminates the container isolation layer that blocks hardware access. Chrome Beta 147 (the current beta channel, March 2026) is well past Chrome 140 where CPU-only inference support was added, so the runner's lack of a GPU is no longer a blocker.

## Problem Analysis

### Why inference fails in Docker

The failure chain is:

1. **Model downloads successfully** -- The `BypassPerfRequirement` flag bypasses the GPU shader performance check that gates model download. The model component downloads, and `LanguageModel.availability()` returns `"available"`.

2. **`session.prompt()` fails at inference time** -- When actually running inference, Chrome's LiteRT-LM runtime attempts to use GPU acceleration. Inside Docker on a standard GitHub Actions runner, this fails because:

   a. **No GPU hardware exists** -- Standard `ubuntu-latest` runners have no GPU. There are 4 vCPUs and 16 GB RAM, but zero GPU/VRAM.

   b. **`/dev/dri` is not mounted** -- Even if the host had a GPU, Docker containers do not expose GPU device nodes by default. The `--device /dev/dri` flag or NVIDIA container runtime would be needed.

   c. **Software rendering (SwiftShader) may be broken or insufficient** -- In a container without a display server, Chrome's software GL fallback (SwiftShader/Angle) may not initialize properly, causing the GPU process to fail silently. The `UnknownError` is Chrome's catch-all for "the TFLite GPU delegate failed and there was no viable fallback."

   d. **Docker seccomp profile restricts syscalls** -- The default Docker seccomp profile blocks `clone` with namespace flags and `unshare`, which Chrome's sandbox uses. While the CI config uses `--no-sandbox` implicitly (non-root user), these restrictions can still affect Chrome's GPU process initialization.

3. **CPU fallback was not available** -- Before Chrome 140, Chrome had no CPU-only inference path for Gemini Nano. If the GPU delegate failed, inference failed entirely with `UnknownError`. As of Chrome 140+, a CPU fallback path exists, but it has its own static requirements (16 GB RAM, 4+ cores) and the performance shader check must resolve to the CPU path -- which may not happen correctly in a container where the GPU probe returns anomalous results rather than "no GPU."

### The `BypassPerfRequirement` trap

The flag `optimization-guide-on-device-model@2` (which maps to "Enabled BypassPerfRequirement") is a development convenience that skips the download eligibility check. It does NOT:

- Bypass the runtime GPU delegate selection
- Force CPU-only inference
- Make inference work on hardware that cannot run the model

This creates a false positive: the model appears ready, but inference fails. The Chrome team has acknowledged this produces the unhelpful `UnknownError: Other generic failures occurred.` message, with an open bug at https://issues.chromium.org/issues/479676595.

## GitHub Actions Runner Hardware (Confidence: HIGH)

### Standard `ubuntu-latest` (current, 2025+)

| Resource               | Value                         | Source                 |
| ---------------------- | ----------------------------- | ---------------------- |
| vCPUs                  | 4                             | GitHub Docs            |
| RAM                    | 16 GB                         | GitHub Docs            |
| Disk (guaranteed free) | 14 GB                         | GitHub Docs            |
| Disk (actual free)     | ~22 GB (x64)                  | Community testing      |
| GPU                    | None                          | Azure Dv2/DSv2 VMs     |
| CPU arch               | x86_64 (AMD EPYC or Intel)    | Azure Dv2/DSv2         |
| AVX2                   | Yes (all Dv2/DSv2 support it) | Community verification |
| OS                     | Ubuntu 24.04                  | GitHub Docs            |

### Chrome Built-in AI Hardware Requirements

| Requirement | GPU path | CPU path | `ubuntu-latest` meets?   |
| ----------- | -------- | -------- | ------------------------ |
| VRAM        | > 4 GB   | N/A      | NO (no GPU)              |
| RAM         | --       | >= 16 GB | YES (exactly 16 GB)      |
| CPU cores   | --       | >= 4     | YES (exactly 4)          |
| Disk free   | >= 22 GB | >= 22 GB | MARGINAL (22 GB typical) |
| OS          | Linux    | Linux    | YES                      |

The `ubuntu-latest` runner meets the CPU inference requirements exactly at the minimum thresholds. The 22 GB free disk space requirement is tight but achievable, especially if unused pre-installed software is cleaned up.

**Critical insight:** Chrome 147 (current Beta) supports CPU inference (added in Chrome 140). The runner has exactly 4 cores and 16 GB RAM -- meeting the CPU path minimums. This means bare-runner inference should work without any GPU, provided Chrome correctly detects the CPU path.

## Docker Container Isolation Impact (Confidence: HIGH)

### What Docker blocks

| Resource                              | Blocked by Docker?               | Impact on Chrome AI         |
| ------------------------------------- | -------------------------------- | --------------------------- |
| GPU device (`/dev/dri`)               | Yes, unless `--device` flag      | GPU inference impossible    |
| GPU drivers                           | Yes, unless NVIDIA runtime       | GPU delegate fails          |
| `/dev/shm` (64 MB default)            | Partially (CI uses `--ipc=host`) | Mitigated in current config |
| Seccomp syscalls (`clone`, `unshare`) | Yes (default profile)            | Chrome sandbox conflicts    |
| CPU instructions (AVX2, SSE4)         | No                               | CPU inference unaffected    |
| RAM                                   | No (shares host RAM)             | CPU inference unaffected    |
| Disk space                            | Shared with host                 | Unaffected                  |

### The current CI container config

```yaml
container:
  image: 'ghcr.io/.../playwright-chrome-beta:latest'
  options: '--ipc=host --user 1001'
```

This config:

- `--ipc=host`: Shares host shared memory -- fixes Chrome rendering crashes
- `--user 1001`: Runs as non-root -- required for Chrome, but means `--no-sandbox` is implicit
- Does NOT add: `--device /dev/dri`, `--privileged`, `--security-opt seccomp=unconfined`, `--gpus`

The missing GPU device access is the primary blocker. But even adding `--device /dev/dri` would not help because the `ubuntu-latest` host has no GPU.

## Bare Runner Approach (Confidence: HIGH)

### How it would work

On a bare `ubuntu-latest` runner (no container), Chrome Beta runs directly on the host OS with full access to all hardware resources. The key differences:

| Aspect               | Docker container                          | Bare runner              |
| -------------------- | ----------------------------------------- | ------------------------ |
| GPU access           | Blocked                                   | Full (but no GPU exists) |
| `/dev/shm`           | 64 MB default (mitigated by `--ipc=host`) | Full host shared memory  |
| Seccomp              | Docker default profile                    | No Docker seccomp        |
| Namespace sandbox    | Conflicts with Docker                     | Native support           |
| CPU features         | Pass-through (no isolation)               | Native                   |
| GPU shader probe     | May return anomalous results              | Returns "no GPU" cleanly |
| Chrome process model | Works but constrained                     | Fully native             |

### Why bare runner should fix the inference failure

The critical difference is how Chrome's GPU performance shader check behaves:

- **In Docker:** The shader probe may attempt to initialize a GPU context via OpenGL/Vulkan/SwiftShader within the container's restricted environment. If this initialization partially succeeds (e.g., SwiftShader loads but cannot execute shaders properly), Chrome may select a GPU inference path that then fails at runtime.

- **On bare runner:** Chrome probes the GPU, finds no capable GPU (no `/dev/dri`, no GPU drivers), cleanly determines the device is CPU-only, and selects the CPU inference path. With Chrome 147 (past the Chrome 140 CPU support milestone), the LiteRT-LM runtime will use XNNPACK for CPU-based inference.

### Installation on bare runner

Playwright provides a one-command installation:

```bash
npx playwright install chrome-beta --with-deps
```

This installs:

- Chrome Beta browser binary
- All required OS-level dependencies (system libraries, fonts, etc.)

This is the official Playwright-recommended approach for CI environments and is well-tested on `ubuntu-latest` / Ubuntu 24.04.

### Disk space concern

The Gemini Nano model requires approximately 2 GB of disk space, and Chrome's model management system requires 22 GB free on the profile volume. On `ubuntu-latest`:

- Typical free space: ~22 GB
- After `npm ci` and Chrome install: probably ~15-18 GB free
- This is potentially tight

Mitigations:

1. Use the `actions/cache` for the model (already implemented) -- avoids re-download
2. If needed, use the [Free Disk Space](https://github.com/marketplace/actions/free-disk-space-ubuntu) action to reclaim up to 31 GB
3. The 22 GB requirement is for the _initial download check_ -- with a cached model, this check may be less strict

## Recommended CI Changes

### Phase 1: Switch Chrome Beta to bare runner (immediate fix)

Remove the container for the Chrome Beta job and install the browser directly:

```yaml
test:
  needs: ghcr
  runs-on: ${{ matrix.runner }}
  strategy:
    fail-fast: false
    matrix:
      include:
        - browser: chrome-beta
          project: chrome-gemini-nano
          cache-key: chrome-beta-ai-model-v1
          runner: ubuntu-latest
          xvfb: 'xvfb-run --auto-servernum'
          use-container: false
        - browser: msedge-dev
          project: edge-phi4-mini
          cache-key: msedge-dev-ai-model-windows11-arm-v1
          runner: windows-11-arm
          xvfb: ''
          use-container: false
  # Only use container for jobs that still need it
  container: ${{ matrix.use-container && fromJSON(format('{{"image":"{0}-{1}:latest","options":"--ipc=host --user 1001"}}', needs.ghcr.outputs.image, matrix.browser)) || '' }}
  steps:
    - uses: actions/checkout@v6
      with:
        filter: tree:0
        fetch-depth: 0

    - uses: nrwl/nx-set-shas@v5

    - uses: actions/setup-node@v6
      with:
        node-version-file: '.node-version'
        cache: 'npm'

    - run: npm ci

    # Install browser on bare runners (both Linux and Windows)
    - name: Install ${{ matrix.browser }}
      run: npx playwright install ${{ matrix.browser }} --with-deps

    # ... rest of steps unchanged
```

Since both Chrome Beta (Linux) and Edge Dev (Windows) are now bare runners, the install step runs for both, and the container logic is removed entirely.

### Phase 2: Simplify -- remove Docker images entirely (if Edge Dev also does not use container)

If neither browser job uses the Docker container, the entire Docker image build pipeline (`build-playwright-images.yml`, `.github/docker/Dockerfile`) can be removed. The `ghcr` job in `ci.yml` also becomes unnecessary.

This simplification:

- Eliminates Docker image build/push workflow (saves CI minutes and maintenance)
- Removes the need for `packages: write` permission
- Removes the GHCR dependency from the test job
- Simplifies the CI workflow significantly

### Phase 3: Disk space management (if needed)

If the model download fails due to insufficient disk space on bare `ubuntu-latest`:

```yaml
- name: Free disk space
  uses: jlumbroso/free-disk-space@main
  with:
    tool-cache: false
    android: true
    dotnet: true
    haskell: true
    large-packages: false # slow, only enable if needed
    swap-storage: false
```

This can reclaim 10-20 GB depending on options selected.

### Phase 4: Consider Chrome 140+ CPU inference flags (if model still fails)

If Chrome does not automatically select the CPU path on the bare runner, try these additional flags in the bootstrap script and Playwright config:

```javascript
// Force CPU inference by not bypassing -- let Chrome's normal check detect "no GPU"
// Change from: 'optimization-guide-on-device-model@2' (BypassPerfRequirement)
// To: 'optimization-guide-on-device-model@1' (Enabled, normal check)
```

The reasoning: `@2` (BypassPerfRequirement) may cause Chrome to attempt GPU inference even when no GPU exists. Using `@1` (Enabled, normal hardware check) on Chrome 147 should cause Chrome to:

1. Run the GPU shader probe
2. Find no capable GPU
3. Check CPU static requirements (16 GB RAM, 4 cores) -- met
4. Download the smaller 2B parameter model for CPU inference
5. Use XNNPACK CPU delegate for inference

**However, this changes the download eligibility check**, which means the model may need to be re-downloaded (cache bust). Test this carefully.

## Impact Assessment

### What stays the same

- Windows `windows-11-arm` Edge Dev job: already a bare runner, no changes needed
- AI model cache strategy: unchanged
- Bootstrap script: unchanged (unless Phase 4 flag change)
- Playwright config: unchanged
- E2E and unit tests: unchanged

### What changes

- Chrome Beta Linux job: container removed, `npx playwright install chrome-beta --with-deps` added
- `ghcr` job: can be removed (if no remaining container users)
- `build-playwright-images.yml`: can be removed or deprecated
- `.github/docker/Dockerfile`: can be removed or kept for reference
- `xvfb-run` dependency: still needed (install via `--with-deps`)

### Risk assessment

| Risk                                                       | Likelihood | Mitigation                                 |
| ---------------------------------------------------------- | ---------- | ------------------------------------------ |
| Disk space insufficient for model                          | Medium     | Cache model, free disk space action        |
| CPU inference still fails                                  | Low        | Chrome 147 >> 140; CPU path is mature      |
| `npx playwright install --with-deps` fails on Ubuntu 24.04 | Low        | Well-tested by Playwright team             |
| Chrome Beta version changes break flags                    | Low        | Flags have been stable since Chrome 138    |
| Model cache key invalidation                               | Medium     | May need `v2` cache key after flag changes |
| xvfb not available on bare runner                          | None       | `--with-deps` installs xvfb                |

## Alternative Approaches Considered

### 1. Add `--device /dev/dri` to Docker options

**Why not:** The `ubuntu-latest` host has no GPU. Mounting a non-existent device does nothing.

### 2. Use `--privileged` Docker flag

**Why not:** Removes all Docker security restrictions but still does not add a GPU. Also a security risk in CI.

### 3. Use `--security-opt seccomp=unconfined`

**Why not:** The issue is not seccomp blocking syscalls -- it is the lack of GPU hardware for inference. This might help with Chrome sandbox issues but does not fix the inference failure.

### 4. Use GitHub GPU runners (`gpu-t4-4-core`)

**Why not:** Costs $0.07/min (not free for public repos), requires GitHub Team or Enterprise Cloud plan, and is overkill when CPU inference is now supported.

### 5. Use `--shm-size=2g` instead of `--ipc=host`

**Why not:** Shared memory is already handled by `--ipc=host`. This is not the cause of the inference failure.

### 6. Keep Docker but add SwiftShader flags

**Why not:** SwiftShader provides software OpenGL/Vulkan, but Chrome's LiteRT-LM inference does not use WebGL/WebGPU for Gemini Nano. The inference uses the TFLite GPU delegate directly, which needs actual GPU drivers, not just a software renderer.

## Sources

### Official Chrome Documentation

- [Expanding built-in AI to more devices with Chrome (CPU support)](https://developer.chrome.com/blog/gemini-nano-cpu-support)
- [Get started with built-in AI](https://developer.chrome.com/docs/ai/get-started)
- [Understand built-in model management in Chrome](https://developer.chrome.com/docs/ai/understand-built-in-model-management)
- [Built-in AI overview](https://developer.chrome.com/docs/ai/built-in)

### Chromium Discussion Groups

- [UnknownError: Other generic failures occurred](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/sAtcHSpZ08U) -- the exact error being investigated
- [When are we going to get proper error messages?](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/iVq7IJG0C9I) -- GPU OOM and bypass flag discussion
- [Chromium bug #479676595](https://issues.chromium.org/issues/479676595) -- tracking the generic error messages

### GitHub Actions

- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) -- runner specs
- [ubuntu-latest runner disk space discussion](https://github.com/actions/runner-images/discussions/9329) -- disk space details

### Docker Security

- [Docker seccomp profiles](https://docs.docker.com/engine/security/seccomp/) -- default syscall restrictions
- [Chrome seccomp profile](https://blog.jessfraz.com/post/how-to-use-new-docker-seccomp-profiles/) -- Chrome-specific namespace requirements

### Playwright

- [Setting up CI](https://playwright.dev/docs/ci-intro) -- official CI guidance
- [Continuous Integration](https://playwright.dev/docs/ci) -- bare runner setup

### Inference Runtime

- [LiteRT (successor to TFLite)](https://github.com/google-ai-edge/LiteRT) -- Chrome's on-device inference runtime
- [GPU delegates for LiteRT](https://ai.google.dev/edge/litert/performance/gpu) -- GPU delegate behavior and CPU fallback
