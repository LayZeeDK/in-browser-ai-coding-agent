# External Integrations

**Analysis Date:** 2026-03-22

## APIs & External Services

**W3C LanguageModel API (Browser-Native):**

- Global `LanguageModel` object - Exposes on-device AI inference
  - Accessed via `LanguageModel.availability()`, `LanguageModel.create()`, `session.prompt()`
  - Type definitions: `@types/dom-chromium-ai` ^0.0.15
  - Implementation: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`
  - No API key or external service required - runs entirely in browser

**GitHub Container Registry (GHCR):**

- Image registry for Docker build artifacts
  - Repository: `ghcr.io/layzeedk/in-browser-ai-coding-agent/playwright-chrome-beta:latest`
  - Usage: CI caches pre-built Docker images with Chrome Beta + system dependencies
  - Build workflow: `.github/workflows/build-playwright-images.yml`

## Data Storage

**No External Database:**

- Application is browser-only; no backend API or database
- All data ephemeral to the browser session
- AI model profiles cached locally in CI via GitHub Actions cache

**Local Browser Profile Caching (GitHub Actions):**

- **Cache path:** `.playwright-profiles/{chrome-beta,msedge-dev}`
- **Size:** ~500 MB - 2 GB per profile (compressed)
- **Contents:**
  - Model weights: ~4 GB (Gemini Nano) or ~4.93 GB (Phi-4 Mini)
  - ONNX Runtime DLLs (Edge only): `onnxruntime.dll`, `onnxruntime-genai.dll`
  - Inference artifacts: `adapter_cache.bin`, `encoder_cache.bin` (compiled execution caches)
  - Chrome/Edge configuration: `Local State` JSON with flags
- **Key strategy:** Rolling cache with run number suffix (`cache-key-run{github.run_number}`)
- **Restore strategy:** Prefix matching finds latest cached profile across runs

**File Storage:**

- None - application is browser-only, no server-side file uploads or storage

**Caching:**

- None - application is browser-only, no server-side caching service

## Authentication & Identity

**Auth Provider:**

- None - application is browser-only, no user authentication
- No API keys, OAuth, or credential management required

## Monitoring & Observability

**Error Tracking:**

- None - standard error logging via browser console
- Playwright test output captures errors in CI job logs
- GitHub Actions step summary captures prompt responses and test output

**Logs:**

- **Application:** Browser console (stderr/stdout captured by Playwright)
- **CI:** GitHub Actions workflow logs and step summaries
  - E2E prompt responses written to `GITHUB_STEP_SUMMARY` via `appendFileSync`
  - Unit test output captured via `tee` to `unit-test-output.log`, parsed for responses
  - Bootstrap script logs system resources (RAM, disk) on crash

**Diagnostics:**

- `scripts/bootstrap-ai-model.mjs` logs:
  - System resources before/after browser launch
  - Model availability status
  - Download progress
  - Browser crash events via connection listeners
- E2E fixture logs model readiness status from `chrome://on-device-internals` or `edge://on-device-internals`

## CI/CD & Deployment

**Hosting:**

- GitHub Pages (no hosting required - application is browser-only, distributes as static HTML/JS)
- Built and served via Nx's Angular build tooling

**CI Pipeline:**

- **Platform:** GitHub Actions
- **Workflow file:** `.github/workflows/ci.yml`
- **Triggered on:** Push to main, all pull requests
- **Job matrix:**
  - `chrome-beta` on `ubuntu-latest` (Docker container)
  - `msedge-dev` on `windows-11-arm` (bare runner)

**CI Jobs:**

| Job                    | Runs On                                | Purpose                                      | Caches                          |
| ---------------------- | -------------------------------------- | -------------------------------------------- | ------------------------------- |
| `ghcr`                 | ubuntu-latest                          | Resolve container image name for matrix      | N/A                             |
| `format`               | ubuntu-latest                          | PR-only: check code formatting with Prettier | npm download cache              |
| `lint-typecheck-build` | ubuntu-latest                          | Lint, TypeScript check, production build     | npm download cache              |
| `test`                 | Matrix (ubuntu-latest, windows-11-arm) | E2E + unit tests with real AI models         | node_modules, AI model profiles |

**CI Step Sequence:**

1. Checkout code (treeless clone, fetch-depth 0 for Nx affected detection)
2. `actions/setup-node` - Load Node.js, optionally cache npm downloads
3. `npm ci` - Install dependencies (skipped on Windows ARM if node_modules cached)
4. `npx playwright install {browser}` - Install browser (Windows ARM only)
5. Restore AI model profile cache
6. `bootstrap-ai-model.mjs` - Download model if cache miss
7. `nx e2e in-browser-ai-coding-agent-e2e` - Run Playwright e2e tests
8. `nx test in-browser-ai-coding-agent` - Run Vitest unit tests in browser mode
9. Parse unit test output and write to GitHub Actions job summary
10. Save AI model profile cache with post-test artifacts

**Docker Image Building:**

- **Workflow:** `.github/workflows/build-playwright-images.yml`
- **Triggered on:** Changes to `.node-version`, `package-lock.json`, `.github/docker/Dockerfile`
- **Build strategy:**
  - Multi-stage Dockerfile: `base` (common deps) → `chrome-beta` (final stage)
  - GitHub Actions cache for Docker layer caching (type=gha)
  - Pushes to GHCR with semver + `latest` tags
- **Dockerfile:** `.github/docker/Dockerfile`
  - Base: ubuntu:24.04
  - Installs: Node.js (NodeSource), xvfb, Playwright system deps, browsers

## Environment Configuration

**Required env vars:**

- **CI-only (GitHub Actions):**
  - `CI` - Set by GitHub Actions (checked to enable retries, CI reporters)
  - `GITHUB_STEP_SUMMARY` - Path to workflow summary file (set by GitHub Actions)
  - `GITHUB_REPOSITORY` - Repository name (set by GitHub Actions)
  - `E2E_PORT` - Dev server port (default: 4200)
  - `BASE_URL` - E2E base URL (default: `http://localhost:{E2E_PORT}`)
  - `CI_VITEST_BROWSER_INSTANCE` - Browser instance name for Vitest filtering (`chrome-gemini-nano` or `edge-phi4-mini`)

- **No `.env` files needed** - application is browser-only with no backend configuration

**Secrets location:**

- No secrets required - application has no API keys, auth tokens, or credentials
- GHCR push credentials handled via standard GitHub Actions OIDC token

## Feature Flags & Browser Configuration

**Chrome Beta:**

- **Feature flags** (seeded in `Local State`):
  - `optimization-guide-on-device-model@1` - Enable on-device model system (not @2 due to BypassPerfRequirement bug)
  - `prompt-api-for-gemini-nano@1` - Expose LanguageModel API

- **Launch args:**
  - `--no-first-run` - Skip first-run experience
  - `--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano` - Feature gates
  - Custom `--disable-features` (minus OptimizationHints) - Preserve Playwright's other overrides

- **Playwright args to remove:**
  - `--disable-features=...OptimizationHints` - Blocks model system
  - `--disable-field-trial-config` - Blocks eligibility checks
  - `--disable-background-networking` - Blocks model registration
  - `--disable-component-update` - Blocks model component loading

**Edge Dev:**

- **Feature flags** (seeded in `Local State`):
  - `edge-llm-prompt-api-for-phi-mini@1` - Enable Phi-4 Mini via LanguageModel API
  - `edge-llm-on-device-model-performance-param@3` - Configure performance parameters

- **Launch args:**
  - `--no-first-run` - Skip first-run experience
  - `--enable-features=AIPromptAPI` - Expose LanguageModel API
  - `--disable-features=OnDeviceModelPerformanceParams` - Use performance param setting instead
  - Custom `--disable-features` (minus OptimizationHints)

**Internal Debug Pages:**

- **Flag:** `internal_only_uis_enabled` in `Local State`
- **Purpose:** Enables access to `chrome://on-device-internals` or `edge://on-device-internals` without clicking enable button
- **Seeded in three places:** Bootstrap script, e2e fixture, Vitest global-setup (redundancy)

## Webhooks & Callbacks

**Incoming:**

- None - application is browser-only

**Outgoing:**

- None - application is browser-only

**Model Download Progress Monitoring:**

- **Implementation:** `LanguageModel.create()` accepts optional monitor callback
- **Usage:** `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`
- **Event:** `downloadprogress` - Reports `event.loaded` and `event.total` bytes

## Browser-Native APIs Used

**W3C LanguageModel API:**

- `LanguageModel.availability()` - Returns availability status (available, downloadable, downloading, unavailable)
- `LanguageModel.create(options)` - Creates an inference session, triggers model download if needed
- `LanguageModel.create({ monitor })` - Registers download progress monitor
- `monitor.addEventListener('downloadprogress', callback)` - Fires during model download
- `session.prompt(text)` - Runs inference and returns generated text
- `session.destroy()` - Releases model resources

**Chrome-Specific (Optimization Guide):**

- `chrome://gpu` - GPU capability diagnostics (used in bootstrap script)
- `chrome://on-device-internals` - Model status dashboard with download progress and readiness state
- `chrome://flags` - Feature gate interface (configured via Local State instead)

**Edge-Specific (LLM Service):**

- `edge://gpu` - GPU capability diagnostics
- `edge://on-device-internals` - Model status dashboard with download progress and readiness state
- `edge://flags` - Feature gate interface

## Model Inference Architecture

**Chrome Beta + Gemini Nano:**

```
LanguageModel API
    ↓
Chrome Optimization Guide (C++)
    ↓
LiteRT-LM (inference pipeline)
    ↓
LiteRT/TFLite (model execution)
    ↓
XNNPACK CPU (no GPU available on ubuntu-latest)
```

**Edge Dev + Phi-4 Mini:**

```
LanguageModel API
    ↓
Edge LLM Service (proprietary)
    ↓
ONNX Runtime (onnxruntime.dll + onnxruntime-genai.dll)
    ↓
CPU Execution Provider (DirectML unavailable on windows-11-arm)
```

## Third-Party Service Dependencies

**Playwright (Browser Automation):**

- Manages browser lifecycle (launch, context, page)
- Intercepts network traffic and provides assertions
- Provides persistent context support for profile caching
- Version pinned to 1.36.0 for stability

**Nx (Build Orchestration):**

- Dependency task scheduling
- Incremental builds and caching
- Monorepo-aware configuration
- Task output streaming

**Angular Build Tools:**

- Compilation and bundling
- Ahead-of-time (AOT) compilation
- CSS/HTML preprocessing
- Production optimization

**GitHub Actions:**

- CI workflow execution
- GitHub Container Registry (GHCR) integration
- Cache management with immutable keys and prefix matching
- Concurrency control for PR workflows

---

_Integration audit: 2026-03-22_
