# Testing Patterns

**Analysis Date:** 2026-03-20

## Test Framework

**Runners:**

- Unit Tests: Vitest 4.0.9 with Playwright browser provider
- E2E Tests: Playwright 1.36.0

**Config Files:**

- Unit tests: `apps/in-browser-ai-coding-agent/vitest.config.mts`
- E2E tests: `apps/in-browser-ai-coding-agent-e2e/playwright.config.ts`

**Assertion Library:**

- Unit Tests: Angular TestBed + Jest-compatible assertions (built into Vitest)
- E2E Tests: Playwright built-in `expect` assertions

**Run Commands:**

```bash
# All tests
npm run test              # or: pnpm nx test

# Watch mode (unit tests)
pnpm nx test -- --watch

# Coverage
pnpm nx test -- --coverage

# E2E tests
npm run e2e               # or: pnpm nx e2e

# E2E tests for specific browser
pnpm nx e2e in-browser-ai-coding-agent-e2e -- --project=chrome-gemini-nano
pnpm nx e2e in-browser-ai-coding-agent-e2e -- --project=edge-phi4-mini

# Vitest UI
pnpm nx test -- --ui
```

## Test File Organization

**Location:**

- Co-located with implementation files

**Structure:**

```
apps/in-browser-ai-coding-agent/src/app/
├── app.ts
├── app.spec.ts              # unit test
├── language-model.service.ts
├── language-model.service.spec.ts  # unit test
├── model-status.component.ts
├── model-status.component.spec.ts  # unit test
└── ...
```

**E2E Structure:**

```
apps/in-browser-ai-coding-agent-e2e/src/
├── example.spec.ts          # e2e tests
└── ...
```

**Naming:**

- Pattern: `{feature}.spec.ts` for unit tests
- Pattern: `{feature}.spec.ts` for E2E tests (same pattern, different directory)

## Test Structure

**Unit Test Suite Pattern:**

```typescript
import { TestBed } from '@angular/core/testing';
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
    const validStatuses: ModelAvailability[] = ['available', 'downloadable', 'unavailable'];
    expect(validStatuses).toContain(status);
  });
});
```

**Component Test Suite Pattern:**

```typescript
import { TestBed } from '@angular/core/testing';
import { ModelStatusComponent } from './model-status.component';

describe('ModelStatusComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModelStatusComponent],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should display a status result after checking availability', async () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const statusEl = compiled.querySelector('[data-testid="status-result"]');
    expect(statusEl).toBeTruthy();
  });
});
```

**E2E Test Pattern:**

```typescript
import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('in-browser-ai-coding-agent');
});

test('displays model availability status', async ({ page }) => {
  await page.goto('/');

  const statusEl = page.getByTestId('status-result');
  await expect(statusEl).toBeVisible({ timeout: 10_000 });
  await expect(statusEl).toHaveAttribute('data-status', /^(available|downloadable|unavailable)$/);
});
```

**Patterns:**

**Setup (beforeEach):**

- Services: `service = TestBed.inject(ClassName)`
- Components: `await TestBed.configureTestingModule({ imports: [Component] }).compileComponents()`

**Fixture Interaction:**

- Get component instance: `fixture.componentInstance`
- Detect changes: `fixture.detectChanges()`
- Wait for async: `await fixture.whenStable()`
- Query DOM: `fixture.nativeElement.querySelector(selector)`

**Teardown (afterEach):**

- Not explicitly used; TestBed cleanup is automatic

## Mocking

**Framework:** Angular TestBed (no external mocking library used)

**Service Testing Pattern (No Mocks):**

- Services tested directly against real implementation
- Async methods tested with `await`
- Example: `await service.checkAvailability()` checks actual LanguageModel API (if available)

**Component Testing Pattern (Dependency Injection):**

- Components imported with their dependencies in `configureTestingModule`
- TestBed handles dependency injection automatically
- Real services injected unless explicitly mocked

**No Mocking Example Observed:**

```typescript
// All tests use real services
beforeEach(async () => {
  await TestBed.configureTestingModule({
    imports: [ModelStatusComponent], // Component brings in real LanguageModelService
  }).compileComponents();
});
```

**What NOT to Mock:**

- Angular TestBed and fixture management
- Simple services without external dependencies (use real)
- Component lifecycle hooks (let Angular handle)

**What to Mock (if needed, not currently used):**

- HTTP calls (use HttpClientTestingModule)
- External APIs (create spy if needed)
- Browser APIs with feature detection (e.g., LanguageModel availability)

## Fixtures and Factories

**Test Data:**

- No centralized fixture library observed
- Data created inline in tests
- Type unions used as reference: `ModelAvailability[] = ['available', 'downloadable', 'unavailable']`

**Location:**

- Currently no separate fixtures directory
- Test data created within test suites

## Coverage

**Requirements:** Not enforced

**View Coverage:**

```bash
pnpm nx test -- --coverage
```

**Coverage Output:**

- Generated in coverage directory
- Vitest with v8 provider (`@vitest/coverage-v8`)

## Test Types

**Unit Tests:**

- Scope: Individual services and components
- Approach: TestBed-based, synchronous or async with `await`
- Location: `{feature}.spec.ts` co-located with implementation
- Examples: `LanguageModelService.spec.ts`, `ModelStatusComponent.spec.ts`

**Integration Tests:**

- Scope: Component + injected services
- Approach: TestBed with real service injection
- Example: `ModelStatusComponent` integration with `LanguageModelService`
- Waits for async operations with `fixture.whenStable()`

**E2E Tests:**

- Framework: Playwright 1.36.0
- Scope: Full application flow in real browser
- Location: `apps/in-browser-ai-coding-agent-e2e/src/`
- Multi-browser testing: Chrome Beta (Gemini Nano) and Edge Dev (Phi 4 Mini)
- Server setup: Automatic via `webServer` config (runs `nx run in-browser-ai-coding-agent:serve`)

## Browser Configuration (Vitest and Playwright)

**Vitest Browser Setup:**

- Provider: `@vitest/browser-playwright`
- Instances: Two browser configurations
  1. **chrome-gemini-nano**: Chrome Beta with Gemini Nano on-device AI
  2. **edge-phi4-mini**: Edge Dev with Phi 4 Mini on-device AI

**Playwright Configuration:**

- Base preset: `@nx/playwright/preset`
- Server: Automatic dev server start
- Trace: `on-first-retry` (capture trace on first test failure)

**Browser Feature Flags:**
Both Vitest and Playwright share on-device AI setup (see `vitest.config.mts` and `playwright.config.ts`):

```typescript
const DISABLE_FEATURES_WITHOUT_OPT_HINTS = '--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,...,RenderDocument';

const AI_IGNORE_DEFAULT_ARGS = [PLAYWRIGHT_DISABLE_FEATURES, '--disable-field-trial-config', '--disable-background-networking', '--disable-component-update'];
```

## Common Patterns

**Async Testing:**

```typescript
// Service async method
it('should return a valid availability status', async () => {
  const status = await service.checkAvailability();
  expect(validStatuses).toContain(status);
});

// Component with async lifecycle
it('should display status after checking', async () => {
  const fixture = TestBed.createComponent(ModelStatusComponent);
  await fixture.whenStable(); // Wait for ngOnInit async completion
  const statusEl = fixture.nativeElement.querySelector('[data-testid="status-result"]');
  expect(statusEl).toBeTruthy();
});
```

**DOM Query Patterns:**

```typescript
// Via nativeElement
const element = fixture.nativeElement.querySelector('[data-testid="status-result"]');

// Via Playwright (E2E)
const statusEl = page.getByTestId('status-result');
await expect(statusEl).toBeVisible({ timeout: 10_000 });
```

**Attribute Testing:**

```typescript
// Check data attributes
expect(statusEl?.getAttribute('data-status')).toMatch(/^(available|downloadable|unavailable)$/);

// Playwright
await expect(statusEl).toHaveAttribute('data-status', /^(available|downloadable|unavailable)$/);
```

**Loading State Testing:**

```typescript
// Don't wait for stable, check initial state
it('should show loading state initially', () => {
  const fixture = TestBed.createComponent(ModelStatusComponent);
  fixture.detectChanges(); // Detect initial changes only

  const loadingEl = fixture.nativeElement.querySelector('[data-testid="status-loading"]');
  expect(loadingEl).toBeTruthy();
});
```

## Testing Practices Observed

**Strengths:**

- Co-location of tests with source files (easy to maintain)
- Angular standalone components simplify TestBed setup
- Real service injection in component tests (true integration testing)
- Type-safe test data (unions checked against valid values)
- Multi-browser E2E testing for AI feature compatibility
- Data attributes for reliable element selection (`data-testid`)

**Gaps:**

- No fixture factories for repeated test data
- Limited error scenario testing (no negative cases visible)
- No performance or accessibility tests
- Coverage not enforced (optional)
- No test documentation/comments explaining why tests exist

---

_Testing analysis: 2026-03-20_
