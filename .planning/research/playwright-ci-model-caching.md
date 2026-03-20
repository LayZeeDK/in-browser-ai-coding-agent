# Research: Playwright CI with Persistent Browser Profiles for On-Device AI Models

**Researched:** 2026-03-20
**Overall confidence:** MEDIUM (some areas HIGH, critical gaps at LOW)

---

## 1. Playwright `userDataDir` and Persistent Browser Contexts

**Confidence: HIGH** (verified with official Playwright docs)

### How It Works

Playwright provides `browserType.launchPersistentContext(userDataDir, options)` which launches a browser using a persistent user data directory. This retains cookies, local storage, cached data, downloaded components, and other browser state across sessions.

```typescript
const context = await chromium.launchPersistentContext('/path/to/profile', {
  channel: 'chrome-beta', // or 'msedge-dev'
  headless: false,
  args: ['--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano'],
});
```

### Key API Details

- `launchPersistentContext` returns a `BrowserContext` directly (not a `Browser`), so there is only one context per browser instance.
- Closing the context automatically closes the browser.
- You **cannot** launch multiple instances with the same `userDataDir` simultaneously.
- Pass an empty string `''` for `userDataDir` to create a temporary directory.
- The `channel` option supports: `chrome`, `chrome-beta`, `chrome-dev`, `chrome-canary`, `msedge`, `msedge-beta`, `msedge-dev`, `msedge-canary`.
- The `args` option accepts Chromium command-line switches, including `--enable-features=...`.

### Custom Test Fixture Pattern

Since Playwright Test's built-in `context` fixture does not support persistent contexts, you must override it with a custom fixture:

```typescript
import { test as base, chromium, type BrowserContext } from '@playwright/test';

export const test = base.extend<{
  context: BrowserContext;
}>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('/path/to/profile', {
      channel: 'chrome-beta',
      headless: false,
      args: ['--enable-features=OptimizationGuideOnDeviceModel:compatible_on_device_performance_classes/*,PromptAPIForGeminiNano', '--disable-field-trial-config'],
      ignoreDefaultArgs: ['--disable-component-update'],
    });
    await use(context);
    await context.close();
  },
});
```

### Caveats

- **macOS headless/headful cookie corruption:** On macOS, switching between headless and headful modes with the same `userDataDir` can corrupt profile databases and leave lock files. This bug persists as of Playwright v1.51+.
- **Do NOT point to default Chrome profile:** Automating the default Chrome `User Data` directory is unsupported and may cause pages not to load.
- **Relative path bug (fixed):** In Playwright v1.50, relative `userDataDir` paths resolved relative to the browser executable. Fixed in v1.51.

### Sources

- [Playwright BrowserType API docs](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Playwright Chrome Extensions docs](https://playwright.dev/docs/chrome-extensions) (canonical fixture pattern)
- [Playwright Issue #7447](https://github.com/microsoft/playwright/issues/7447) (persistent context with test runner)

---

## 2. `actions/cache` for Browser Profiles

**Confidence: HIGH** (verified with official GitHub docs and changelog)

### Cache Size Limits

| Limit                  | Value       | Notes                                                                                                                                            |
| ---------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Per-repo default       | 10 GB       | Was the hard cap until Nov 2025                                                                                                                  |
| Per-repo (Nov 2025+)   | >10 GB      | [Announced](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/) but exact new limit unclear |
| Individual cache entry | 10 GB       | Single compressed archive limit (per `actions/cache` docs)                                                                                       |
| Eviction policy        | LRU, 7 days | Entries not accessed in 7 days are evicted; oldest entries evicted when limit exceeded                                                           |

### Feasibility for Browser Profiles

Gemini Nano model is ~2.4 GB; Phi-4-mini is ~3.6 GB. A Chrome/Edge user data directory with a downloaded model would be roughly 2-5 GB. This fits within the per-entry limit.

**Recommended cache key structure:**

```yaml
- uses: actions/cache@v4
  with:
    path: /tmp/ai-browser-profile
    key: browser-ai-profile-${{ matrix.browser }}-${{ hashFiles('package-lock.json') }}-v1
    restore-keys: |
      browser-ai-profile-${{ matrix.browser }}-
```

Use a manual version suffix (`v1`, `v2`) to invalidate when the browser version changes significantly or when the model version is updated. The browser version itself is not easily hashable since Playwright installs the latest channel build at runtime.

### Concerns

1. **Profile compatibility across browser versions:** Browser profile formats can change between versions. A cached Chrome Beta profile from one week may not work with the next week's Chrome Beta release. This could cause silent failures or crashes.
2. **Cache restoration speed:** A 2-5 GB cache takes 20-60 seconds to restore depending on compression and runner I/O.
3. **Cache pollution:** The user data directory contains many ephemeral files (crash dumps, GPU caches, logs) that inflate the cache unnecessarily. Consider caching only the model directory (e.g., `OptGuideOnDeviceModel/` subdirectory) rather than the entire profile.
4. **Selective caching alternative:** Instead of caching the entire `userDataDir`, cache just the model files and copy them into a fresh profile at test time. This avoids profile version mismatch issues.

### S3-Backed Alternative for Larger Caches

If the 10 GB limit is a constraint (e.g., caching both Chrome and Edge profiles), consider [runs-on/cache](https://runs-on.com/caching/s3-cache-for-github-actions/) which uses S3 as a backend with 300-500 MB/s throughput and no size limit.

### Sources

- [GitHub Actions cache docs](https://github.com/actions/cache)
- [GitHub Actions cache size >10 GB changelog](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/)
- [GitHub Actions limits reference](https://docs.github.com/en/actions/reference/limits)

---

## 3. Triggering Model Download in CI

**Confidence: LOW** -- This is the most uncertain and challenging area. No official CI documentation exists.

### Chrome (Gemini Nano)

**Required flags (command-line equivalents):**

```
--enable-features=OptimizationGuideOnDeviceModel:compatible_on_device_performance_classes/*,PromptAPIForGeminiNano
--disable-field-trial-config
--no-first-run
```

The `compatible_on_device_performance_classes/*` parameter is critical -- it bypasses hardware performance class checks that would otherwise prevent the model from loading on CI hardware.

**Additionally required:** You must NOT pass `--disable-component-update` (which Playwright passes by default). Use `ignoreDefaultArgs: ['--disable-component-update']` to allow Chrome's component updater to function.

**Model download process:**

1. Chrome checks if the "Optimization Guide On Device Model" component is registered.
2. If the feature flags are enabled, the component becomes available.
3. Calling `LanguageModel.create()` or visiting `chrome://components` and clicking "Check for update" triggers the download.
4. The model (~2.4 GB) downloads to the user data directory under an `OptGuideOnDeviceModel` subdirectory.

**Automation challenges:**

- There is **no documented CLI method** to pre-download the model without launching a browser and making API calls.
- The most viable automation approach (from [Puppeteer issue #13011](https://github.com/puppeteer/puppeteer/issues/13011)) is:
  1. Launch Chrome with the feature flags and a persistent `userDataDir`.
  2. Navigate to a page that calls `LanguageModel.create()` with a download monitor.
  3. Wait for the download to complete.
  4. Close and re-launch for actual tests.
- This is fragile and undocumented by Google. It may break between Chrome versions.

**Headless mode:** Chrome's new headless mode (the default since Chrome 132) claims "no limitations" compared to headed mode. However, no one has documented successfully downloading and running Gemini Nano in headless mode in CI. The model download may require the component updater to reach Google's servers, which should work in headless mode, but GPU inference in headless mode is unverified on CI hardware.

### Edge (Phi-4-mini)

**Required flag:**

- Enable `edge://flags/#prompt-api-for-phi-mini` (set to "Enabled").

**Command-line equivalent:** Likely `--enable-features=PromptAPIForPhiMini` but this is **not officially documented** for command-line use.

**Model download:** Same pattern as Chrome -- calling `LanguageModel.create()` triggers the download. Edge manages model caching, optimization, and updates automatically.

**Key difference:** Edge's Prompt API docs explicitly state it requires **Windows 10/11 or macOS 13.3+**. Linux is NOT listed as a supported OS for Edge's Phi-4-mini. This is a critical blocker for `ubuntu-latest` runners.

### Proposed CI Bootstrap Script (Speculative)

```typescript
// bootstrap-model.ts -- Run before tests to ensure model is downloaded
import { chromium } from 'playwright';

const context = await chromium.launchPersistentContext('/tmp/ai-profile', {
  channel: 'chrome-beta',
  headless: false, // May be required for model download
  args: ['--enable-features=OptimizationGuideOnDeviceModel:compatible_on_device_performance_classes/*,PromptAPIForGeminiNano', '--disable-field-trial-config', '--no-first-run'],
  ignoreDefaultArgs: ['--disable-component-update'],
});

const page = context.pages()[0] || (await context.newPage());

// Trigger model download
const availability = await page.evaluate(async () => {
  if (!('LanguageModel' in self)) return 'no-api';
  const avail = await (self as any).LanguageModel.availability();
  if (avail === 'available') return 'ready';

  // Trigger download
  const session = await (self as any).LanguageModel.create({
    monitor: (m: any) => {
      m.addEventListener('downloadprogress', (e: any) => {
        console.log(`Download: ${((e.loaded / e.total) * 100).toFixed(1)}%`);
      });
    },
  });
  session.destroy();
  return 'downloaded';
});

console.log(`Model status: ${availability}`);
await context.close();
```

**WARNING:** This script is speculative. It has NOT been verified in CI. The `LanguageModel` API may not be available in the page context if flags are not correctly propagated, and the download may require headed mode.

### Sources

- [Chrome AI get started docs](https://developer.chrome.com/docs/ai/get-started)
- [Puppeteer issue #13011 -- Loading Chrome components](https://github.com/puppeteer/puppeteer/issues/13011)
- [Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api)
- [Chromium discussion group -- First-time setup](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/8M6mL5uOnBQ)

---

## 4. Chrome Beta and Edge Dev on GitHub Actions `ubuntu-latest`

**Confidence: MEDIUM**

### Installation

Both Chrome Beta and Edge Dev can be installed via Playwright CLI on Ubuntu:

```bash
npx playwright install --with-deps chrome-beta
npx playwright install --with-deps msedge-dev
```

This installs the branded browsers at system-level locations. The `--with-deps` flag installs required system libraries (libnss3, libatk-bridge2.0, libdrm2, etc.).

**Playwright 1.57+ note:** Starting with Playwright 1.57, Playwright uses "Chrome for Testing" builds instead of Chromium for the default browser. This is relevant because Chrome for Testing may have different component availability than branded Chrome.

### Chrome Beta on Linux

- Chrome Beta is available for Linux and can be installed via Playwright.
- The LanguageModel/Prompt API flags should work since Chrome on Linux is a supported platform for Gemini Nano.
- **Headless mode:** Chrome's headless mode on Linux should support the feature flags. However, actual model inference requires either GPU (>4GB VRAM) or CPU (16GB RAM, 4+ cores). Standard runners do not meet the CPU requirement (only 7GB RAM).

### Edge Dev on Linux

- Edge Dev is available for Linux and can be installed via Playwright.
- **CRITICAL BLOCKER:** Edge's Phi-4-mini Prompt API documentation lists supported platforms as "Windows 10 or 11 and macOS 13.3 or later." **Linux is not listed.** This means Edge's built-in AI model may not be available on `ubuntu-latest` runners at all.
- This needs direct verification. The Edge Dev builds for Linux exist, but the on-device AI features may be gated to Windows/macOS only.

### Feature Flags in Headless Mode

Chrome's new headless mode (default since Chrome 112, simplified since Chrome 132) is described as having "no limitations" compared to headed mode. Feature flags passed via `--enable-features=...` should be respected. However:

1. GPU acceleration in headless mode on CI (no physical GPU) falls back to software rendering or is disabled.
2. The model may refuse to load if it detects no viable GPU and insufficient RAM for CPU-only inference.
3. No one has publicly documented running Gemini Nano in headless Linux CI.

### Sources

- [Playwright Browsers docs](https://playwright.dev/docs/browsers)
- [Chrome Headless mode docs](https://developer.chrome.com/docs/chromium/headless)
- [Edge Prompt API -- OS requirements](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api)

---

## 5. Hardware Requirements vs. GitHub Actions Runners

**Confidence: HIGH** (well-documented on both sides)

### Gemini Nano (Chrome) Requirements

| Resource      | Docs claim                                | Actual (verified)       | Source                                                             |
| ------------- | ----------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| Disk (free)   | 22 GB minimum                             | Pre-flight check only   | [Chrome AI docs](https://developer.chrome.com/docs/ai/get-started) |
| Model on disk | --                                        | **4,072 MiB (~4.0 GB)** | Verified locally (v3Nano 2025.06.30.1229)                          |
| GPU (if used) | >4 GB VRAM                                | --                      | Chrome AI docs                                                     |
| CPU-only mode | 16 GB RAM, 4+ CPU cores                   | --                      | Chrome AI docs                                                     |
| OS            | Windows 10/11, macOS 13+, Linux, ChromeOS | --                      | Chrome AI docs                                                     |

### Phi-4-mini (Edge) Requirements

| Resource      | Docs claim                                | Actual (verified)       | Source                                                                                           |
| ------------- | ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| Disk (free)   | 20 GB minimum                             | Pre-flight check only   | [Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) |
| Model on disk | --                                        | **2,397 MiB (~2.3 GB)** | Verified locally (Phi-4-mini-instruct 2026.2.19.1)                                               |
| GPU           | 5.5 GB VRAM                               | --                      | Edge Prompt API docs                                                                             |
| CPU-only mode | Not documented                            | --                      | --                                                                                               |
| OS            | **Windows 10/11, macOS 13.3+** (NO Linux) | --                      | Edge Prompt API docs                                                                             |

### GitHub Actions Runner Specs

| Runner                       | vCPUs | RAM   | Disk (free)                  | GPU                       | Cost                        |
| ---------------------------- | ----- | ----- | ---------------------------- | ------------------------- | --------------------------- |
| `ubuntu-latest` (standard)   | 2     | 7 GB  | ~14-20 GB (31+ with cleanup) | None                      | Free (2000 min/month)       |
| `ubuntu-slim`                | 1     | 5 GB  | ~14 GB                       | None                      | Cheaper                     |
| Larger runner (4-core)       | 4     | 16 GB | Configurable                 | None                      | Paid (Team/Enterprise)      |
| Larger runner (8-core)       | 8     | 32 GB | Configurable                 | None                      | Paid (Team/Enterprise)      |
| Larger runner (16-core)      | 16    | 64 GB | Configurable                 | None                      | Paid (Team/Enterprise)      |
| GPU runner (`gpu-t4-4-core`) | 4     | 28 GB | Configurable                 | Tesla T4 16GB VRAM        | $0.07/min (Team/Enterprise) |
| macOS XLarge (M2 Pro)        | 5     | 14 GB | 14 GB                        | 8-core Apple GPU (shared) | $0.16/min                   |

### Compatibility Matrix

| Browser + Model                 | `ubuntu-latest`                | 4-core larger             | 8-core larger            | GPU runner (T4)          | macOS M2 Pro                                            |
| ------------------------------- | ------------------------------ | ------------------------- | ------------------------ | ------------------------ | ------------------------------------------------------- |
| **Chrome + Gemini Nano (GPU)**  | NO (no GPU)                    | NO (no GPU)               | NO (no GPU)              | YES (16GB VRAM)          | MAYBE (shared GPU)                                      |
| **Chrome + Gemini Nano (CPU)**  | NO (7GB < 16GB RAM)            | MAYBE (16GB RAM, 4 cores) | YES (32GB RAM, 8 cores)  | YES (28GB RAM)           | NO (14GB < 16GB RAM)                                    |
| **Chrome + Gemini Nano (disk)** | RISKY (~20GB free, needs 22GB) | Configurable              | Configurable             | Configurable             | NO (14GB < 22GB)                                        |
| **Edge + Phi-4-mini**           | NO (Linux not supported)       | NO (Linux not supported)  | NO (Linux not supported) | NO (Linux not supported) | MAYBE (macOS supported, 5.5GB VRAM unclear with shared) |

### Key Findings

1. **Standard `ubuntu-latest` runners CANNOT run either model.** They lack GPU, have insufficient RAM for CPU-only Gemini Nano (7GB vs 16GB required), and have borderline disk space (need 22GB free, only ~14-20GB available).

2. **The minimum viable runner for Chrome + Gemini Nano (CPU mode) is a 4-core larger runner with 16GB RAM.** This meets the CPU-only requirements (16GB RAM, 4 cores). However, this requires a GitHub Team or Enterprise plan. Disk must be configured to provide 22GB+ free space.

3. **The GPU runner (`gpu-t4-4-core`) is the safest option for Chrome + Gemini Nano.** It has 16GB VRAM (exceeds >4GB requirement), 28GB RAM, and configurable disk. At $0.07/min, a 5-minute model download + test run costs ~$0.35 per run. With caching, subsequent runs could be 2-3 minutes (~$0.15-0.20).

4. **Edge + Phi-4-mini on Linux is NOT supported.** Edge's built-in AI is limited to Windows and macOS. This rules out all Linux-based GitHub Actions runners for Edge testing.

5. **Edge + Phi-4-mini on macOS M2 Pro runners is theoretically possible** but unverified. The M2 Pro has an 8-core GPU with shared 14GB RAM, and Edge requires 5.5GB VRAM. At $0.16/min, this is expensive and the shared memory architecture may not qualify as "5.5GB VRAM."

6. **Self-hosted runners** with adequate GPU/RAM are the most reliable option but require infrastructure management.

### Sources

- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub larger runners reference](https://docs.github.com/en/actions/reference/runners/larger-runners)
- [GitHub GPU runners changelog](https://github.blog/changelog/2024-07-08-github-actions-gpu-hosted-runners-are-now-generally-available/)
- [GitHub M2 Pro runners changelog](https://github.blog/changelog/2025-07-16-github-actions-now-offers-m2-pro-powered-hosted-runners-in-public-preview/)
- [Runner disk space discussion](https://github.com/actions/runner-images/discussions/9329)

---

## 6. Recommended Architecture for CI

### Option A: GPU Runner with Cached Profile (Recommended for Chrome)

```yaml
name: AI Model Tests
on: [push]
jobs:
  test-chrome-ai:
    runs-on: gpu-t4-4-core # Requires GitHub Team/Enterprise
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4

      - name: Restore AI model cache
        uses: actions/cache@v4
        id: ai-cache
        with:
          path: /tmp/ai-chrome-profile
          key: chrome-ai-profile-v1
          restore-keys: chrome-ai-profile-

      - name: Install Playwright + Chrome Beta
        run: |
          npm ci
          npx playwright install --with-deps chrome-beta

      - name: Bootstrap AI model (if not cached)
        if: steps.ai-cache.outputs.cache-hit != 'true'
        run: npx ts-node scripts/bootstrap-ai-model.ts

      - name: Run AI tests
        run: npx playwright test --project=chrome-ai
```

### Option B: Larger Runner CPU-Only (Budget Alternative for Chrome)

```yaml
jobs:
  test-chrome-ai:
    runs-on: ubuntu-latest-16-cores # 16GB RAM, 4 cores -- Team/Enterprise
    # Same steps as above, but model runs in CPU-only mode
    # Inference will be slower but functional
```

### Option C: Self-Hosted Runner (Most Control)

Use a self-hosted runner with a dedicated GPU. Pre-install the browser and pre-download the model. Cache the entire profile directory. This provides the most reliable and fastest experience but requires infrastructure management.

### Option D: Edge on macOS (Experimental, High Cost)

```yaml
jobs:
  test-edge-ai:
    runs-on: macos-latest-xlarge # M2 Pro -- $0.16/min
    steps:
      - name: Install Edge Dev
        run: npx playwright install --with-deps msedge-dev
      # ... rest of workflow
```

**WARNING:** This is entirely unverified. Edge's Phi-4-mini support on macOS in CI is undocumented.

---

## 7. Summary of Blockers and Risks

### Hard Blockers

| Blocker                                           | Impact                                                 | Mitigation                                               |
| ------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| Standard runners lack RAM/GPU for model inference | Cannot run tests on `ubuntu-latest`                    | Use larger or GPU runners (paid)                         |
| Edge Phi-4-mini does not support Linux            | Cannot test Edge AI on any Linux runner                | Use macOS runners or Windows self-hosted                 |
| No official CLI for model pre-download            | Model bootstrap is fragile, may break between versions | Cache aggressively, accept occasional bootstrap failures |

### Risks

| Risk                                                                     | Likelihood                    | Impact                              | Mitigation                                              |
| ------------------------------------------------------------------------ | ----------------------------- | ----------------------------------- | ------------------------------------------------------- |
| Cached profile incompatible with new browser version                     | MEDIUM                        | Tests fail silently or crash        | Version the cache key, rebuild periodically             |
| Model download fails in headless mode                                    | MEDIUM                        | Cannot bootstrap model in CI        | Use `headless: false` with `xvfb-run` on Linux          |
| Chrome removes/changes feature flags                                     | HIGH (these are experimental) | Tests stop working entirely         | Pin Chrome version, monitor Chrome release notes        |
| GitHub changes runner specs                                              | LOW                           | May need to adjust runner selection | Monitor runner docs                                     |
| Model inference too slow on CPU-only                                     | MEDIUM                        | Tests timeout                       | Increase test timeout, use GPU runners                  |
| `--disable-component-update` default in Playwright blocks model download | HIGH                          | Model never downloads               | Use `ignoreDefaultArgs: ['--disable-component-update']` |

### Xvfb for Headed Mode on Linux CI

If headless mode does not support model download/inference, use `xvfb-run` to run headed Chrome on a virtual display:

```yaml
- name: Run AI tests (headed via xvfb)
  run: xvfb-run --auto-servernum npx playwright test --project=chrome-ai
```

This is a common pattern for running headed browsers in Linux CI.

---

## 8. Open Questions Requiring Experimentation

These questions cannot be answered through documentation alone and require hands-on testing:

1. **Does `LanguageModel.create()` trigger model download in headless Chrome on Linux?** No documentation confirms or denies this.
2. **Does the `BypassPerfRequirement` flag actually bypass RAM checks in CI?** The flag exists but its behavior on 7GB/16GB RAM systems is untested.
3. **Can the model files be copied between profiles?** If so, we could cache just the model directory and inject it into fresh profiles, avoiding version mismatch issues.
4. **Does Chrome's component updater work when launched with `ignoreDefaultArgs: ['--disable-component-update']` via Playwright?** The Puppeteer issue suggests yes, but Playwright's behavior may differ.
5. **What is the actual inference performance on a 4-core/16GB CPU-only runner?** Is it fast enough to be useful in tests?
6. **Does Edge Dev on macOS M2 Pro runners actually support Phi-4-mini?** The hardware meets requirements but the runner environment may differ from a standard macOS install.
7. **Can `chrome://components` be automated via Playwright's CDP session?** This could provide a more reliable model download trigger than `LanguageModel.create()`.
