# Feasibility Assessment: Consolidating E2E and Unit Tests Under One Runner

**Verdict:** MAYBE -- viable for simple E2E tests, blocked for complex navigation flows
**Confidence:** MEDIUM
**Researched:** 2026-03-22

## Summary

The most effective way to share a warm browser across test suites is to eliminate the second suite entirely. If both E2E and unit tests run under the same framework, they naturally share a single browser process. Two consolidation paths exist: move E2E tests into Vitest browser mode, or move unit tests into Playwright. Each has trade-offs.

## Option A: Move E2E Tests Into Vitest Browser Mode (Recommended Path)

### What Vitest Browser Mode Can Do

Vitest browser mode (v4.1.0) with `@vitest/browser-playwright` provides:

- Real browser execution (not jsdom)
- Playwright as the underlying browser provider
- `persistentContext` for profile-based browser sessions
- Branded browser channels (`chrome-beta`, `msedge-dev`)
- Custom launch args and `ignoreDefaultArgs`
- CDP-based user interactions (click, type, hover)
- Locator API for element queries
- `page.evaluate()` via browser commands
- Screenshot and visual regression testing
- Trace recording (Playwright traces)

### What E2E Tests Currently Do

From the project's E2E test files:

```
example.spec.ts:
  - Navigate to the app URL (baseURL)
  - Check page title
  - Check that model status element exists

prompt.spec.ts:
  - Navigate to the app URL
  - Interact with prompt input
  - Submit a prompt
  - Wait for AI response
  - Verify response content
```

These are relatively simple: navigate to app, interact with elements, verify output.

### Can Vitest Browser Mode Handle These?

| E2E Pattern             | Vitest Browser Mode Support | Notes                                                                                      |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| Navigate to app URL     | YES                         | Vitest navigates to its own test page, but `page.goto()` is available via browser commands |
| Check page elements     | YES                         | Full locator API via `@vitest/browser-playwright`                                          |
| Fill input fields       | YES                         | `userEvent.fill()` or Playwright locators                                                  |
| Click buttons           | YES                         | `userEvent.click()` or Playwright locators                                                 |
| Wait for async response | YES                         | Standard async/await + locator auto-wait                                                   |
| page.evaluate()         | YES                         | Available via browser commands                                                             |
| Persistent context      | YES                         | `persistentContext` option (v4.1.0+)                                                       |
| webServer management    | PARTIAL                     | No built-in `webServer` config like Playwright; must manage dev server externally          |

### The webServer Gap

Playwright's `playwright.config.ts` has a `webServer` option that automatically starts the dev server before tests:

```typescript
webServer: {
  command: `npx nx run app:serve -- --port=${port}`,
  url: baseURL,
  reuseExistingServer: true,
}
```

Vitest does not have an equivalent `webServer` option in its config. The test page is served by Vitest's own dev server (Vite), not by the Angular dev server.

**Workaround options:**

1. Use Vitest's `globalSetup` to start the Angular dev server before tests
2. Run `npm start` before `npm test` (CI already does this via Nx)
3. Use a Vite plugin that proxies to the Angular dev server

### Architecture if Consolidated

```
Vitest browser mode (single runner)
  |
  +-- globalSetup: start Angular dev server + warm up model
  +-- browser instances: chrome-beta, msedge-dev (persistent contexts)
  +-- test files:
        +-- service.spec.ts (unit): test LanguageModelService methods
        +-- component.spec.ts (unit): test Angular components in isolation
        +-- app-navigation.spec.ts (integration): navigate to app, verify rendering
        +-- prompt-flow.spec.ts (integration): submit prompt, verify AI response
```

All tests share one browser instance per browser type. Model warm-up happens once in globalSetup.

### Migration Effort

| Current E2E Test | Migration Complexity | Notes                                                                       |
| ---------------- | -------------------- | --------------------------------------------------------------------------- |
| example.spec.ts  | LOW                  | Simple element checks; rewrite assertions to Vitest syntax                  |
| prompt.spec.ts   | MEDIUM               | Uses persistent page fixture, AI warm-up; need to translate fixture pattern |

### Risks

1. **page navigation within Vitest**: Vitest opens tests in an iframe within its orchestrator page. Navigating away from the orchestrator URL could break Vitest's test lifecycle.
2. **No worker-scoped fixtures**: Vitest does not have Playwright's `{ scope: 'worker' }` fixture pattern. The `globalSetup` is the closest analog but runs in a separate Node.js process, not in the browser context.
3. **E2E tests test the BUILT app**: Playwright E2E tests run against the production build served by `nx serve`. Vitest browser mode runs against Vite's dev server serving test files. These are different runtime environments (dev vs. production build).

## Option B: Move Unit Tests Into Playwright

### What This Looks Like

```typescript
// unit-in-playwright.spec.ts
import { test, expect } from './fixtures';

test('LanguageModel API is supported', async ({ persistentPage }) => {
  await persistentPage.goto('http://localhost:4200');
  const isSupported = await persistentPage.evaluate(async () => {
    return typeof LanguageModel !== 'undefined' && (await LanguageModel.availability()) !== 'unavailable';
  });
  expect(isSupported).toBe(true);
});
```

### Problems

1. **No Angular testing utilities**: No `TestBed`, no component harnesses, no signal testing utilities
2. **No module isolation**: Cannot mock imports or providers
3. **No Vitest features**: No snapshot testing, no coverage, no test filtering by tags
4. **All logic runs via `page.evaluate()`**: Service methods must be called through serialized JavaScript strings
5. **No TypeScript type checking in evaluate**: Everything inside `page.evaluate()` is untyped at test time

### Verdict on Option B

**Not recommended.** Moving unit tests to Playwright sacrifices too much testing infrastructure. Vitest browser mode exists specifically to solve this problem -- it gives you real browser execution WITH test framework features.

## Option C: Hybrid -- Vitest for Everything, Playwright Only for Complex E2E

Keep both frameworks but minimize Playwright to only the tests that genuinely need multi-page navigation or production-build testing. Move everything else to Vitest.

### Current Test Distribution

| Test Type           | Count | Needs Playwright? | Reason                                                          |
| ------------------- | ----- | ----------------- | --------------------------------------------------------------- |
| API detection       | ~2    | NO                | Can run in Vitest browser mode                                  |
| Component rendering | ~2    | NO                | Vitest browser mode is designed for this                        |
| Simple navigation   | ~2    | MAYBE             | Depends on whether Vitest can navigate to the Angular app       |
| AI prompt/response  | ~2    | MAYBE             | Needs real browser + warm model -- both frameworks support this |

With only ~4-8 tests across both suites, the test count is small enough that consolidation is straightforward.

## Recommendation

**Evaluate Option A (consolidate into Vitest) for the next milestone.** The E2E tests in this project are simple enough that they likely do not need Playwright's full E2E capabilities. The main blocker is `webServer` management, which can be handled via `globalSetup`.

**Flag for deeper research:**

- Can Vitest browser mode navigate to `http://localhost:4200` (the Angular app) instead of its own test page?
- Does `page.goto()` work within a Vitest browser test, or does it break the Vitest iframe orchestrator?
- Can the Angular production build be tested through Vitest browser mode, or only the dev-server build?

## Sources

- [Vitest Browser Mode Guide](https://vitest.dev/guide/browser/)
- [Vitest Browser Mode vs Playwright | Epic Web Dev](https://www.epicweb.dev/vitest-browser-mode-vs-playwright)
- [Component Testing with Playwright and Vitest | The Candid Startup](https://www.thecandidstartup.org/2025/01/06/component-test-playwright-vitest.html)
- [Vitest Playwright Provider Configuration](https://vitest.dev/config/browser/playwright)
- [Playwright webServer Configuration](https://playwright.dev/docs/test-webserver)
