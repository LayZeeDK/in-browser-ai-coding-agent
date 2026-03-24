# Testing Patterns

**Analysis Date:** 2026-03-24

## Test Framework

**Runner:**

- Vitest 4.x with browser mode (`@vitest/browser-playwright`)
- Config: `apps/in-browser-ai-coding-agent/vitest.config.mts` (default -- all browsers)
- Per-browser configs: `apps/in-browser-ai-coding-agent/vitest.config.chrome.mts`, `apps/in-browser-ai-coding-agent/vitest.config.edge.mts`
- Shared config factory: `apps/in-browser-ai-coding-agent/vitest.shared.mts`

**Assertion Library:**

- Vitest's native `expect` API
- Angular `TestBed` for component/service testing

**Run Commands:**

```bash
npm test                                           # Unit tests on both browsers (default)
npm exec nx -- test-chrome in-browser-ai-coding-agent   # Chrome Beta / Gemini Nano only
npm exec nx -- test-edge in-browser-ai-coding-agent     # Edge Dev / Phi-4 Mini only
npm run e2e                                        # E2E tests (Playwright, both browsers)
npm exec nx -- e2e in-browser-ai-coding-agent-e2e -c chrome   # E2E Chrome only
npm exec nx -- e2e in-browser-ai-coding-agent-e2e -c edge     # E2E Edge only
npm run lint                                       # ESLint (--max-warnings=0)
npm run typecheck                                  # TypeScript type checking
```

## Test File Organization

**Location:**

- Unit tests co-located with source files (same directory)
- E2E tests in `apps/in-browser-ai-coding-agent-e2e/src/`

**Naming:**

- Unit tests: `[source-name].spec.ts` (e.g., `language-model.service.spec.ts`)
- E2E tests: `[feature].spec.ts` (e.g., `example.spec.ts`, `prompt.spec.ts`)

**Structure:**

```
apps/
  in-browser-ai-coding-agent/
    src/app/
      app.ts
      app.spec.ts                          # Root component test
      language-model.service.ts
      language-model.service.spec.ts       # Service test
      model-status.component.ts
      model-status.component.spec.ts       # Component test
    browser-warmup.ts                      # Vitest setupFile (runs in test browser)
    global-setup.ts                        # Vitest globalSetup (all browsers)
    global-setup.chrome.ts                 # Vitest globalSetup (Chrome only)
    global-setup.edge.ts                   # Vitest globalSetup (Edge only)
    global-setup.shared.ts                 # Shared setup logic (seedLocalState, no browser launch)
    vitest.config.mts                      # Both browsers (default test target)
    vitest.config.chrome.mts               # Chrome Beta only (test-chrome target)
    vitest.config.edge.mts                 # Edge Dev only (test-edge target)
    vitest.shared.mts                      # Shared config factory
  in-browser-ai-coding-agent-e2e/
    src/
      fixtures.ts                          # Worker-scoped persistent context + warm-up
      example.spec.ts                      # Basic UI tests
      prompt.spec.ts                       # Real inference E2E tests
    playwright.config.ts
libs/
  shared/
    browser-profiles/
      src/
        index.ts                           # Public API barrel
        lib/browser-profiles.ts            # Profile definitions, seedLocalState(), getLaunchOptions()
```

## Test Structure

**Suite Organization:**

```typescript
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageModelService, ModelAvailability } from './language-model.service';

describe('LanguageModelService', () => {
  let service: LanguageModelService;

  beforeEach(() => {
    service = TestBed.inject(LanguageModelService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return a valid availability status', async () => {
    const status = await service.checkAvailability();
    const validStatuses: ModelAvailability[] = ['available', 'downloading', 'downloadable', 'unavailable'];
    expect(validStatuses).toContain(status);
  });
});
```

**Patterns:**

- Descriptive test names using `it('should [expected behavior]', ...)`
- `beforeEach()` for TestBed configuration and service injection
- Async tests with `async`/`await` -- no `done` callback pattern
- Extended timeouts for AI inference: `it('...', async () => { ... }, 600_000)`
- `it.skipIf(condition)` for platform-conditional tests (e.g., skip slow prompt on CI Edge)
- `expect.fail()` for test-side assertion errors in complex flows

## Component Testing

**Setup pattern (standalone components):**

```typescript
describe('ModelStatusComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModelStatusComponent], // standalone -- use imports, not declarations
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
```

**DOM querying:**

- Query by `data-testid` attribute: `compiled.querySelector('[data-testid="status-result"]')`
- Cast `nativeElement` as `HTMLElement`: `const compiled = fixture.nativeElement as HTMLElement`
- `fixture.detectChanges()` for synchronous rendering
- `fixture.whenStable()` for async settling

**Async rendering helper:**

Custom `waitForElement()` defined in `apps/in-browser-ai-coding-agent/src/app/model-status.component.spec.ts`. Polls the DOM until the element appears:

```typescript
async function waitForElement(root: HTMLElement, selector: string, timeoutMs = 10_000): Promise<HTMLElement> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const el = root.querySelector(selector) as HTMLElement | null;

    if (el) {
      return el;
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`Element "${selector}" not found within ${timeoutMs}ms`);
}
```

Used instead of `fixture.whenStable()` when waiting for async model API responses.

## Mocking

**Framework:** Angular TestBed for DI; no mock library used

**Patterns:**

- No mocking -- tests run against the real LanguageModel API in a real browser
- Real browser context (Chrome Beta or Edge Dev) provides the `LanguageModel` global
- No `vi.fn()`, `vi.spyOn()`, or `TestBed.overrideProvider()` present in current tests
- Conditional skip via `it.skipIf()` rather than mocking unavailable APIs

**What NOT to mock:**

- `LanguageModel` global -- requires real on-device model for meaningful tests
- Browser APIs (DOM, fetch) -- tests run in real browser context
- `LanguageModelService` -- tests call the real service

## Fixtures and Factories

**E2E: Worker-scoped persistent context fixture (`apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts`):**

Always import from `./fixtures`, never from `@playwright/test` directly -- this ensures every test uses the shared persistent context:

```typescript
import { test, expect } from './fixtures';
```

The fixture extends Playwright's base `test` with two fixtures:

- `persistentContext` (worker-scoped): launches the browser once per worker, warms up the model, shared across all tests
- `persistentPage` (test-scoped): provides a page from the shared context

**Worker-scoped context setup:**

```typescript
export const test = base.extend<{ persistentPage: Page }, { persistentContext: BrowserContext }>({
  persistentContext: [
    async ({}, use, workerInfo) => {
      const profile = profilesByName[workerInfo.project.name];
      seedLocalState(profile);

      // 5-attempt retry loop -- Chrome ProcessSingleton on Windows may hold lockfile
      let context!: BrowserContext;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          context = await chromium.launchPersistentContext(profile.profileDir, getLaunchOptions(profile));
          break;
        } catch (error) {
          if (attempt === 5) throw error;
          await new Promise((r) => setTimeout(r, 2_000));
        }
      }

      // Navigate to app first (LanguageModel API requires secure context)
      const warmupPage = context.pages()[0] || (await context.newPage());
      await warmupPage.goto(baseURL);
      await warmupPage.evaluate(async () => {
        const session = await LanguageModel.create();
        await session.prompt('warmup');
        session.destroy();
      });

      await use(context);
      await context.close();
    },
    { scope: 'worker', timeout: 10_800_000 }, // 3h -- matches CI step timeout
  ],

  persistentPage: async ({ persistentContext }, use) => {
    const page = persistentContext.pages()[0] || (await persistentContext.newPage());
    await use(page);
  },
});
```

## Coverage

**Requirements:** Not enforced (no coverage threshold configured)

**View coverage:**

```bash
npm exec nx -- test in-browser-ai-coding-agent -- --coverage
```

## Test Types

**Unit Tests:**

- Scope: Individual services and components with real LanguageModel API
- Framework: Vitest + Angular TestBed
- Browser: Chrome Beta (`chrome-gemini-nano`) or Edge Dev (`edge-phi4-mini`) with AI feature flags enabled
- Files: `apps/in-browser-ai-coding-agent/src/app/*.spec.ts`
- Timeouts: 30s for model availability checks; 600s for inference tests

**E2E Tests:**

- Scope: Full application flow in both browsers
- Framework: Playwright `^1.49` with `@nx/playwright`
- Browser projects: `chrome-gemini-nano` (Chrome Beta) and `edge-phi4-mini` (Edge Dev)
- Files: `apps/in-browser-ai-coding-agent-e2e/src/*.spec.ts`
- No retries in CI (`retries: 0`) -- each retry triggers full model warm-up
- `workers: 1` -- persistent contexts cannot be shared across parallel workers
- Timeouts: 600s per test; 3h fixture warm-up

## Vitest Configuration

**Shared config factory (`apps/in-browser-ai-coding-agent/vitest.shared.mts`):**

```typescript
export function createVitestConfig(options?: { instanceFilter?: string; globalSetup?: string }) {
  return defineConfig({
    plugins: [nxViteTsPaths()],
    test: {
      globalSetup: [globalSetup],
      setupFiles: [`${appRoot}/browser-warmup.ts`],
      fileParallelism: false, // Persistent context not shareable across parallel sessions
      retry: 0, // No retries -- each retry requires full warm-up
      reporters: process.env['CI'] ? ['default', 'github-actions'] : ['default'],
      browser: {
        enabled: true,
        headless: false, // LanguageModel API requires headed mode
        instances,
        trace: process.env['CI'] ? 'on-first-retry' : 'off',
      },
    },
  });
}
```

**Per-browser Nx targets (not Nx configurations):**

`@angular/build:unit-test` silently ignores Nx `configurations` for `runnerConfig`. Separate targets with distinct config files are used instead:

- `test` target: `vitest.config.mts` (both browsers)
- `test-chrome` target: `vitest.config.chrome.mts` (Chrome only)
- `test-edge` target: `vitest.config.edge.mts` (Edge only)

## Playwright Configuration

**`apps/in-browser-ai-coding-agent-e2e/playwright.config.ts`:**

```typescript
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  workers: 1,
  retries: process.env['CI'] ? 0 : 2,
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    command: `npx nx run in-browser-ai-coding-agent:serve -- --port=${port}`,
    url: baseURL,
    reuseExistingServer: true,
    cwd: workspaceRoot,
  },
  projects: [
    { name: 'chrome-gemini-nano', use: { channel: 'chrome-beta' } },
    { name: 'edge-phi4-mini', use: { channel: 'msedge-dev' } },
  ],
});
```

HTML reporter `open: 'never'` -- launching Chrome Stable for the report interferes with Chrome Beta persistent contexts.

## CI Test Workflows (`.github/workflows/ci.yml`)

The CI pipeline contains four test-related jobs. All jobs are skipped when only `.planning/**`, `.claude/**`, or `plans/**` files change (detected by `.github/actions/paths-filter/`).

### `test-chrome` job

- Runner: `ubuntu-latest` inside Docker container `ghcr.io/{repo}/playwright-chrome-beta:latest`
- Container: `--ipc=host --user 1001`, `xvfb-run` for headed mode on Linux
- Command: `xvfb-run --auto-servernum npm exec nx -- test-chrome in-browser-ai-coding-agent`
- Timeout: 45 minutes
- Post-step: Parses `unit-test-output.log` for `[unit]`/`[unit-response]` markers and appends to GitHub step summary
- No model cache -- Chrome Beta + Gemini Nano bootstrapped into the custom Docker image

### `test-edge` job

- Runner: `windows-11-arm` (ARM64 native -- ONNX Runtime requires Desktop SKU)
- No Docker container -- bare Windows runner
- Model cache: `msedge-dev-test-edge-v1-run{N}` cache key for `.playwright-profiles/msedge-dev`
- Bootstrap: `node scripts/bootstrap-ai-model.mjs --browser msedge-dev --profile .playwright-profiles/msedge-dev --timeout 600000 --perf-param 3` (only if cache miss)
- `node_modules` cache: separate key (`{os}-{arch}-node{version}-nm-{lockfile hash}`) -- ARM64 native compilation is the bottleneck
- Command: `npm exec nx -- test-edge in-browser-ai-coding-agent`
- Timeout: 180 minutes
- Pre-test: Logs ONNX Runtime DLL versions and `genai_config.json` via PowerShell
- Post-step: Parses `unit-test-output.log` for `[unit]`/`[unit-response]` markers; logs inference cache file sizes
- Cache save: Only on `unit-tests.outcome == 'success'` to avoid caching corrupt profiles

### `e2e-chrome` job

- Runner: `ubuntu-latest` inside Docker container
- Command: `xvfb-run --auto-servernum npm exec nx -- e2e in-browser-ai-coding-agent-e2e -c chrome`
- Timeout: 45 minutes

### `e2e-edge` job

- Runner: `windows-11-arm`
- Model cache key: `msedge-dev-e2e-edge-v1-run{N}` (separate from unit test cache)
- Command: `npm exec nx -- e2e in-browser-ai-coding-agent-e2e -c edge`
- Timeout: 180 minutes

### Docker image (`build-chrome-image` job)

- Dockerfile: `.github/docker/Dockerfile`
- Registry: `ghcr.io/{repo}/playwright-chrome-beta`
- Tag: `v{playwright-version}-node{node-version}-{dockerfile-sha8}`
- Rebuild triggers: Playwright version bump, Node version change, Dockerfile edit
- Image installs: Node.js (NodeSource), xvfb, Chromium system deps, Chrome Beta
- Non-root user UID 1001 (matches GitHub Actions runner UID)

### npm cache split by platform

- `ubuntu-latest`: caches npm download cache (`~/.npm`) via `actions/setup-node` built-in cache
- `windows-11-arm`: caches `node_modules` directly (ARM64 native compilation is the bottleneck, not download)

## Model Warm-up Architecture

The warm-up happens in the **same browser process** as tests to preserve ONNX compilation state.

**Unit test warm-up flow:**

1. `globalSetup` (`global-setup.ts` / `global-setup.chrome.ts` / `global-setup.edge.ts`): file-only operations -- calls `seedLocalState()` to write profile flags. No browser launch.
2. Browser launch: Vitest launches Chrome Beta or Edge Dev with `@vitest/browser-playwright`
3. `setupFiles` (`browser-warmup.ts`): runs in test browser context -- calls `LanguageModel.create()` then `session.prompt('warmup')` -- ONNX compilation result persists for all tests
4. Tests run in the same warm browser. `fileParallelism: false` ensures sequential execution in the same context.

**E2E test warm-up flow:**

1. Playwright fixture (`fixtures.ts`) worker setup: seeds profile, launches persistent context, navigates to app, calls `LanguageModel.create()` + `session.prompt('warmup')` via `page.evaluate()`
2. All tests share the warm `persistentContext` (worker-scoped, `workers: 1`)

**Key constraint:** Never call `session.destroy()` until after warm-up completes. Per the W3C Prompt API spec, destroying the last session reference unloads the model from memory.

## Common Patterns

**Async testing:**

```typescript
// Service test with extended timeout
it('should respond to a prompt', async () => {
  const response = await service.prompt('Hello, AI!');
  expect(response).toBeTruthy();
  expect(response.length).toBeGreaterThan(0);
}, 600_000);

// Component test waiting for async rendering
it('should display status result', async () => {
  const fixture = TestBed.createComponent(ModelStatusComponent);
  const compiled = fixture.nativeElement as HTMLElement;
  const statusEl = await waitForElement(compiled, '[data-testid="status-result"]');
  expect(statusEl.getAttribute('data-status')).toMatch(/^(available|downloading|downloadable|unavailable)$/);
}, 30_000);

// E2E test with persistent page
test('has title', async ({ persistentPage: page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('in-browser-ai-coding-agent');
});
```

**Conditional skip:**

```typescript
const isEdge = /\bEdg\//.test(navigator.userAgent);

it.skipIf(inject('CI') && isEdge)(
  'should respond to a prompt',
  async () => { ... },
  600_000,
);
```

`inject('CI')` reads the value provided by `globalSetup.shared.ts` via `provide('CI', !!process.env['CI'])`.

**Test-side assertion failure:**

```typescript
if (testId === 'prompt-error') {
  expect.fail(`Prompt failed with error: ${resultEl.textContent?.trim()}`);
}
```

**E2E conditional flow (with required eslint-disable):**

```typescript
// eslint-disable-next-line playwright/no-conditional-in-test
if (status === 'downloadable') {
  await page.getByTestId('download-button').click();
}
```

**Prompt response logging for CI summary:**

```typescript
console.log(`[unit] Prompt: "Hello, AI!"\n[unit-response]${response.trim()}[/unit-response]`);
```

The CI workflow parses this format with a regex and writes the output to the GitHub Actions job summary.

---

_Testing analysis: 2026-03-24_
