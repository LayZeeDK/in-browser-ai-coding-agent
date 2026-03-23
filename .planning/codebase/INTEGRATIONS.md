# External Integrations

**Analysis Date:** 2026-03-23

## APIs & External Services

**On-Device AI (W3C LanguageModel API):**

- Chrome Beta Gemini Nano - Browser-native inference via W3C standard
  - Client: `LanguageModel` global API (typed by `@types/dom-chromium-ai`)
  - Feature flag: `OptimizationGuideOnDeviceModel@1`
  - Model download: ~2GB, cached in browser profile
  - No cloud API, no API key required
- Edge Dev Phi-4 Mini - Browser-native inference via W3C standard
  - Client: `LanguageModel` global API
  - Feature flag: `edge-llm-prompt-api-for-phi-mini@1`
  - Model download: Multi-GB, cached in browser profile
  - No cloud API, no API key required

**Implementation:**

- `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts` - Service wrapper around LanguageModel API
- Methods: `isApiSupported`, `checkAvailability()`, `downloadModel()`, `prompt(text)`
- Type: `ModelAvailability` = 'available' | 'downloadable' | 'downloading' | 'unavailable'

## Data Storage

**Databases:**

- Not applicable - No persistent data storage

**File Storage:**

- Local filesystem only
  - Browser cache: Model files stored in profile directory
  - Cache location: `.playwright-profiles/` (gitignored, development only)
  - CI/CD: Separate caches per browser per test type (`msedge-dev-e2e-edge-v1-*`, `msedge-dev-test-edge-v1-*`)

**Caching:**

- None - No external caching service

## Authentication & Identity

**Auth Provider:**

- Not applicable - No authentication required
- App runs entirely in browser with no backend
- No user login, sessions, or credentials

## Monitoring & Observability

**Error Tracking:**

- None configured - Angular global error listener in `appConfig`

**Logs:**

- Browser console logging in `language-model.service.ts`
- Test logging in E2E fixtures and Vitest reporters
- GitHub Actions step summary via `GITHUB_STEP_SUMMARY` environment variable in E2E tests

**Diagnostics:**

- Chrome internal debug pages:
  - `chrome://on-device-internals` - Chrome Beta model status
  - `edge://on-device-internals` - Edge Dev model status
- Model warm-up diagnostics in `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts`
- Vitest UI available at `ui` reporter target

## CI/CD & Deployment

**Hosting:**

- Static SPA - builds to `dist/apps/in-browser-ai-coding-agent/`
- Deployable to any static web host (GitHub Pages, CDN, file server)
- Local development: `npm start` runs dev server on default port

**CI Pipeline:**

- GitHub Actions (Nx CI preset with `@nx/playwright/plugin`)
- E2E tests via Playwright: 2 projects (chrome-gemini-nano, edge-phi4-mini)
- Unit tests via Vitest: Multi-browser test execution
- Lint, typecheck, build, format targets run via `nx run-many`
- CI step timeout: 120 minutes (ARM64 model warm-up can exceed 100 min)

**Build Command:**

```bash
npm run build        # Full production build
npm run lint         # ESLint check
npm run typecheck    # TypeScript check
npm test             # Unit tests (both browsers)
npm run e2e          # E2E tests (Playwright)
npm run ci           # Full CI pipeline locally
```

**Deployment:**

- No deployment integration — build output is static
- Output ready for GitHub Pages, Netlify, Vercel, or any static host
- Entry point: `dist/apps/in-browser-ai-coding-agent/index.html`

## Environment Configuration

**Required env vars:**

- `E2E_PORT` - Port for E2E test server (default: 4200)
- `BASE_URL` - Base URL for E2E tests (default: `http://localhost:4200`)
- `CI` - Set by GitHub Actions; controls test reporters and timeouts
- `GITHUB_STEP_SUMMARY` - GitHub Actions artifact path for test results

**Secrets location:**

- No secrets storage configured — app has no backend credentials
- Browser profiles seeded by `seedLocalState()` in `libs/shared/browser-profiles/src/lib/browser-profiles.ts`

## Webhooks & Callbacks

**Incoming:**

- None

**Outgoing:**

- None

## Browser API Usage

**W3C APIs:**

- LanguageModel API (experimental) - On-device AI inference
  - Session lifecycle: `create()`, `prompt()`, `destroy()`
  - Events: `downloadprogress` (download monitoring)

**No External APIs:**

- No REST/GraphQL endpoints
- No third-party SDKs (Stripe, Auth0, Firebase, etc.)
- No cloud service integration

---

_Integration audit: 2026-03-23_
