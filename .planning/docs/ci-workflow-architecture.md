# CI Workflow Architecture

**Project:** in-browser-ai-coding-agent
**Last updated:** 2026-03-22

---

## 1. Overview

The CI workflow validates an Angular application that uses the W3C LanguageModel API to run AI models entirely inside the browser. The application targets two browser/model combinations: Chrome Beta with Gemini Nano and Edge Dev with Phi-4 Mini. Both models are downloaded and executed on-device -- there is no cloud API involved.

This makes CI fundamentally different from a typical web application pipeline. The browsers under test are not interchangeable rendering engines; they are the AI runtime. Each browser has its own model delivery system, feature flags, and hardware requirements. The CI must download multi-gigabyte models into persistent browser profiles, warm the inference engine, and then run tests that perform real model inference. Test execution times are measured in minutes per prompt, not milliseconds per assertion.

The workflow is split into four jobs:

1. **ghcr** -- Resolves the container image name used by the test matrix.
2. **format** -- Checks code formatting on pull requests only.
3. **lint-typecheck-build** -- Runs linting, TypeScript type checking, and the production build.
4. **test** -- A matrix job that runs both e2e (Playwright) and unit (Vitest browser mode) tests against Chrome Beta and Edge Dev.

The first three jobs are fast, cheap, and stateless. The test job is the expensive one -- it requires branded browsers, model downloads, GPU/NPU access (for Edge), and persistent profile caching.

## 2. Jobs

### 2.1 `ghcr` -- Container Image Name Resolution

```yaml
runs-on: ubuntu-latest
outputs:
  image: ${{ steps.image.outputs.base }}
```

This job does one thing: it computes `ghcr.io/${GITHUB_REPOSITORY,,}/playwright` (lowercased) and exposes it as an output. The test matrix consumes this output to construct the full container image reference.

**Why a separate job?** GitHub Actions expressions cannot call `format()` or string functions inside `container:` image references at the job level. The image name must be a concrete string by the time the job starts. By resolving it in a prior job and passing it via `needs.ghcr.outputs.image`, the test job can dynamically construct `ghcr.io/layzeedk/in-browser-ai-coding-agent/playwright-chrome-beta:latest` without hardcoding the repository name.

### 2.2 `format` -- Formatting Check

```yaml
if: github.event_name == 'pull_request'
runs-on: ubuntu-latest
```

Runs `nx format:check` which invokes Prettier via Nx's built-in format command. Only runs on pull requests because pushes to `main` are assumed to have already passed format checks. Uses `nrwl/nx-set-shas@v5` to compute the affected range, so only changed files are checked.

The `filter: tree:0` and `fetch-depth: 0` on checkout is a treeless clone -- it fetches all commits (needed for Nx affected detection) but skips blob content for unchanged files, reducing clone size significantly.

### 2.3 `lint-typecheck-build` -- Static Analysis and Build

```yaml
runs-on: ubuntu-latest
```

Runs `nx run-many -t lint typecheck build` which executes all three targets across all affected projects in a single Nx invocation. Nx handles task ordering and parallelism internally. This job catches type errors, lint violations, and build failures before the expensive test job runs.

This job does **not** have `needs: [format]` -- it runs in parallel with the format check. This is intentional: a formatting issue should not block the developer from seeing lint/build/test results.

### 2.4 `test` -- E2E and Unit Tests with Real AI Models

```yaml
needs: ghcr
strategy:
  fail-fast: false
  matrix:
    include:
      - browser: chrome-beta    / runner: ubuntu-latest     / container: true
      - browser: msedge-dev     / runner: windows-11-arm    / container: false
```

This is the core of the pipeline. Each matrix entry:

1. Checks out code and installs dependencies
2. Restores cached AI model profile (or bootstraps from scratch)
3. Runs e2e tests (Playwright)
4. Runs unit tests (Vitest in browser mode)
5. Writes prompt responses to the GitHub Actions job summary
6. Saves the model profile cache for future runs

`fail-fast: false` ensures both matrix entries run to completion even if one fails -- a Chrome failure should not prevent Edge results from being captured, since the two model/browser combinations are independent.

## 3. Test Matrix

### 3.1 The Two Entries

| Property       | Chrome Beta                                  | Edge Dev                         |
| -------------- | -------------------------------------------- | -------------------------------- |
| `browser`      | `chrome-beta`                                | `msedge-dev`                     |
| `project`      | `chrome-gemini-nano`                         | `edge-phi4-mini`                 |
| `runner`       | `ubuntu-latest`                              | `windows-11-arm`                 |
| `xvfb`         | `xvfb-run --auto-servernum`                  | (empty)                          |
| `container`    | `true`                                       | `false`                          |
| AI model       | Gemini Nano                                  | Phi-4 Mini                       |
| Model delivery | Chrome Optimization Guide (component update) | Edge LLM system (edge-llm flags) |

### 3.2 Why These Specific Runners

**Chrome Beta on `ubuntu-latest` (containerized):**
Gemini Nano runs on CPU. It does not require a GPU. Linux is the cheapest and fastest runner available on GitHub Actions. The container pre-installs Chrome Beta and all system dependencies, so the job skips the `playwright install` step entirely.

**Edge Dev on `windows-11-arm`:**
Phi-4 Mini is a larger model (3.8B parameters) that benefits from NPU/GPU acceleration. The `windows-11-arm` runner provides Arm64 hardware with a Qualcomm Snapdragon NPU and GPU, which Edge Dev can use for model inference via ONNX Runtime. This runner also closely matches the developer's local machine (Surface Laptop 7 with Snapdragon X Elite), making CI results representative of local behavior.

### 3.3 Why Other Runners Were Rejected

**`windows-latest` (Windows Server 2025, x86_64):**
This was tried and removed. `windows-latest` resolves to Windows Server 2025, which is a Server SKU, not Desktop. Phi-4 Mini only supports Windows 10/11 Desktop. On Windows Server, the model download silently times out without an error -- the on-device model system simply does not function on Server SKUs. There is no error message; the model just never becomes available.

**macOS runners (`macos-14`, `macos-15`, `macos-15-intel`, `macos-26-intel`):**
macOS was extensively tested with multiple runner types and many combinations of launch flags: `--in-process-gpu`, `--no-sandbox`, `--disable-gpu-sandbox`, `--headless=new`, `--disable-software-rasterizer`. All configurations failed.

The `--in-process-gpu --no-sandbox` flags prevented browser crashes on launch (the default configuration crashed immediately), but revealed a deeper issue: Edge explicitly rejects the macOS device with `InvalidStateError`. The underlying problem is that ONNX Runtime -- the inference engine used by both Chrome and Edge's on-device model systems -- crashes on insufficient GPU VRAM instead of gracefully falling back to CPU. GitHub-hosted macOS runners, while using Apple Silicon with unified memory, do not expose enough GPU VRAM for the model to load. The ONNX Runtime code path has no CPU fallback on macOS, unlike the Chrome 140+ CPU inference support on Linux.

### 3.4 The `xvfb` Column

Chrome Beta on Linux requires a virtual framebuffer (`xvfb-run --auto-servernum`) because the ubuntu runner has no display server. The `--auto-servernum` flag avoids conflicts if multiple Xvfb instances are running. Edge Dev on Windows does not need this -- Windows runners have a display environment available.

## 4. Docker Container Strategy

### 4.1 Why Chrome Beta Uses a Container

Chrome Beta on Ubuntu needs ~200 MB of system dependencies (shared libraries for Chromium) installed via `playwright install-deps`. Installing these on every CI run would add 30-60 seconds and require `sudo`. By baking Chrome Beta and its dependencies into a Docker image, the test job starts with everything pre-installed.

The container image is built from `.github/docker/Dockerfile`, which uses a multi-stage build:

```
ubuntu:24.04 (base)
  +-- Node.js via NodeSource
  +-- git, xvfb
  +-- playwright install-deps chromium (shared Chromium dependencies)
  +-- non-root user (UID 1001 = GitHub Actions runner user)
      |
      +-- chrome-beta stage: playwright install chrome-beta
      +-- msedge-dev stage: playwright install msedge-dev
```

The `base` stage installs common dependencies. Two final stages (`chrome-beta` and `msedge-dev`) each install their browser. The build workflow uses Docker's `target` parameter to build each stage separately.

The container runs with `--ipc=host` (required for Chromium's shared memory) and `--user 1001` (matching the `pwuser` created in the image, which maps to the GitHub Actions runner UID).

### 4.2 Why Edge Dev Does NOT Use a Container

Edge Dev runs on `windows-11-arm`, and GitHub Actions does not support Docker containers on Windows ARM runners. Even on x86_64 Windows runners, Docker-in-Actions support is limited. Instead, Edge Dev is installed at runtime via `npx playwright install msedge-dev --with-deps`.

### 4.3 The `ghcr` Job and Image Naming

Images are pushed to GitHub Container Registry (GHCR) with two tags:

- `ghcr.io/<owner>/<repo>/playwright-<browser>:v<playwright-version>` -- pinned to the exact Playwright version
- `ghcr.io/<owner>/<repo>/playwright-<browser>:latest` -- rolling tag for CI consumption

The CI workflow always pulls `:latest`. The versioned tag exists for reproducibility and rollback.

### 4.4 Build Triggers

The `build-playwright-images.yml` workflow runs on pushes to `main` when these paths change:

- `.node-version` -- Node.js version bump means the image base changes
- `package-lock.json` -- Playwright version bump means browser versions change
- `.github/docker/Dockerfile` -- Image definition changes

It also supports `workflow_dispatch` for manual rebuilds.

Build layer caching uses GitHub Actions cache (`type=gha`), scoped per browser to avoid cache key collisions.

## 5. Caching Strategy

The CI uses four distinct caching strategies, each tuned to a specific bottleneck.

### 5.1 npm Download Cache (Ubuntu jobs)

```yaml
- uses: actions/setup-node@v6
  with:
    cache: 'npm'
```

On ubuntu-latest (both inside and outside the container), `setup-node` caches npm's HTTP download cache (`~/.npm`). This does not cache `node_modules` -- it caches the tarballs so that `npm ci` does not re-download them from the registry. `npm ci` still runs every time to ensure a clean install from `package-lock.json`.

For the test job specifically, the cache parameter is conditionally set: `cache: ${{ matrix.container && 'npm' || '' }}`. When `container` is `true`, npm download caching is enabled. When `false` (Windows ARM), it is disabled because the Windows ARM job uses direct `node_modules` caching instead (see below).

### 5.2 node_modules Direct Cache (Windows ARM only)

```yaml
- name: Restore node_modules cache
  if: ${{ !matrix.container }}
  uses: actions/cache/restore@v5
  with:
    path: node_modules
    key: ${{ runner.os }}-${{ runner.arch }}-node-modules-${{ hashFiles('package-lock.json') }}
```

**Why direct `node_modules` caching instead of npm download cache?**

`npm ci` on `windows-11-arm` (ARM64) is slow -- significantly slower than on x86_64 Linux. The bottleneck is not downloading tarballs but extracting and linking them. Native modules may also need compilation. By caching the entire `node_modules` directory keyed to `package-lock.json`, the job skips `npm ci` entirely on cache hits.

The key includes `runner.os` and `runner.arch` to prevent cross-platform cache pollution. The separate `restore` and `save` actions (instead of the unified `actions/cache`) provide fine-grained control: `npm ci` is skipped when `cache-hit == 'true'`, and `save` only runs on misses to avoid redundant uploads.

### 5.3 AI Model Profile Cache

```yaml
- name: Restore AI model cache
  uses: actions/cache/restore@v5
  with:
    path: .playwright-profiles/${{ matrix.browser }}
    key: ${{ matrix.cache-key }}-run${{ github.run_number }}
    restore-keys: |
      ${{ matrix.cache-key }}-run
      ${{ matrix.cache-key }}
```

This is the most nuanced cache in the pipeline.

**What is cached:** The browser's persistent user data directory (`.playwright-profiles/chrome-beta` or `.playwright-profiles/msedge-dev`). This directory contains:

- `Local State` -- chrome://flags entries (seeded by the bootstrap script)
- The downloaded AI model files (several GB for Phi-4 Mini, ~90 MB for Gemini Nano)
- ONNX Runtime inference artifacts generated during model warm-up and first inference: `adapter_cache.bin`, `encoder_cache.bin`, compiled model shards, and other optimization files

**Key format: `${{ matrix.cache-key }}-run${{ github.run_number }}`**

The key uses the run number as a suffix. This means every CI run creates a new cache entry. The `restore-keys` use prefix matching:

1. `${{ matrix.cache-key }}-run` -- matches the most recent run's cache
2. `${{ matrix.cache-key }}` -- matches any cache for this browser/platform

**Why append the run number?**

GitHub Actions cache keys are immutable -- you cannot overwrite an existing key. The run-number suffix creates a new key each time, implementing a "rolling cache" pattern.

The model profile accumulates optimization artifacts over successive runs. After the first inference, the browser's ONNX Runtime writes adapter caches (`adapter_cache.bin`, `encoder_cache.bin`) and compiled model shards that dramatically reduce subsequent inference startup time. Without these cached artifacts, first inference on the ARM runner takes **11+ minutes**. With them, the model starts warm.

By saving a new cache after every run (post-test), these progressively-accumulated artifacts are preserved. The `restore-keys` prefix matching ensures the latest cache is always restored, even though the exact key never matches (because the run number is new). GitHub automatically evicts the oldest caches when the repository cache budget (10 GB) is exceeded.

**Why save post-test (not post-bootstrap)?**

```yaml
- name: Save AI model cache (post-test)
  if: ${{ !cancelled() && steps.bootstrap.outcome != 'failure' }}
```

The cache is saved after tests complete, not just after bootstrap. This is because the ONNX Runtime inference artifacts (`adapter_cache.bin`, `encoder_cache.bin`, compiled model shards) are generated during actual inference -- which happens during test runs. Saving post-test captures these artifacts, making subsequent runs start with a fully warmed cache.

### 5.4 No Edge Dev Browser Cache

Edge Dev is installed fresh on every run via `npx playwright install msedge-dev --with-deps`. There is no caching of the browser binary.

**Why?** Edge Dev browser caching was tried and removed. The issue is that Playwright's `install msedge-dev` command detects existing binaries and skips the download, even if the installed version is outdated. This creates version drift: the cached binary could be several versions behind the latest Edge Dev build, and Edge's on-device model system can behave differently across versions. A fresh install ensures the CI always tests against the latest Edge Dev build.

Chrome Beta inside the container also uses "fresh" binaries in a sense -- the container image is rebuilt when Playwright or Node versions change, which pulls the latest Chrome Beta available to that Playwright version.

## 6. Bootstrap Script

### 6.1 What It Does

`scripts/bootstrap-ai-model.mjs` performs a one-time setup of the browser profile for on-device AI:

1. **Seeds `Local State` with chrome://flags** -- writes flag entries to the browser's `Local State` JSON file, equivalent to manually toggling flags in `chrome://flags`
2. **Seeds `internal_only_uis_enabled`** -- enables access to internal debug pages without manual clicking (see Section 6.6)
3. **Launches the browser with a persistent profile** -- uses Playwright's `launchPersistentContext` so the profile (including model downloads) persists across launches
4. **Removes Playwright defaults that block the LanguageModel API** -- Playwright injects several `--disable-*` flags that cripple the model system
5. **Triggers model download** -- navigates to a page, calls `LanguageModel.availability()`, and if `downloadable`/`downloading`, calls `LanguageModel.create()` with a download progress monitor
6. **Logs system resources** -- reports memory and disk usage before launch and after any crash, aiding diagnostics

### 6.2 Playwright Default Args That Must Be Removed

Playwright's default launch arguments disable several Chrome subsystems for test reliability. Four of these cripple the on-device AI model system:

| Default Arg                               | What It Breaks                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `--disable-features=...OptimizationHints` | Disables the Optimization Guide that manages on-device model delivery    |
| `--disable-field-trial-config`            | Disables Chrome's field trial system that gates model eligibility        |
| `--disable-background-networking`         | Prevents the variations seed fetch and model component update checks     |
| `--disable-component-update`              | Prevents the model component from registering with the component updater |

The script uses `ignoreDefaultArgs` to remove these four flags. It then re-injects the `--disable-features` list with all the original entries _except_ `OptimizationHints`, preserving Playwright's other behavioral overrides.

**Important:** `ignoreDefaultArgs` uses exact string comparison. The `PLAYWRIGHT_DISABLE_FEATURES` constant must match Playwright's actual default string character-for-character. If Playwright updates its default feature list in a new version, this constant must be updated to match.

### 6.3 Flags Seeded in Local State

**Chrome Beta:**

| Flag                                   | Value   | Purpose                                                                      |
| -------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `optimization-guide-on-device-model@1` | Enabled | Enables the Optimization Guide on-device model download and execution system |
| `prompt-api-for-gemini-nano@1`         | Enabled | Exposes the `LanguageModel` (Prompt) API to web pages                        |

**Edge Dev:**

| Flag                                           | Value    | Purpose                                                   |
| ---------------------------------------------- | -------- | --------------------------------------------------------- |
| `edge-llm-prompt-api-for-phi-mini@1`           | Enabled  | Enables Edge's Phi-4 Mini model via the LanguageModel API |
| `edge-llm-on-device-model-performance-param@3` | Option 3 | Configures performance parameters for the Edge LLM system |

### 6.4 Why `@1` (Enabled) Not `@2` (Enabled BypassPerfRequirement)

The `optimization-guide-on-device-model` flag has three options:

- `@0` -- Default (off)
- `@1` -- Enabled
- `@2` -- Enabled BypassPerfRequirement

`@2` was the original choice for CI, intending to bypass hardware performance checks (minimum RAM, disk space, GPU capability). However, **`@2` predates Chrome 140's CPU inference support**. When BypassPerfRequirement is active, Chrome forces selection of a GPU backend even on machines without a GPU. On the no-GPU `ubuntu-latest` runners, this causes `UnknownError: Other generic failures occurred` during `LanguageModel.create()`. The Chromium team confirmed this behavior in their developer discussion group.

Using `@1` means the standard performance checks run. Chrome 140+ correctly detects that no GPU is available and falls back to CPU inference. The GitHub Actions runners meet the minimum hardware requirements for CPU inference, so the checks pass and the model loads successfully.

### 6.5 Additional Launch Args

**Chrome Beta:**

- `--no-first-run` -- Skips the first-run experience dialog
- `DISABLE_FEATURES_WITHOUT_OPT_HINTS` -- Re-injects Playwright's disable-features list minus OptimizationHints

**Edge Dev:**

- `--no-first-run` -- Skips the first-run experience
- `--enable-features=AIPromptAPI` -- Enables the LanguageModel API on Edge
- `--disable-features=OnDeviceModelPerformanceParams` -- Disables Edge's performance parameter gating (the Edge equivalent of bypassing perf requirements, but as a feature flag rather than a chrome://flags option)
- `DISABLE_FEATURES_WITHOUT_OPT_HINTS` -- Same as Chrome

### 6.6 `internal_only_uis_enabled` Flag

The bootstrap script seeds `internal_only_uis_enabled: true` in the `Local State` JSON. This flag enables access to Chrome/Edge internal debug pages like `chrome://on-device-internals` and `edge://on-device-internals` without needing to manually click the "Enable" button on the page.

**Why programmatic seeding instead of clicking the button:** This flag was discovered by inspecting the browser profile after manually enabling debug pages in Chrome on the developer's machine. Attempting to click the enable button inside the Docker container crashes the browser -- the internal page's UI triggers a GPU code path that fails in the containerized environment. Seeding the flag directly in `Local State` bypasses the UI entirely, avoiding the crash.

These debug pages are used during the warm-up phase to monitor model readiness (see Section 10).

### 6.7 Crash Diagnostics

The bootstrap script registers handlers for browser disconnection, context closure, and page crashes:

```javascript
context.on('close', () => {
  /* unexpected close detection */
});
context.browser()?.on('disconnected', () => {
  /* process disconnect detection */
});
page.on('crash', () => {
  /* renderer OOM or GPU failure */
});
```

On crash, `logSystemResources()` reports free/total memory and disk space. This aids diagnosis of model download failures, which are often caused by insufficient disk space (multi-GB model files) or out-of-memory conditions during model loading.

## 7. Test Execution Order

### 7.1 E2E First, Then Unit Tests

```yaml
- name: Run e2e tests (${{ matrix.project }}) # Step 1
- name: Run unit tests (${{ matrix.project }}) # Step 2
```

This ordering is deliberate and performance-critical.

**E2E tests perform model warm-up as a side effect.** The e2e fixture (`fixtures.ts`) is worker-scoped with a 20-minute timeout (`1_200_000` ms). Before any e2e test runs, the fixture:

1. Opens the persistent context
2. Navigates to `chrome://on-device-internals` (or `edge://on-device-internals`)
3. Calls `LanguageModel.create()` and runs a "warmup" prompt (actual inference)
4. Clicks the "Model Status" tab
5. Polls for "Foundational model state: Ready"

This warm-up takes **11+ minutes on the ARM runner** for the first inference. The ONNX Runtime must compile the model graph, build adapter caches, and perform initial session setup. By running e2e first, the warm-up happens once, and the ONNX Runtime artifacts (`adapter_cache.bin`, `encoder_cache.bin`) are written to the persistent profile directory. Unit tests then benefit from the already-warm model.

**Why not a separate warm-up step?** The warm-up requires a persistent browser context that writes ONNX Runtime artifacts to the profile. The e2e fixture already manages this persistent context. Duplicating the warm-up in a separate step would require launching a browser, warming up, closing it, then launching again for e2e -- adding complexity and risking Chrome's ProcessSingleton lock issue on Windows (see Section 10.6).

**The global-setup.ts for Vitest provides additional warm-up** for unit tests. Before Vitest's browser launches, the global setup script opens the same persistent profile, navigates to the on-device-internals page, triggers `LanguageModel.create()`, runs a warmup prompt, and waits for the model to report "Ready". Because the e2e tests already wrote the ONNX Runtime artifacts to the profile, this Vitest warm-up is fast -- it is primarily confirming readiness, not compiling from scratch.

### 7.2 Why Unit Tests Run Even If E2E Fails

```yaml
- name: Run unit tests (${{ matrix.project }})
  if: ${{ !cancelled() && steps.bootstrap.outcome != 'failure' }}
```

The `!cancelled()` condition means unit tests run even if e2e tests fail. The only condition that blocks unit tests is a bootstrap failure (model could not be downloaded at all). This is because:

- E2e and unit tests validate different things (integration vs. component-level behavior)
- A UI navigation issue in e2e should not suppress unit test results
- The model is already warm from the e2e run, so unit tests are fast regardless
- Both test suites produce independent prompt responses for the job summary

## 8. Step Guards

### 8.1 `steps.bootstrap.outcome != 'failure'`

```yaml
if: steps.bootstrap.outcome != 'failure'      # e2e tests
if: ${{ !cancelled() && steps.bootstrap.outcome != 'failure' }}  # unit tests, summary, cache save
```

The bootstrap step is conditional (`if: steps.model-cache.outputs.cache-hit != 'true'`), so it may be **skipped** when the model cache is restored. When a step is skipped, its `outcome` is `'skipped'`, not `'failure'`. The guard `!= 'failure'` passes for both `'success'` and `'skipped'`, meaning tests run in both cases:

- **Cache hit:** bootstrap is skipped (outcome = `'skipped'`), tests run with the cached profile
- **Cache miss, bootstrap succeeds:** (outcome = `'success'`), tests run with the freshly bootstrapped profile
- **Cache miss, bootstrap fails:** (outcome = `'failure'`), tests are skipped because there is no usable model

This is more precise than `steps.bootstrap.outcome == 'success'`, which would incorrectly skip tests on cache hits.

### 8.2 `!cancelled()`

The default behavior in GitHub Actions is that steps do not run if any prior step fails. The `!cancelled()` condition overrides this: it runs the step as long as the job has not been explicitly cancelled (via the UI or by concurrency cancellation). Combined with `steps.bootstrap.outcome != 'failure'`, it means:

- E2e failed? Unit tests still run.
- User cancelled the workflow? Unit tests do not run.
- Bootstrap failed? Unit tests do not run.

### 8.3 `timeout-minutes: 45`

Both e2e and unit test steps have a 45-minute timeout. On-device model inference is slow (especially on CPU for Gemini Nano or first-inference for Phi-4 Mini on ARM). The tests include individual timeouts per assertion (up to 300 seconds for a single prompt and up to 600 seconds for the warm-up fixture), but the step-level timeout provides an outer safety net against hangs.

The bootstrap script has its own `--timeout 600000` (10 minutes) for the model download, passed as a CLI argument. This is separate from the step timeout.

### 8.4 `set -o pipefail` on Unit Tests

```yaml
shell: bash
run: |
  set -o pipefail
  ${{ matrix.xvfb }} npm exec nx -- test in-browser-ai-coding-agent 2>&1 | tee unit-test-output.log
```

The `set -o pipefail` is critical for correctness. Without it, the exit code of the pipeline is determined by the last command (`tee`), which always succeeds. A failing test suite would produce exit code 0 because `tee` successfully wrote the output to the file. With `pipefail`, the pipeline's exit code is the leftmost non-zero exit code, so a test failure correctly propagates as a CI failure.

## 9. GitHub Actions Summary

### 9.1 E2E Prompt Responses

The e2e test (`prompt.spec.ts`) writes directly to `GITHUB_STEP_SUMMARY`:

```typescript
if (process.env['GITHUB_STEP_SUMMARY']) {
  appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `### E2E Prompt Response\n\n**Prompt:** Hello, AI!\n\n**Response:** ${trimmed}\n\n`);
}
```

This is straightforward: the Playwright test runner executes in Node.js, so it has direct access to the filesystem and the `GITHUB_STEP_SUMMARY` environment variable. It appends markdown directly to the summary file.

### 9.2 Unit Test Prompt Responses

Unit tests run in a browser context (Vitest browser mode), so they cannot write to the filesystem directly. Instead, they use a three-stage pipeline:

**Stage 1: Structured console output.** The unit test (`language-model.service.spec.ts`) logs the prompt response in a parseable format with delimiter tags:

```typescript
console.log(`[unit] Prompt: "Hello, AI!"\n[unit-response]${response.trim()}[/unit-response]`);
```

**Stage 2: Capture via `tee`.** The CI step pipes the Vitest output through `tee` to capture it to a file while still streaming to stdout:

```bash
${{ matrix.xvfb }} npm exec nx -- test in-browser-ai-coding-agent 2>&1 | tee unit-test-output.log
```

The `2>&1` merges stderr into stdout so all output -- including Vitest's progress and browser console relay -- is captured.

**Stage 3: Node.js parser extracts responses.** A subsequent step reads `unit-test-output.log`, strips ANSI escape codes, and extracts `[unit]`/`[unit-response]` blocks with a regex:

```javascript
const re = /\[unit\] (.+?): "(.+?)"\n\[unit-response\]([\s\S]*?)\[\/unit-response\]/g;
```

The extracted prompt/response pairs are formatted as markdown and appended to `GITHUB_STEP_SUMMARY`.

**Why this roundabout approach?** Vitest's browser mode runs tests in a real browser. The test code executes inside Chrome/Edge, not in Node.js. It has no access to the filesystem or environment variables. The `console.log` output is relayed from the browser to Vitest's Node.js process and then to stdout, where `tee` captures it. The structured `[unit]`/`[unit-response]` tags provide a reliable parsing boundary that survives the browser-to-Node.js-to-stdout relay chain.

## 10. Model Warm-Up

### 10.1 Why Warm-Up Is Necessary

On-device AI models are not ready for inference immediately after download. The ONNX Runtime inference engine must:

1. Load the model weights into memory
2. Compile the model graph for the target hardware (CPU, GPU, or NPU)
3. Build adapter caches (`adapter_cache.bin`, `encoder_cache.bin`) for efficient execution
4. Perform initial session setup and optimization

The first `LanguageModel.create()` call after a fresh download can take **11+ minutes on the ARM runner**. Without warm-up, the first test that calls the API would either time out or take so long that it distorts test timing. The adapter/encoder cache files produced during first inference are what make subsequent inferences fast, which is why they are included in the model profile cache (Section 5.3).

### 10.2 Where Warm-Up Happens

Warm-up occurs at three points in the pipeline, each serving a different purpose:

1. **Bootstrap script** (cache miss only): Downloads the model and validates that `LanguageModel.create()` succeeds. This is the initial download, not a full warm-up -- the browser is closed afterward. However, some ONNX Runtime artifacts may be written to the profile during this step.

2. **E2E fixture warm-up** (`fixtures.ts`, worker-scoped): Before any e2e test runs, the fixture opens the persistent context, navigates to `chrome://on-device-internals` (or `edge://on-device-internals`), and:
   - Calls `LanguageModel.create()` and runs a "warmup" prompt (actual inference)
   - Clicks the "Model Status" tab
   - Polls for "Foundational model state: Ready"
   - If "Not Ready For Unknown Reason" is detected, refreshes the page and retries
   - Has a 20-minute timeout (`1_200_000` ms) to accommodate the 11+ minute first inference on ARM

3. **Vitest global-setup** (`global-setup.ts`): Before Vitest's browser mode launches, the global setup script performs the same warm-up sequence independently. This is necessary because Vitest runs in a separate browser process from the e2e tests. Since e2e ran first and wrote ONNX Runtime artifacts to the profile, this warm-up is fast -- it is primarily confirming readiness, not compiling from scratch.

### 10.3 The `chrome://on-device-internals` Monitoring Approach

The `chrome://on-device-internals` page (or `edge://on-device-internals` for Edge) is the browser's internal dashboard for on-device model management. It displays:

- Model download status
- Model compilation state
- "Foundational model state" indicator: `Not Ready`, `Not Ready For Unknown Reason`, or `Ready`

The warm-up code uses this page as a readiness probe:

```typescript
// Click "Model Status" tab
const modelStatusTab = page.getByRole('tab', { name: /Model Status/i }).or(page.locator('text=Model Status'));
await modelStatusTab.click();

// Poll for ready state
const readyEl = page.getByText(/Foundational model state:\s*Ready/i);
if (await readyEl.isVisible({ timeout: 30_000 }).catch(() => false)) {
  // Model is ready
}
```

This is more reliable than relying on `LanguageModel.availability()` alone, because `availability()` can return `'available'` while the model is still compiling for the target hardware. The on-device-internals page reflects the actual runtime state of the inference engine.

The `.or()` fallback (`page.locator('text=Model Status')`) handles rendering differences between Chrome and Edge, and between running in a container versus a bare runner, where the internal page may render with slightly different DOM structure.

### 10.4 The "Not Ready For Unknown Reason" Retry

The warm-up code specifically watches for "Not Ready For Unknown Reason":

```typescript
const notReady = page.getByText(/Not Ready For Unknown Reason/i);
if (await notReady.isVisible({ timeout: 1_000 }).catch(() => false)) {
  await page.reload();
  await modelStatusTab.click();
}
```

This state occurs when the model download completed but the inference engine failed to initialize on the first attempt. A page reload forces the engine to retry initialization, which usually succeeds. This is a known transient issue in both Chrome and Edge's on-device model systems -- the reload-and-retry pattern is a workaround for a race condition in the model loading pipeline.

### 10.5 The `internal_only_uis_enabled` Flag

Access to `chrome://on-device-internals` requires the `internal_only_uis_enabled` flag in `Local State`. Without it, navigating to the page shows an "Enable" button that must be clicked before the model status UI becomes visible. Clicking this button inside a Docker container crashes the browser (the button triggers a GPU code path that fails in the containerized environment), so the flag is seeded programmatically instead.

```typescript
state.internal_only_uis_enabled = true;
```

This flag is seeded in three places, each idempotent (skip if already set):

1. The bootstrap script (`seedLocalState`)
2. The e2e fixture (`enableInternalDebugPages`)
3. The Vitest global-setup (`enableInternalDebugPages`)

The redundancy is intentional: each entry point into the warm-up flow must ensure the flag is set, regardless of whether the previous entry point ran. On a cache hit, the bootstrap script is skipped, so the e2e fixture must seed the flag itself. The Vitest global-setup also seeds it because it runs in a separate process that may not share state with the e2e fixture.

### 10.6 ProcessSingleton Retry

Both the e2e fixture and the Vitest global-setup include a retry loop for `launchPersistentContext`:

```typescript
const maxAttempts = 5;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    context = await chromium.launchPersistentContext(...);
    break;
  } catch (error) {
    if (attempt === maxAttempts) throw error;
    await new Promise((r) => setTimeout(r, 2_000));
  }
}
```

Chrome uses a ProcessSingleton lock on the profile directory. On Windows, `chrome_crashpad_handler` (Chrome's crash reporter) may hold the profile lockfile for a few seconds after a previous browser instance closes. This causes `launchPersistentContext` to fail with a lock error. The retry loop waits 2 seconds between attempts, giving the crashpad handler time to release the lock.

## 11. Concurrency and Permissions

### 11.1 Concurrency Group

```yaml
concurrency:
  group: ci-${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

For pull requests, the concurrency group is the PR number. If a new push arrives on the same PR, the in-progress run is cancelled. This avoids wasting expensive runner time (especially the Windows ARM runner) on stale commits.

For pushes to `main`, the group is the commit SHA (unique per push), so main branch runs are never cancelled.

### 11.2 Permissions

```yaml
permissions:
  actions: read
  contents: read
  packages: read
```

Minimal permissions following the principle of least privilege. `packages: read` is needed to pull the GHCR container image. The CI workflow does not write packages -- that is the `build-playwright-images.yml` workflow's job (which has `packages: write`).

## 12. End-to-End Flow Summary

The following describes the complete flow for a single matrix entry (e.g., Chrome Beta on ubuntu-latest):

```
1. ghcr job resolves image name
        |
2. test job starts, pulls container image
        |
3. Checkout + setup-node (with npm download cache)
        |
4. npm ci (install dependencies)
        |
5. Restore AI model cache
   |                     |
   cache HIT             cache MISS
   (skip bootstrap)      |
   |                     6. Bootstrap: seed flags, launch browser,
   |                        download model, validate LanguageModel API
   |                     |
   +---------------------+
        |
7. E2E tests (Playwright)
   - Worker-scoped fixture: launch persistent context
   - Warm-up: navigate to on-device-internals, LanguageModel.create(),
     run "warmup" prompt, wait for "Ready" state (11+ min on ARM)
   - Run test specs (prompt.spec.ts, example.spec.ts)
   - Write e2e prompt response to GITHUB_STEP_SUMMARY
   - Close persistent context
        |
8. Unit tests (Vitest browser mode)
   - Global setup: open persistent profile, warm up model (fast -- already warm)
   - Launch browser with persistent context
   - Run spec files in-browser
   - Capture output via tee to unit-test-output.log (with pipefail)
        |
9. Parse unit-test-output.log, write prompt responses to GITHUB_STEP_SUMMARY
        |
10. Save AI model cache (post-test, with run-number key)
```
