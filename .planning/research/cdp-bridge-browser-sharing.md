# Research: CDP Bridge for Browser Process Sharing

**Researched:** 2026-03-22
**Confidence:** MEDIUM
**Verdict:** Technically possible but not recommended for this project's scale

## Concept

Launch a branded browser (Chrome Beta or Edge Dev) with `--remote-debugging-port` and a persistent profile directory. Both Playwright E2E tests and Vitest unit tests connect to this running browser via Chrome DevTools Protocol (CDP). The browser stays alive across both test suites, model warm-up happens once.

## How It Would Work

### Step 1: Pre-Launch the Browser

```bash
# Launch Edge Dev with persistent profile and remote debugging
msedge-dev \
  --remote-debugging-port=9222 \
  --user-data-dir=.playwright-profiles/msedge-dev \
  --enable-features=AIPromptAPI \
  --disable-features=OnDeviceModelPerformanceParams \
  --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,...(full list)... \
  --no-first-run
```

Or via Playwright's API in a setup script:

```typescript
import { chromium } from 'playwright';

const context = await chromium.launchPersistentContext('.playwright-profiles/msedge-dev', {
  channel: 'msedge-dev',
  headless: false,
  args: [
    '--remote-debugging-port=9222',
    '--enable-features=AIPromptAPI',
    // ... all feature flags
  ],
  ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
});

// Warm up the model
const page = context.pages()[0] || (await context.newPage());
await page.goto('edge://on-device-internals');
// ... full warm-up sequence
```

### Step 2: Connect Playwright E2E Tests

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    {
      name: 'edge-phi4-mini',
      use: {
        connectOptions: {
          wsEndpoint: 'ws://127.0.0.1:9222', // CDP endpoint
        },
      },
    },
  ],
});
```

Or in fixtures:

```typescript
const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0]; // default context with persistent profile
```

### Step 3: Connect Vitest Unit Tests

Vitest's `@vitest/browser-playwright` provider does NOT support `connectOverCDP`. It only supports:

- `connectOptions.wsEndpoint` -- connects to a Playwright BrowserServer (not raw CDP)

A custom provider would be needed:

```typescript
// custom-cdp-provider.ts (hypothetical)
import { chromium } from 'playwright';

class CDPProvider {
  async openBrowser() {
    this.browser = await chromium.connectOverCDP('http://localhost:9222');
    return this.browser;
  }
}
```

## Blockers and Risks

### Blocker 1: Vitest Has No CDP Connect Path

The `@vitest/browser-playwright` provider's `openBrowser()` method only calls:

- `playwright[browserName].connect(wsEndpoint)` -- Playwright protocol, not CDP
- `playwright[browserName].launchPersistentContext()` -- local launch
- `playwright[browserName].launch()` -- local launch

There is no `connectOverCDP` path. This would require a custom provider, which is:

- "Highly experimental" API that "can change between patches"
- Missing documentation for Angular/Vitest integration
- Would need to handle context creation, page management, module mocking, and tracing

### Blocker 2: Playwright Protocol vs. CDP Protocol

`connectOverCDP` is explicitly called "lower fidelity" in Playwright's docs:

> "This connection is significantly lower fidelity than the Playwright protocol connection via browserType.connect(). If you are experiencing issues or attempting to use advanced functionality, you probably want to use browserType.connect()."

Features that may not work with CDP:

- Vitest's module mocking (route-based interception)
- Trace recording (requires Playwright protocol)
- Context creation (CDP gives you the default context only)
- `ignoreDefaultArgs` (only affects launch, not connect)

### Blocker 3: launchServer Does Not Support Persistent Context

Playwright's `browserType.launchServer()` returns a `BrowserServer` that accepts `connect()` calls. But it does NOT support a `userDataDir` parameter ([Issue #1523](https://github.com/microsoft/playwright/issues/1523), open since 2020). This means you cannot create a Playwright-protocol-compatible server with a persistent profile.

The workaround (launching manually with `--remote-debugging-port`) gives you CDP, not the Playwright protocol.

### Risk 1: Feature Flags May Not Apply

When connecting via CDP, Playwright attaches to an already-running browser. The feature flags (`--enable-features`, `--disable-features`) must be set at browser launch time, not at connection time. This is fine for the CDP bridge approach (flags are set in the pre-launch step), but it means:

- Playwright's `ignoreDefaultArgs` has no effect (defaults were already applied at launch)
- Vitest's `launchOptions.args` are ignored (browser is already running)
- Any misconfiguration in the pre-launch step cannot be corrected at connect time

### Risk 2: ProcessSingleton and Profile Locking

Only one process can use a persistent profile. The pre-launched browser holds the lock. Connecting via CDP does NOT create a new profile lock -- it attaches to the existing process. So this is actually fine for the CDP approach.

But: if the pre-launch script crashes, the lockfile may persist and block subsequent launches. The retry loop in the current fixtures handles this, but a separate pre-launch script would need its own retry logic.

### Risk 3: Browser Lifecycle Management

Who starts the browser? Who stops it?

- In CI: A dedicated setup step before test steps, teardown step after
- In local dev: Developer must remember to start the browser before running tests
- What if the browser crashes during tests? No automatic restart
- What about test isolation? Both suites share the same browser contexts and pages

### Risk 4: Context Isolation

When connecting via CDP, `browser.contexts()` returns the already-existing contexts. There is typically one default context. Both test suites would need to share this context or create new ones.

But `connectOverCDP` does not always support `browser.newContext()`:

- [Issue #15370](https://github.com/microsoft/playwright/issues/15370): "Browser context management is not supported" when connecting via CDP

This means tests cannot get isolated contexts -- they all share the default context. Test state (cookies, localStorage) leaks between tests.

## Alternative: Use Playwright run-server (Without Persistent Context)

If persistent context is NOT needed (e.g., model files are already cached and registration happens automatically), Playwright's `run-server` could work:

```bash
npx playwright run-server --port=6677 --host=127.0.0.1
```

Then:

- Vitest: `connectOptions: { wsEndpoint: 'ws://127.0.0.1:6677/' }`
- Playwright E2E: Needs config changes to use `connect()` instead of `launch()`

**Problem:** `run-server` launches browsers without persistent profiles. Each `connect()` call starts a fresh browser. Model download and registration must happen in every browser instance. This defeats the purpose of sharing a warm browser.

## Cost-Benefit Analysis

| Factor                | CDP Bridge                                                      | Current Architecture (Sequential)   |
| --------------------- | --------------------------------------------------------------- | ----------------------------------- |
| Warm-up time          | Once (12+ min)                                                  | Twice (12+ min + ~35s warm profile) |
| Time saved per CI run | ~35s (second warm-up)                                           | 0                                   |
| Implementation effort | HIGH (custom provider, pre-launch script, lifecycle management) | 0 (already works)                   |
| Maintenance burden    | HIGH (fragile, version-sensitive)                               | LOW (standard patterns)             |
| Risk of breakage      | HIGH (CDP fidelity, custom provider API changes)                | LOW                                 |
| Test isolation        | POOR (shared contexts)                                          | GOOD (separate processes)           |

The time saved (~35 seconds) does not justify the implementation and maintenance cost. The 12+ minute cold-start is the same in both approaches -- it is per-profile, not per-process. The second process launching against a warm profile takes ~35 seconds for the warm-up check, which is the irreducible minimum.

## Verdict

**Not recommended for this project.** The CDP bridge approach saves ~35 seconds per CI run at the cost of significant engineering effort and ongoing maintenance risk. The current architecture (sequential execution, shared profile directory) is the correct trade-off.

The CDP bridge becomes worthwhile only when:

1. The test suite grows to 100+ tests across both frameworks
2. The warm-up time is dominated by per-process initialization (not model loading)
3. A team is willing to maintain custom provider infrastructure

None of these conditions apply to this project today.

## Sources

- [Playwright BrowserType.connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- [Playwright Issue #1523: launchPersistentServer](https://github.com/microsoft/playwright/issues/1523)
- [Playwright Issue #15370: CDP context management](https://github.com/microsoft/playwright/issues/15370)
- [Playwright Issue #11442: Connect to existing session via CDP](https://github.com/microsoft/playwright/issues/11442)
- [How to Use Playwright with External Chrome | DEV Community](https://dev.to/sonyarianto/how-to-use-playwright-with-externalexisting-chrome-4nf1)
- [Connecting Playwright to an Existing Browser | BrowserStack](https://www.browserstack.com/guide/playwright-connect-to-existing-browser)
