# External Integrations

**Analysis Date:** 2026-03-20

## APIs & External Services

**On-Device AI Models:**

- Chrome Gemini Nano (via LanguageModel API)
  - Service: Chrome's on-device AI platform
  - SDK/Client: Browser native LanguageModel API
  - Configuration: Enabled via `--enable-features=PromptAPIForGeminiNano` in Chrome Beta
  - Model availability check: `LanguageModel.availability()`
  - Model session creation: `LanguageModel.create({ monitor })`

- Microsoft Edge Phi-4 Mini (via LanguageModel API)
  - Service: Edge's on-device AI platform
  - SDK/Client: Browser native LanguageModel API
  - Configuration: Enabled via `--enable-features=PromptAPIForPhiMini` in Edge Dev
  - Model availability check: `LanguageModel.availability()`

## Data Storage

**Databases:**

- Not applicable - This is a client-side only application with no backend database

**File Storage:**

- Browser local storage only
- Model cache: Managed by browser's Optimization Guide component
  - Cache location: Managed internally by Chrome/Edge at user data directory
  - Persistence: Automatic via browser profile directory (e.g., `.playwright-profiles/chrome-beta`)

**Caching:**

- Browser cache only - No external caching service

## Authentication & Identity

**Auth Provider:**

- None - Client-side only application
- No authentication required

## Monitoring & Observability

**Error Tracking:**

- None detected - No external error tracking service configured

**Logs:**

- Console logging only
- Implementation: `console.error()` in `apps/in-browser-ai-coding-agent/src/main.ts`
- Bootstrap script logs: `console.log()` for model download progress in `scripts/bootstrap-ai-model.mjs`

## CI/CD & Deployment

**Hosting:**

- Not specified - Client-side SPA, deployable to any static file host
- Build output path: `dist/apps/in-browser-ai-coding-agent/browser/`

**CI Pipeline:**

- GitHub Actions (via `.github/` directory)
- Lint, typecheck, test, build, and E2E test execution via Nx orchestration

## Environment Configuration

**Required env vars:**

- `BASE_URL` - E2E test server URL (defaults to `http://localhost:4200` in `apps/in-browser-ai-coding-agent-e2e/playwright.config.ts`)

**Secrets location:**

- Not applicable - No secrets required for this application

## Browser APIs & Capabilities

**On-Device Language Model API:**

- Location: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`
- Global API: `LanguageModel` (accessed via `typeof LanguageModel` check)
- Methods:
  - `LanguageModel.availability()` - Returns string: 'available' | 'downloadable' | 'unavailable'
  - `LanguageModel.create(options)` - Creates a model session with optional monitor callback
- Monitor callbacks:
  - `downloadprogress` event - Emits `{ loaded, total }` during model download
- Session lifecycle:
  - `session.destroy()` - Cleanup method to release resources

## Playwright & Browser Configuration

**Test Browsers:**

- Chrome Beta (channel: `chrome-beta`)
  - Flags: `--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano`
  - Profile: `.playwright-profiles/chrome-beta`

- Edge Dev (channel: `msedge-dev`)
  - Flags: `--enable-features=PromptAPIForPhiMini`
  - Profile: `.playwright-profiles/msedge-dev`

**Playwright Config Locations:**

- E2E tests: `apps/in-browser-ai-coding-agent-e2e/playwright.config.ts`
  - Configured via Nx plugin: `@nx/playwright`
  - Test directory: `apps/in-browser-ai-coding-agent-e2e/src/`
  - Web server integration: Runs `npx nx run in-browser-ai-coding-agent:serve` on port 4200

- Browser tests (Vitest): `apps/in-browser-ai-coding-agent/vitest.config.mts`
  - Multiple browser instances via `vitest/browser-playwright`
  - Instances: `chrome-gemini-nano` and `edge-phi4-mini`

**Browser Feature Flags Configuration:**

- Local State seeding: `scripts/bootstrap-ai-model.mjs`
  - Seeds `browser.enabled_labs_experiments` in user data directory's Local State file
  - Flags stored as: `flag-name@option-index` (e.g., `optimization-guide-on-device-model@2`)
  - Option values: @1 = Enabled, @2 = Enabled BypassPerfRequirement

## Webhooks & Callbacks

**Incoming:**

- Not applicable - Client-side only application

**Outgoing:**

- None detected

---

_Integration audit: 2026-03-20_
