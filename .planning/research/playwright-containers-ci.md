# Research: Playwright Container Images and GitHub Actions for Browser AI Testing

**Researched:** 2026-03-20
**Overall confidence:** MEDIUM-HIGH (Docker/CI well-documented; AI API testing in CI is uncharted territory)

---

## 1. Playwright Docker Images (mcr.microsoft.com/playwright)

### What Is Included

The official image (`mcr.microsoft.com/playwright:v1.58.2-noble`) is based on Ubuntu 24.04 LTS with Node.js 22 LTS. It includes:

| Component                    | Included | Notes                                    |
| ---------------------------- | -------- | ---------------------------------------- |
| Chromium (open-source)       | Yes      | Bundled by Playwright, patched build     |
| Firefox                      | Yes      | Patched version maintained by Playwright |
| WebKit                       | Yes      | Derived from latest WebKit sources       |
| Browser system dependencies  | Yes      | All OS-level libs for rendering          |
| Xvfb                         | Yes      | Virtual framebuffer for headed mode      |
| Google Chrome (any channel)  | **No**   | Must install separately                  |
| Microsoft Edge (any channel) | **No**   | Must install separately                  |
| Playwright npm package       | **No**   | Must install in your project             |

**Confidence:** HIGH -- verified via [official Playwright Docker docs](https://playwright.dev/docs/docker) and [Microsoft Artifact Registry](https://mcr.microsoft.com/en-us/product/playwright/about).

### Available Image Tags

- `:v1.58.2-noble` -- Ubuntu 24.04 (recommended)
- `:v1.58.2-jammy` -- Ubuntu 22.04
- Language variants: `/python`, `/dotnet` suffixes

**Critical rule:** Always pin to the exact Playwright version matching your project. Mismatched versions cause browser executable lookup failures.

### Installing Branded Browsers Inside the Container

```bash
# Inside Docker or CI step
npx playwright install chrome-beta
npx playwright install msedge-dev
npx playwright install chrome        # stable
npx playwright install msedge        # stable
```

These install to default OS locations. The `--with-deps` flag adds OS dependencies if not already present.

### Recommended Launch Flags

- `--ipc=host` -- prevents Chromium OOM crashes in containers
- `--init` -- proper zombie process reaping

### Sources

- [Playwright Docker docs](https://playwright.dev/docs/docker)
- [Docker Hub: microsoft/playwright](https://hub.docker.com/r/microsoft/playwright)
- [Playwright Browsers docs](https://playwright.dev/docs/browsers)

---

## 2. Playwright GitHub Actions Integration

### No Official Playwright GitHub Action

There is **no dedicated Playwright GitHub Action** (e.g., `microsoft/playwright-action`). The recommended approach uses standard Node.js setup steps:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v6
        with:
          node-version: lts/*
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx playwright test
      - uses: actions/upload-artifact@v5
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: playwright-report/
```

### Using the Docker Image in GitHub Actions

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.58.2-noble
      options: --user 1001
    steps:
      - uses: actions/checkout@v5
      - run: npm ci
      - run: npx playwright test
```

When using the container image, browser system dependencies are already present. You still need `npx playwright install` if your Playwright version differs from the image.

### Branded Channels in CI

To test against Chrome Beta or Edge Dev in GitHub Actions:

```yaml
- run: npx playwright install --with-deps chrome-beta msedge-dev
- run: npx playwright test --project=chrome-beta --project=msedge-dev
```

With a matching `playwright.config.ts`:

```typescript
export default defineConfig({
  projects: [
    {
      name: 'chrome-beta',
      use: { channel: 'chrome-beta' },
    },
    {
      name: 'msedge-dev',
      use: { channel: 'msedge-dev' },
    },
  ],
});
```

**Confidence:** HIGH -- verified via [Playwright CI docs](https://playwright.dev/docs/ci) and [Playwright Browsers docs](https://playwright.dev/docs/browsers).

### Sources

- [Playwright CI docs](https://playwright.dev/docs/ci)
- [Playwright Browsers docs](https://playwright.dev/docs/browsers)

---

## 3. Custom Docker Image for CI

### Building a Custom Image with Branded Browsers

```dockerfile
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Install branded browsers
RUN npx playwright install --with-deps chrome-beta msedge-dev

# Pre-download Gemini Nano model (see Section 5 for caveats)
# This is speculative -- the model download requires Chrome to be running
# and may require user activation. See "Critical Blockers" below.
```

### Using in GitHub Actions

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/your-org/playwright-ai:latest
      options: --user 1001 --ipc=host
    steps:
      - uses: actions/checkout@v5
      - run: npm ci
      - run: npx playwright test
```

### Community Alternative: JacobLinCool/playwright-docker

The [JacobLinCool/playwright-docker](https://github.com/JacobLinCool/playwright-docker) project provides pre-built images with branded browsers:

- `jacoblincool/playwright:chrome` -- Google Chrome stable
- `jacoblincool/playwright:msedge` -- Microsoft Edge stable
- `jacoblincool/playwright:all` -- All browsers including Chrome and Edge
- Available for both x64 and ARM64

These do NOT include beta/dev channels. You would still need a custom image for chrome-beta and msedge-dev.

### Pre-populated User Profile Strategy

For AI API testing, you could bake a Chrome user profile into the Docker image:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.58.2-noble

RUN npx playwright install --with-deps chrome-beta

# Copy a pre-configured user data directory with:
# - Feature flags enabled
# - Model already downloaded (if possible)
COPY chrome-profile/ /opt/chrome-profile/
```

Then use `launchPersistentContext` in tests:

```typescript
const context = await chromium.launchPersistentContext('/opt/chrome-profile', {
  channel: 'chrome-beta',
  args: ['--enable-features=PromptAPIForGeminiNano,OptimizationGuideOnDeviceModel'],
});
```

**Confidence:** MEDIUM -- the Docker image build is straightforward, but pre-populating the AI model in a profile is unverified and likely blocked by Chrome's download mechanism (see Section 5).

### Sources

- [JacobLinCool/playwright-docker](https://github.com/JacobLinCool/playwright-docker)
- [Playwright Docker docs](https://playwright.dev/docs/docker)

---

## 4. GitHub Actions Larger Runners and GPU Runners

### Standard Runners (Free for Public Repos)

| Runner             | vCPUs | RAM   | Storage   | Cost/min |
| ------------------ | ----- | ----- | --------- | -------- |
| Linux 2-core x64   | 2     | ~7 GB | 14 GB SSD | $0.006   |
| Linux 2-core arm64 | 2     | ~7 GB | 14 GB SSD | $0.005   |

Public repos on GitHub get the 4-vCPU runners by default now (since early 2024).

### Larger Runners (Team/Enterprise Plans Only)

| Runner  | vCPUs | RAM    | Storage  | Cost/min (Linux) |
| ------- | ----- | ------ | -------- | ---------------- |
| 4-core  | 4     | 16 GB  | 150 GB   | $0.012           |
| 8-core  | 8     | 32 GB  | 300 GB   | $0.022           |
| 16-core | 16    | 64 GB  | 600 GB   | $0.042           |
| 32-core | 32    | 128 GB | 840 GB   | $0.082           |
| 64-core | 64    | 256 GB | 2,040 GB | $0.162           |

### GPU Runners

| Runner             | vCPUs | RAM   | GPU       | VRAM  | Cost/min |
| ------------------ | ----- | ----- | --------- | ----- | -------- |
| Linux GPU 4-core   | 4     | 28 GB | NVIDIA T4 | 16 GB | $0.052   |
| Windows GPU 4-core | 4     | 28 GB | NVIDIA T4 | 16 GB | $0.102   |

**Key constraints:**

- GPU runners require Team or Enterprise Cloud plan
- Not available for free/public repos
- Uses NVIDIA partner image (not standard GitHub runner image) -- `gh` CLI not pre-installed
- T4 GPU is compute capability 7.5 (Turing architecture, 2018)

### ARM Runners

| Runner        | vCPUs | Cost/min (Linux) |
| ------------- | ----- | ---------------- |
| 2-core arm64  | 2     | $0.005           |
| 4-core arm64  | 4     | $0.008           |
| 8-core arm64  | 8     | $0.014           |
| 16-core arm64 | 16    | $0.028           |
| 32-core arm64 | 32    | $0.054           |
| 64-core arm64 | 64    | $0.098           |

### macOS Runners

| Runner            | Chip   | Cost/min |
| ----------------- | ------ | -------- |
| 3-core (standard) | M1     | $0.062   |
| 5-core M2 Pro     | M2 Pro | $0.102   |

### Feasibility for On-Device AI Model Inference

**Can GitHub GPU runners run Gemini Nano?** Unlikely to be useful:

1. Gemini Nano runs inside Chrome via WebGPU/WebAssembly, not as a standalone CUDA workload
2. The T4 GPU may not be exposed to Chrome's WebGPU inside a container/VM
3. The NVIDIA partner image is not designed for browser testing
4. Chrome's Gemini Nano requires specific Chrome flags and model download, which is tied to the browser profile

**Better approach:** Use a larger runner (8-core, 32 GB RAM) for CPU-based inference or mock the API. The extra RAM helps with browser process overhead.

**Confidence:** HIGH for pricing/specs (from [GitHub docs](https://docs.github.com/en/billing/reference/actions-runner-pricing)), LOW for GPU+Chrome WebGPU compatibility (no evidence found).

### Sources

- [GitHub Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- [Larger runners reference](https://docs.github.com/en/actions/reference/runners/larger-runners)
- [GPU runners GA announcement](https://github.blog/changelog/2024-07-08-github-actions-gpu-hosted-runners-are-now-generally-available/)

---

## 5. Alternative CI Approaches for Browser AI API Testing

### Critical Blockers for Testing the Prompt API in CI

The Chrome LanguageModel / Prompt API has several characteristics that make CI testing extremely challenging:

1. **User activation requirement:** `LanguageModel.create()` requires a "sticky activation" event (click, keypress, etc.) if the model needs downloading. In CI, there is no real user.
2. **Model download:** Gemini Nano is ~1.5-2.4 GB and downloads automatically on first use, but requires user interaction to trigger.
3. **Chrome flags required:** `#prompt-api-for-gemini-nano` and `#optimization-guide-on-device-model` must be enabled.
4. **No headless support confirmed:** No documentation confirms the Prompt API works in headless Chrome.
5. **Incognito/Guest mode not supported:** The API does not work in incognito or guest profiles.

### Approach A: Mock/Polyfill the LanguageModel API (RECOMMENDED for CI)

Two existing polyfill projects can replace the real API in CI:

**1. chrome-ai-polyfill** ([GitHub](https://github.com/Explosion-Scratch/chrome-ai-polyfill))

- Tampermonkey userscript that injects `window.ai.languageModel`
- Routes requests to OpenRouter or any OpenAI-compatible endpoint
- Supports `availability()`, `create()`, `prompt()`, `promptStreaming()`
- Requires an API key (cost per request)

**2. window.ai-Polyfill** ([GitHub](https://github.com/MiguelsPizza/window.ai-Polyfill))

- Chrome extension matching the official Prompt API spec
- Supports external, proxied, and local model backends
- More complete spec coverage

**Custom mock approach (most practical for CI):**

```typescript
// In your test setup or via page.addInitScript()
await page.addInitScript(() => {
  // Mock the LanguageModel API
  (globalThis as any).LanguageModel = {
    availability: async () => 'available',
    create: async (options?: { systemPrompt?: string }) => ({
      prompt: async (input: string) => `Mock response to: ${input}`,
      promptStreaming: async function* (input: string) {
        yield `Mock streaming response to: ${input}`;
      },
      countPromptTokens: async (input: string) => input.split(' ').length,
      tokensLeft: 4096,
      destroy: () => {},
    }),
  };
});
```

This is the most reliable CI approach because it:

- Has zero infrastructure requirements
- Works in any browser/environment
- Is deterministic (no model variability)
- Tests your application logic, not the AI model

**Confidence:** HIGH for the mock approach. MEDIUM for the polyfill projects (they exist but are community-maintained).

### Approach B: Chrome Feature Flags via Playwright Launch Args

You can pass Chrome flags as Playwright launch arguments:

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    {
      name: 'chrome-ai',
      use: {
        channel: 'chrome-beta', // Must use branded Chrome, not Chromium
        launchOptions: {
          args: ['--enable-features=PromptAPIForGeminiNano', '--enable-features=OptimizationGuideOnDeviceModel:BypassPerfRequirement/true'],
        },
      },
    },
  ],
});
```

**Caveats:**

- Untested whether these `--enable-features` flags actually enable the Prompt API (chrome://flags UI toggles may work differently than CLI flags)
- The model still needs to be downloaded before first use
- The `BypassPerfRequirement` parameter may help skip hardware checks but does not skip the download

**Confidence:** LOW -- no verified examples of this working in CI exist.

### Approach C: Pre-populated User Data Directory

Use `launchPersistentContext` with a pre-prepared Chrome profile:

1. Manually set up Chrome with flags enabled and model downloaded
2. Copy the profile's `Local State`, `Preferences`, and model cache files
3. Bundle into Docker image or CI artifact
4. Use in Playwright tests via `launchPersistentContext`

```typescript
const context = await chromium.launchPersistentContext('/path/to/profile', {
  channel: 'chrome-beta',
});
```

**Key challenges:**

- Profile paths differ between OS (Linux in CI vs Windows locally)
- Model files are large (~2.4 GB) and version-specific
- Only one browser instance per user data dir (no parallelism)
- Profile format may change between Chrome versions

**Confidence:** LOW-MEDIUM -- technically possible but fragile and unverified for AI model persistence.

### Approach D: Chrome for Testing (CfT) Project

[Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/) provides deterministic Chrome binaries for CI:

- Available for Stable, Beta, Dev, and Canary channels
- No auto-update (ideal for CI reproducibility)
- Download via `npx @puppeteer/browsers install chrome@beta`
- JSON API for latest versions: `latest-versions-per-milestone-with-downloads.json`

**Relationship to Playwright:** Playwright uses its own bundled Chromium, NOT Chrome for Testing. When you specify `channel: 'chrome-beta'`, Playwright downloads and installs Google Chrome Beta via its own mechanism (`npx playwright install chrome-beta`), not via the CfT project.

CfT binaries are useful if you want to manage Chrome versions independently of Playwright, but the Playwright install command is simpler for most CI setups.

**Confidence:** HIGH -- well-documented project by Google Chrome Labs.

### Approach E: Browser Extension to Provide the API

You could load a Chrome extension in Playwright that polyfills `window.ai.languageModel`:

```typescript
const context = await chromium.launchPersistentContext('/tmp/test-profile', {
  channel: 'chrome-beta',
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
```

**Important:** Side-loading extensions requires using Chromium (bundled with Playwright), NOT branded Chrome/Edge. Google and Microsoft removed the CLI flags for extension side-loading in branded browsers. This creates a conflict: you need branded Chrome for the AI APIs but Chromium for extension loading.

**Workaround:** Use the `window.ai-Polyfill` extension with Playwright's bundled Chromium. This gives you the API surface without needing real Gemini Nano, but it routes to an external model backend.

**Confidence:** MEDIUM -- extension loading in Playwright is documented, but the branded Chrome limitation is a real constraint.

### Sources

- [Chrome Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api)
- [Chrome Built-in AI Getting Started](https://developer.chrome.com/docs/ai/get-started)
- [Prompt API Origin Trial blog](https://developer.chrome.com/blog/prompt-api-origin-trial)
- [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/)
- [chrome-ai-polyfill](https://github.com/Explosion-Scratch/chrome-ai-polyfill)
- [window.ai-Polyfill](https://github.com/MiguelsPizza/window.ai-Polyfill)
- [Playwright Chrome Extensions docs](https://playwright.dev/docs/chrome-extensions)
- [webmachinelearning/prompt-api spec](https://github.com/webmachinelearning/prompt-api)

---

## 6. Recommended CI Strategy

Based on all findings, here is the recommended tiered approach:

### Tier 1: Unit/Integration Tests (Default CI -- every PR)

**Mock the LanguageModel API** using `page.addInitScript()` or a test helper that injects a fake `LanguageModel` global. This tests your application's integration with the API contract without needing a real model.

- Runner: Standard GitHub Actions runner (free for public repos)
- Browser: Playwright's bundled Chromium (fastest, no install needed)
- Cost: $0
- Reliability: Very high (deterministic)

### Tier 2: Branded Browser Compatibility (Scheduled -- nightly or weekly)

**Test against Chrome Beta and Edge Dev** with the mocked API to catch browser-specific regressions.

```yaml
jobs:
  branded-browsers:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.58.2-noble
      options: --user 1001 --ipc=host
    steps:
      - uses: actions/checkout@v5
      - run: npm ci
      - run: npx playwright install --with-deps chrome-beta msedge-dev
      - run: npx playwright test --project=chrome-beta --project=msedge-dev
```

- Runner: Standard or 4-core GitHub Actions runner
- Browser: Chrome Beta + Edge Dev (real branded browsers)
- Cost: ~$0.012/min for 4-core runner
- Reliability: High (mocked API, real browser rendering)

### Tier 3: Real AI Model Tests (Manual trigger or release gate)

**Test with actual Gemini Nano** on a pre-configured self-hosted runner or a larger GitHub-hosted runner with a custom Docker image that has the model pre-downloaded.

This tier is aspirational -- no verified path exists for running Gemini Nano in CI today. The practical alternative is:

- Use a polyfill extension routing to an OpenAI-compatible API (e.g., OpenRouter)
- This tests real LLM behavior but not the exact Gemini Nano model

- Runner: 8-core larger runner (32 GB RAM) or self-hosted
- Browser: Chrome Beta with feature flags
- Cost: ~$0.022/min for 8-core, plus API costs for the LLM backend
- Reliability: Medium (depends on external API availability)

### Summary Decision Matrix

| Approach                      | CI Feasibility | Tests Real AI? | Cost     | Reliability |
| ----------------------------- | -------------- | -------------- | -------- | ----------- |
| Mock API via addInitScript    | Excellent      | No             | Free     | Very High   |
| Polyfill extension + LLM API  | Good           | Partially      | Low      | High        |
| Pre-populated profile + flags | Poor           | Maybe          | Medium   | Low         |
| GPU runner + real Gemini Nano | Unknown        | Yes            | High     | Unknown     |
| Self-hosted with real Chrome  | Possible       | Yes            | Variable | Medium      |

---

## 7. Open Questions and Gaps

1. **Does `--enable-features=PromptAPIForGeminiNano` work as a CLI flag?** Chrome flags set via `chrome://flags` UI persist in the profile's Local State file. The `--enable-features` CLI switch may or may not map to the same feature. This needs empirical testing.

2. **Can Gemini Nano run in headless Chrome?** No documentation confirms or denies this. WebGPU support in headless mode is limited. The model may fall back to WebAssembly/CPU, but performance would be poor.

3. **Can the model be pre-downloaded programmatically?** The download is triggered by `chrome://components` or by calling `LanguageModel.create()` with user activation. No CLI or API for pre-downloading exists in documentation.

4. **WebGPU in Docker containers:** WebGPU requires GPU access. Docker containers on GitHub Actions standard runners have no GPU. Even GPU runners expose NVIDIA CUDA, not necessarily the GPU to Chrome's WebGPU.

5. **Origin trial tokens in CI:** The Prompt API origin trial (Chrome 131-136) required tokens. The API is now shipping in Chrome 138+ behind flags. For CI, flags are more relevant than origin trials.

6. **Model version pinning:** Gemini Nano updates are tied to Chrome updates. There is no way to pin a specific model version for reproducible test results.
