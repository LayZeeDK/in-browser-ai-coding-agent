# Testing Patterns

**Analysis Date:** 2026-03-23

## Test Framework

**Runner:**

- Vitest 4.1 with browser mode (`@vitest/browser-playwright`)
- Config: `apps/in-browser-ai-coding-agent/vitest.config.mts` (default - all browsers)
- Per-browser configs: `vitest.config.chrome.mts`, `vitest.config.edge.mts`
- Shared config factory: `vitest.shared.mts`

**Assertion Library:**

- Vitest's native expect API
- Angular's TestBed for component testing

**Run Commands:**

```bash
npm test                                    # Run all unit tests (both browsers)
npm exec nx -- test-chrome in-browser-ai-coding-agent      # Chrome only
npm exec nx -- test-edge in-browser-ai-coding-agent        # Edge Dev only
npm run e2e                                 # E2E tests via Playwright
npm run ci                                  # Full pipeline: lint, typecheck, test, build, e2e
```

## Test File Organization

**Location:**

- Co-located with source files (same directory)
- Example: `src/app/language-model.service.ts` + `src/app/language-model.service.spec.ts`

**Naming:**

- `[source-name].spec.ts` for unit tests
- E2E specs: `src/*.spec.ts` in the e2e app directory

**Structure:**

```
apps/
  in-browser-ai-coding-agent/
    src/app/
      language-model.service.ts
      language-model.service.spec.ts       # Co-located test
      model-status.component.ts
      model-status.component.spec.ts
    browser-warmup.ts                       # Vitest setupFile
    global-setup.ts                         # Vitest globalSetup
    vitest.config.mts
    vitest.shared.mts
  in-browser-ai-coding-agent-e2e/
    src/
      fixtures.ts                           # Playwright persistent context fixture
      example.spec.ts                       # E2E tests
      prompt.spec.ts                        # Real inference E2E tests
    playwright.config.ts
libs/
  shared/
    browser-profiles/
      src/
        index.ts
        lib/browser-profiles.ts
```

## Test Structure

**Suite Organization:**

```typescript
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

  it('should respond to a prompt', async () => {
    const response = await service.prompt('Hello, AI!');
    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(0);
  }, 600_000); // Extended timeout for model inference
});
```

**Patterns:**

- Descriptive test names: `it('should [expected behavior]')`
- `beforeEach()` for setup (TestBed configuration for component tests)
- Async tests with `async` keyword and `await` for async operations
- Extended timeouts (600_000ms / 10min) for AI model inference tests
- Console logging for test output inspection (see logging pattern below)

## Component Testing

**Setup Pattern:**

```typescript
describe('ModelStatusComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModelStatusComponent], // Standalone component
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should display a status result after checking availability', async () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    const compiled = fixture.nativeElement as HTMLElement;
    const statusEl = await waitForElement(compiled, '[data-testid="status-result"]');
    expect(statusEl.getAttribute('data-status')).toMatch(/^(available|downloading|downloadable|unavailable)$/);
  }, 30_000);
});
```

**Element Waiting Helper:**

- Custom `waitForElement()` helper for async rendering
- Location: `src/app/model-status.component.spec.ts`
- Pattern for testing components with loading states:
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

## Mocking

**Framework:** TestBed for dependency injection (Angular native)

**Patterns:**

- Services are real (not mocked) — tests run against actual LanguageModel API
- Components inject real services via TestBed
- Browser APIs (LanguageModel, DOM) are real in browser context

**Example:**

```typescript
// From language-model.service.spec.ts
it('should detect whether the LanguageModel API is supported', () => {
  // In branded browsers (Chrome Canary, Edge Dev) with feature flags,
  // the API should be defined. In bundled Chromium, it won't be.
  expect(typeof service.isApiSupported).toBe('boolean');
});

it('should respond to a prompt', async () => {
  // Calls real LanguageModel.create() and session.prompt()
  const response = await service.prompt('Hello, AI!');
  expect(response).toBeTruthy();
}, 600_000);
```

**What NOT to Mock:**

- LanguageModel API — tests require real model for inference
- Browser APIs (fetch, localStorage, etc.) — tests run in real browser
- DOM manipulation — tests query and interact with real DOM

## Fixtures and Factories

**Test Data:**

- No centralized fixtures for this codebase (services return live data)
- API responses are from real LanguageModel API, not mocked
- Status checks (`checkAvailability()`) return actual browser model state

**E2E Fixture Pattern** (worker-scoped persistent context):

```typescript
export const test = base.extend<{ persistentPage: Page }, { persistentContext: BrowserContext }>({
  persistentContext: [
    async ({}, use, workerInfo) => {
      const projectName = workerInfo.project.name;
      const profile = profilesByName[projectName];

      // Seed profile with flags
      seedLocalState(profile);

      // Retry launch (ProcessSingleton on Windows may reject)
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

      // Warm up model
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
    { scope: 'worker', timeout: 10_800_000 }, // 3 hours for model warm-up
  ],

  persistentPage: async ({ persistentContext }, use) => {
    const page = persistentContext.pages()[0] || (await persistentContext.newPage());
    await use(page);
  },
});
```

Location: `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts`

## Coverage

**Requirements:** Not enforced (no coverage target configured)

**View Coverage:**

```bash
npm exec nx -- test in-browser-ai-coding-agent -- --coverage
```

Coverage runs via `@vitest/coverage-v8` when the flag is passed.

## Test Types

**Unit Tests:**

- Scope: Individual services and components
- Framework: Vitest + Angular TestBed
- Browser: Real browser (Chrome Beta or Edge Dev) with LanguageModel API
- Examples: `language-model.service.spec.ts`, `model-status.component.spec.ts`, `app.spec.ts`
- Approach:
  - Test service methods with actual model inference (not mocked)
  - Test component lifecycle and state rendering
  - Test error handling and edge cases
  - Timeouts: 30s-600s for tests involving model inference

**Integration Tests:**

- Not explicitly separated from unit tests
- Service + Component integration tested in component specs
- Example: `ModelStatusComponent` test calls `LanguageModelService.prompt()`

**E2E Tests:**

- Framework: Playwright
- Browser: Chrome Beta (Gemini Nano) + Edge Dev (Phi-4 Mini)
- Worker-scoped persistent context for profile + model warm-up
- Examples: `apps/in-browser-ai-coding-agent-e2e/src/example.spec.ts`, `prompt.spec.ts`
- Approach:
  - Full application flow (UI navigation, form submission, real inference)
  - Multi-browser coverage (2 projects in `playwright.config.ts`)
  - No retries (each retry requires full model warm-up on ARM64)
  - Custom test assertion: `test('has title', async ({ persistentPage: page }) => { ... })`

## Common Patterns

**Async Testing:**

```typescript
// Unit test with async service call
it('should respond to a prompt', async () => {
  const response = await service.prompt('Hello, AI!');
  expect(response).toBeTruthy();
}, 600_000); // 10-minute timeout for model inference

// Component test with async rendering
it('should display result after waiting', async () => {
  const fixture = TestBed.createComponent(ModelStatusComponent);
  const statusEl = await waitForElement(fixture.nativeElement, '[data-testid="status-result"]');
  expect(statusEl).toBeTruthy();
}, 30_000);

// E2E test with async navigation
test('has title', async ({ persistentPage: page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('in-browser-ai-coding-agent');
});
```

**Error Testing:**

```typescript
// Service error handling
it('should throw if API is unavailable', async () => {
  const service = new LanguageModelService();
  // Mock isApiSupported to false (via browser context setup)
  expect(service.isApiSupported).toBe(false);

  try {
    await service.prompt('test');
    expect.fail('Should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toContain('LanguageModel API is not available');
  }
});

// Component error display
it('should show error message on prompt failure', async () => {
  const fixture = TestBed.createComponent(ModelStatusComponent);
  // Simulate error scenario...
  await fixture.whenStable();
  const errorEl = fixture.nativeElement.querySelector('[data-testid="prompt-error"]');
  expect(errorEl?.textContent).toContain('error message');
});
```

**Model Warm-up Pattern:**

- Vitest setupFile: `apps/in-browser-ai-coding-agent/browser-warmup.ts`
  - Runs in test browser process (same process as tests)
  - Calls `LanguageModel.create()` + `session.prompt('warmup')` once globally
  - Preserves ONNX Runtime compilation state for all subsequent tests
  - No timeout, CI step timeout (60 min) is backstop

- E2E fixture warm-up: `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts`
  - Worker-scoped setup (runs once per worker, not per test)
  - Same warm-up pattern as Vitest
  - 3-hour timeout allows for 23-48 min cold-start on ARM64 CI

**Console Output Logging:**

- Prompts and responses logged to console for test inspection
- Format: `[context] Message\n[context-response]Content[/context-response]`
- Example from `language-model.service.spec.ts`:
  ```typescript
  console.log(`[unit] Prompt: "Hello, AI!"\n[unit-response]${response.trim()}[/unit-response]`);
  ```
- Used to capture real model output for debugging and verification

## Test Execution Flow

**Unit Tests:**

1. Vitest globalSetup: `global-setup.ts` seeds browser profiles with flags
2. Browser launch: Vitest launches Chrome Beta or Edge Dev with persistent profile
3. Vitest setupFile: `browser-warmup.ts` runs warm-up inference in test browser
4. Test execution: All test files run in the same warm browser (parallel disabled)
5. Report: Vitest reporter (default + GitHub Actions in CI)

**E2E Tests:**

1. Playwright config: `playwright.config.ts` defines 2 projects (chrome-gemini-nano, edge-phi4-mini)
2. Web server: Nx `serve` target starts dev server on port 4200
3. Fixture setup: Worker-scoped persistent context created, profile seeded, warm-up run
4. Test execution: Tests share persistent context (no close/relaunch per test)
5. Report: Playwright HTML reporter (auto-open disabled to avoid Chrome Stable conflict)

---

_Testing analysis: 2026-03-23_
