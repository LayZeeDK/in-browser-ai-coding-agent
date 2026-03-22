# Testing Patterns

**Analysis Date:** 2026-03-22

## Test Framework

**Runners:**

- **Unit Tests:** Vitest 4.1 in browser mode with `@vitest/browser-playwright` v4.1.0
- **E2E Tests:** Playwright Test (via `@nx/playwright` 22.6.0) with custom persistent context fixture
- Config files: `apps/in-browser-ai-coding-agent/vitest.config.mts`, `apps/in-browser-ai-coding-agent-e2e/playwright.config.ts`

**Assertion Library:**

- Vitest built-in: `expect(value).toBe(...)`, `expect(value).toMatch(...)`
- Playwright built-in: `await expect(element).toBeVisible()`, `await expect(element).toHaveAttribute(...)`

**Run Commands:**

```bash
pnpm nx run in-browser-ai-coding-agent:test        # Run unit tests
pnpm nx run in-browser-ai-coding-agent-e2e:e2e     # Run e2e tests
pnpm nx run-many -t test                           # All unit tests
pnpm nx run-many -t e2e                            # All e2e tests
```

**Vitest Browser Mode:**

- Runs tests inside real browsers (Chrome Beta, Edge Dev)
- Requires persistent profile directories (`.playwright-profiles/chrome-beta`, `.playwright-profiles/msedge-dev`)
- No JSDOM or bundled Chromium support (LanguageModel API unavailable in those contexts)

## Test File Organization

**Location:**

- Unit tests: Co-located with source files (`*.spec.ts` suffix)
  - `src/app/language-model.service.spec.ts` (alongside service)
  - `src/app/model-status.component.spec.ts` (alongside component)
- E2E tests: Separate `*-e2e` app directory
  - `apps/in-browser-ai-coding-agent-e2e/src/example.spec.ts`
  - `apps/in-browser-ai-coding-agent-e2e/src/prompt.spec.ts`
- Setup files: Outside `src/` (not compiled by Angular)
  - `apps/in-browser-ai-coding-agent/global-setup.ts` (Vitest global setup)
  - `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (Playwright test fixture)

**Naming:**

- `{component-name}.spec.ts` for unit tests
- `{feature}.spec.ts` for e2e tests

## Test Structure

**Vitest Unit Test Suite:**

```typescript
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

describe('LanguageModelService', () => {
  let service: LanguageModelService;

  beforeEach(() => {
    service = TestBed.inject(LanguageModelService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should respond to a prompt', async () => {
    const response = await service.prompt('Hello, AI!');
    expect(response).toBeTruthy();
  }, 300_000); // 5-minute timeout
});
```

**Playwright E2E Test Suite:**

```typescript
import { test, expect } from './fixtures';

test('responds to a prompt', async ({ persistentPage: page }) => {
  test.setTimeout(600_000);

  await page.goto('http://localhost:4200/');

  const statusEl = page.getByTestId('status-result');
  await expect(statusEl).toBeVisible({ timeout: 10_000 });

  // Test assertions...
});
```

**Patterns:**

- **Setup:** `beforeEach()` for Vitest (Angular TestBed injection), Playwright uses fixture setup
- **Teardown:** `finally` blocks or Playwright fixture cleanup (automatic context close)
- **Assertions:** Vitest uses synchronous `expect()`, Playwright uses `await expect(...)`

## Mocking

**Framework:** None (real browser, real on-device model)

**What NOT to Mock:**

- `LanguageModel` API (requires real browser API)
- Network requests (no external APIs in this app)
- File system (browser APIs only)

**What to Mock (if needed):**

- Component dependencies via Vitest/Angular TestBed (not shown in current tests -- no HTTP/service mocking present)
- Playwright page methods can be stubbed if testing error paths

**Approach:**

- Tests verify real on-device AI model functionality
- Integration tests that exercise the full stack: UI component → service → LanguageModel API → browser inference
- No unit test isolation via mocks; rely on guard tests to fail fast if environment is misconfigured

## Fixtures and Factories

**Test Data:**
No test data factories present. This codebase tests real inference, not simulated responses.

**Browser Instances:**
Global fixture provides persistent browser contexts:

```typescript
// Vitest browser instances (vitest.config.mts)
const allInstances = [
  {
    name: 'chrome-gemini-nano',
    provider: playwright({
      persistentContext: resolve('.playwright-profiles/chrome-beta'),
      launchOptions: {
        channel: 'chrome-beta',
        args: ['--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano'],
        ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
      },
    }),
  },
  {
    name: 'edge-phi4-mini',
    provider: playwright({
      persistentContext: resolve('.playwright-profiles/msedge-dev'),
      launchOptions: {
        channel: 'msedge-dev',
        args: ['--enable-features=AIPromptAPI'],
        ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
      },
    }),
  },
];
```

**Playwright E2E Fixture:**

```typescript
export const test = base.extend<
  { persistentPage: Page },
  { persistentContext: BrowserContext }
>({
  // Worker-scoped: one browser per worker, shared across all tests
  persistentContext: [async ({}, use, workerInfo) => {
    enableInternalDebugPages(profile.profileDir);
    context = await chromium.launchPersistentContext(...);
    await warmUpModel(context); // Navigate to on-device-internals, run prompt('warmup')
    await use(context);
    await context.close();
  }, { scope: 'worker', timeout: 1_200_000 }],

  // Test-scoped: fresh page from shared context
  persistentPage: async ({ persistentContext }, use) => {
    const page = persistentContext.pages()[0] || await persistentContext.newPage();
    await use(page);
  },
});
```

**Location:** `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts`

## Coverage

**Requirements:** No enforced coverage target in `vitest.config.mts` or test setup

**View Coverage:**

```bash
pnpm nx run in-browser-ai-coding-agent:test --coverage
```

Uses `@vitest/coverage-v8` for coverage reporting. Coverage output goes to `coverage/` directory.

## Test Types

**Unit Tests:**

- **Scope:** Individual services and components
- **Files:** `language-model.service.spec.ts`, `model-status.component.spec.ts`, `app.spec.ts`
- **Approach:** Angular TestBed for DI, Vitest browser mode for real LanguageModel API access
- **Real inference:** Yes -- tests call actual `await service.prompt('Hello, AI!')` against on-device model

**Integration Tests:**

- **Scope:** Component + service interaction
- **Example:** `model-status.component.spec.ts` renders component, waits for service to fetch availability, submits prompt
- **Pattern:** Creates component fixture, waits for async lifecycle, triggers events, validates rendered output

**E2E Tests:**

- **Scope:** Full application flow from UI to inference
- **Files:** `example.spec.ts` (basic app render), `prompt.spec.ts` (full prompt workflow)
- **Approach:** Playwright page navigation, DOM interaction, element waiting
- **Real inference:** Yes -- full browser automation of real inference

## Common Patterns

**Async Testing (Vitest):**

```typescript
it('should respond to a prompt', async () => {
  const response = await service.prompt('Hello, AI!');
  expect(response).toBeTruthy();
}, 300_000); // Timeout in milliseconds
```

- Test function is `async`, returns `Promise`
- Await promises before assertion
- Timeout passed as second argument to `it()` (not in `expect()`)

**Async Testing (Playwright):**

```typescript
test('responds to a prompt', async ({ persistentPage: page }) => {
  test.setTimeout(600_000); // Set timeout at start of test

  await page.goto('http://localhost:4200/');
  await expect(statusEl).toBeVisible({ timeout: 10_000 });
});
```

- Set timeout with `test.setTimeout()` at test start
- All page interactions are `async` and must be `await`-ed

**Element Polling (Custom):**

```typescript
async function waitForElement(root: HTMLElement, selector: string, timeoutMs = 10_000): Promise<HTMLElement> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const el = root.querySelector(selector) as HTMLElement | null;
    if (el) return el;
    await new Promise((r) => setTimeout(r, 200)); // Poll every 200ms
  }

  throw new Error(`Element "${selector}" not found within ${timeoutMs}ms`);
}
```

- Manual polling with 200ms delay between checks
- Used for component tests that need to wait for async state changes
- Throws with descriptive error if timeout exceeded

**Error Detection (Race Pattern):**

```typescript
// Wait for either a response or an error — whichever appears first
const resultEl = await waitForElement(compiled, '[data-testid="prompt-response"], [data-testid="prompt-error"]', 240_000);

const testId = resultEl.getAttribute('data-testid');

if (testId === 'prompt-error') {
  expect.fail(`Prompt failed with error: ${resultEl.textContent?.trim()}`);
}
```

- Single selector polls for both success and failure elements
- Immediately fail with actual error message if error element appears
- Prevents blind 4-minute timeout when model inference fails silently

**Guard Tests (Fail Fast):**

```typescript
it('should have a model that is available, downloading, or downloadable', async () => {
  const status = await service.checkAvailability();

  expect(status, `Expected model to be available but got "${status}". ` + 'Ensure the browser has the LanguageModel API enabled and profile is bootstrapped.').toMatch(/^(available|downloading|downloadable)$/);
});
```

- Runs before expensive prompt tests (via describe block ordering)
- Fails immediately with diagnostic message if environment is misconfigured
- Prevents cascade of prompt test timeouts due to missing API

**Structured Logging (CI Parsing):**

```typescript
// Service test
console.log(`[unit] Prompt: "Hello, AI!"\n[unit-response]${response.trim()}[/unit-response]`);

// Component test
console.log(`[unit] Component prompt: "Hello, AI!"\n[unit-response]${responseText}[/unit-response]`);

// E2E test
console.log(`[e2e] Prompt: "Hello, AI!" -> Response: "${trimmed}"`);

// GitHub Actions summary (E2E only)
if (process.env['GITHUB_STEP_SUMMARY']) {
  appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `### E2E Prompt Response\n\n**Prompt:** Hello, AI!\n\n**Response:** ${trimmed}\n\n`);
}
```

- Prefixes identify test source in combined CI logs
- `[unit-response]...[/unit-response]` delimiters wrap model output (guaranteed not in output)
- E2E also writes to GitHub Actions job summary for visibility

## Browser Configuration

**Vitest Browser Instances:**

- `chrome-gemini-nano`: Chrome Beta with Gemini Nano model
  - Channel: `chrome-beta`
  - Feature flags: `OptimizationGuideOnDeviceModel`, `PromptAPIForGeminiNano`
  - Profile: `.playwright-profiles/chrome-beta`
- `edge-phi4-mini`: Edge Dev with Phi-4 Mini model
  - Channel: `msedge-dev`
  - Feature flags: `AIPromptAPI`
  - Profile: `.playwright-profiles/msedge-dev`

**CI Instance Filtering:**

```typescript
const filterInstance = process.env['CI_VITEST_BROWSER_INSTANCE'];
const instances = filterInstance ? allInstances.filter((i) => i.name === filterInstance) : allInstances;
```

- In CI, `CI_VITEST_BROWSER_INSTANCE` env var selects single instance per matrix job
- Locally (no env var), both instances available
- Prevents running both browsers on single runner (doubles disk/memory usage)

**Playwright Default Args Handling:**
Critical: Playwright defaults disable LanguageModel API. Must be removed:

```typescript
const PLAYWRIGHT_DISABLE_FEATURES = '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,...,OptimizationHints';

const AI_IGNORE_DEFAULT_ARGS = [
  PLAYWRIGHT_DISABLE_FEATURES, // Removes OptimizationHints disable
  '--disable-field-trial-config', // Removes field trial gate
  '--disable-background-networking', // Removes networking disable
  '--disable-component-update', // Removes component disable
];
```

**ProfileDir Initialization:**

```typescript
function enableInternalDebugPages(profileDir: string) {
  const localStatePath = join(profileDir, 'Local State');
  let state = existsSync(localStatePath) ? JSON.parse(readFileSync(localStatePath, 'utf8')) : {};

  if (!state['internal_only_uis_enabled']) {
    state['internal_only_uis_enabled'] = true;
    writeFileSync(localStatePath, JSON.stringify(state, null, 2));
  }
}
```

- Seeds `internal_only_uis_enabled: true` into `Local State` JSON
- Required to access `chrome://on-device-internals` without gate page
- Called before browser launch (fixture, global setup, bootstrap script)

## Global Setup (Vitest)

File: `apps/in-browser-ai-coding-agent/global-setup.ts`

**Purpose:** Warm up on-device AI models before any tests run

**Execution Flow:**

```
1. For each browser instance (filtered by CI_VITEST_BROWSER_INSTANCE)
2.   Check profile directory exists
3.   enableInternalDebugPages(profileDir)
4.   Launch persistent context (5 attempts, 2s delay for ProcessSingleton retry)
5.   Navigate to chrome://on-device-internals or edge://on-device-internals
6.   Run LanguageModel.create() + session.prompt('warmup')
7.   Wait for "Foundational model state: Ready" (10 min deadline)
8.   Handle "Not Ready For Unknown Reason" (transient, refresh page)
9.   Close context
10. Catch errors and log warnings (warm-up skipped, tests may still run)
```

**Why Warm Up:**
Three levels of model readiness exist:

1. **Files on disk:** `availability()` returns `'available'` (not eliminated cold-start)
2. **Registered:** on-device-internals shows "Ready" (not eliminated cold-start)
3. **Inference pipeline initialized:** First `session.prompt()` completes (ELIMINATES cold-start)

Only level 3 (full inference) eliminates cold-start. Phi-4 Mini cold-start on ARM64 is 11+ minutes.

**Timeouts:**

- Max attempts for launch: 5 with 2s delay (total 10s buffer for ProcessSingleton)
- Global setup page timeout: 600_000ms (10 minutes)
- Model ready wait loop: 600_000ms deadline with 30s polls
- Per-test prompt timeout: 300_000ms (5 minutes)

## Retry Configuration

**Vitest (Unit Tests):**

```typescript
retry: process.env['CI'] ? 2 : 0,
reporters: process.env['CI'] ? ['default', 'github-actions'] : ['default'],
```

- 2 retries in CI, 0 locally
- `github-actions` reporter annotates flaky tests in job summary

**Playwright (E2E Tests):**

```typescript
workers: 1,
retries: 2,
trace: 'on-first-retry',  // Capture trace when test fails and retries
```

- Single worker (persistent context cannot be shared)
- 2 retries unconditionally (ProcessSingleton flakiness happens locally too)
- Traces captured on first retry for post-mortem debugging

**Why Retries:**
Chrome ProcessSingleton lockfile on Windows may cause first launch to fail if previous `chrome_crashpad_handler` is still running. Retry allows process to exit and release lock.

## Known Issues & Mitigations

**1. Phi-4 Mini Cold-Start (11+ minutes on ARM64)**

- **Issue:** First `session.prompt()` after fresh profile requires ONNX Runtime compilation
- **Mitigation:** Global setup runs warm-up prompt before tests; subsequent test prompts reuse warm session
- **Detection:** If global setup logs `Model warm-up skipped`, prompt tests will absorb cold-start and timeout

**2. Chrome ProcessSingleton on Windows**

- **Issue:** `chrome_crashpad_handler` holds `FILE_FLAG_DELETE_ON_CLOSE` lockfile, causing second launch to fail
- **Mitigation:** 5-attempt retry loop with 2s delay in fixture + global setup; Playwright's `retries: 2`
- **Detection:** Log messages like `[fixtures] Launch attempt 2/5 failed, retrying in 2s...`

**3. Edge "Not Ready For Unknown Reason" Transient State**

- **Issue:** on-device-internals page reports model as "Not Ready" transiently
- **Mitigation:** Global setup detects and reloads page; transient state resolves after ~1s
- **Detection:** Global setup logs `[global-setup] edge-phi4-mini: model not ready, refreshing...`

**4. Model Download Failures**

- **Issue:** Model download can time out or fail transiently
- **Mitigation:** Bootstrap script runs during CI cache miss; cached profiles skip bootstrap on hit
- **Detection:** E2E test waits 300s for model to reach 'available' status before prompt

---

_Testing analysis: 2026-03-22_
