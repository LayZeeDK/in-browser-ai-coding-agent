# Deep Dive: CDP Browser Sharing -- Technical Specifics and CI Patterns

**Domain:** Cross-framework browser sharing via Chrome DevTools Protocol
**Researched:** 2026-03-22
**Confidence:** HIGH (source code verified, official docs confirmed, multiple sources cross-referenced)
**Complements:** `shared-browser-across-test-suites.md`, `vitest-browser-playwright-provider-source-analysis.md`, `FEASIBILITY.md`

## Purpose

This document provides deeper technical specifics on the four questions raised about sharing browser processes across test frameworks, with evidence from source code analysis, official documentation, and community discussions.

---

## Question 1: Can Vitest Browser Mode Connect to an Existing Browser via CDP?

### Answer: No -- `connectOptions` uses Playwright protocol, not CDP.

**Source code evidence** (verified in `node_modules/@vitest/browser-playwright/dist/index.js`, lines 897-913):

```javascript
if (this.options.connectOptions) {
  let { wsEndpoint, headers = {}, ...connectOptions } = this.options.connectOptions;
  if ('x-playwright-launch-options' in headers) {
    this.project.vitest.logger.warn('Detected "x-playwright-launch-options" in connectOptions.headers. Provider config launchOptions is ignored.');
  } else {
    headers = {
      ...headers,
      'x-playwright-launch-options': JSON.stringify(launchOptions),
    };
  }
  this.browser = await playwright[this.browserName].connect(wsEndpoint, {
    ...connectOptions,
    headers,
  });
  // Returns early -- never checks persistentContext
  return this.browser;
}
```

This calls `playwright[browser].connect()`, which is the **Playwright WebSocket protocol**. This is NOT the same as `chromium.connectOverCDP()`. The two protocols are incompatible:

| Feature            | `playwright[browser].connect()` | `chromium.connectOverCDP()`             |
| ------------------ | ------------------------------- | --------------------------------------- |
| Protocol           | Playwright proprietary WS       | Chrome DevTools Protocol                |
| Server requirement | `playwright run-server` CLI     | Chrome `--remote-debugging-port`        |
| Browser support    | Chromium, Firefox, WebKit       | Chromium-only                           |
| Fidelity           | Full Playwright features        | Lower -- reduced context management     |
| Persistent context | Not supported by server         | N/A (browser already has user-data-dir) |

**There is no `connectOverCDP` configuration option in Vitest.** The only way to use CDP is:

1. Write a custom `BrowserProvider` (experimental API)
2. Use the `cdp()` export from `vitest/browser` _within_ tests (for debugging, not for connecting)

### Official Vitest Documentation

From [Vitest Playwright Configuration](https://vitest.dev/config/browser/playwright):

> **connectOptions**: These options are directly passed down to the `playwright[browser].connect` command. [...] Use `connectOptions.wsEndpoint` to connect to an existing Playwright server instead of launching browsers locally.

Note the careful wording: "Playwright server", not "existing browser". This is intentional -- it requires `playwright run-server`.

### `connectOptions` Configuration Surface

```typescript
playwright({
  connectOptions: {
    wsEndpoint: string,         // Required: Playwright server WebSocket URL
    exposeNetwork?: string,     // Optional: network exposure for Docker
    headers?: Record<string, string>,  // Optional: extra HTTP headers
    // ... other Playwright ConnectOptions
  }
})
```

The `wsEndpoint` must point to a Playwright BrowserServer instance (started via `npx playwright run-server --port 6677`), not to a Chrome DevTools Protocol endpoint (like `ws://localhost:9222/devtools/browser/<guid>`).

---

## Question 2: Can `launchPersistentContext` or `connectOverCDP` Share a Browser?

### Answer: They are mutually exclusive APIs. No built-in combination exists.

**Playwright's browser initialization APIs form three distinct paths:**

```
1. browserType.launch(options)
   --> Returns: Browser (with fresh contexts)
   --> Profile: None (ephemeral)

2. browserType.launchPersistentContext(userDataDir, options)
   --> Returns: BrowserContext (the only context)
   --> Profile: Persistent at userDataDir
   --> Note: closing this context closes the browser

3. chromium.connectOverCDP(endpointURL)
   --> Returns: Browser (with default context from running instance)
   --> Profile: Whatever --user-data-dir the running browser was launched with
   --> Note: "lower fidelity" per Playwright docs
```

**The combination gap:**

- `launchPersistentContext` **launches** a browser. It cannot connect to an existing one.
- `connectOverCDP` **connects** to a browser. It cannot specify `userDataDir` (the browser must already be running with it).
- There is no `connectToPersistentContext` or `launchPersistentServer` API.

**Playwright issue #1523** (open since 2020-02-21) requests `launchPersistentServer` -- a way to start a server with persistent context. The issue description:

> "Expose an option on the `launchServer` method to define `userDataDir` persistent storage, or expose an option on the `launchPersistentContext` method to set the LaunchType to server."

This has 30+ upvotes but no implementation. Playwright's architecture separates server and persistent context as fundamentally different modes.

### The Manual Workaround

The only way to get both "persistent profile" and "remote connection" is to **manually launch Chrome**:

```bash
chrome-beta \
  --remote-debugging-port=9222 \
  --user-data-dir=.playwright-profiles/chrome-beta \
  --enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano \
  --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,...
```

Then connect via CDP:

```typescript
const browser = await chromium.connectOverCDP('http://localhost:9222');
const defaultContext = browser.contexts()[0]; // The default context with the profile
```

**Known CDP limitations** (from [Playwright issue #15370](https://github.com/microsoft/playwright/issues/15370)):

- "Protocol error (Browser.setDownloadBehavior): Browser context management is not supported"
- `browser.newContext()` may fail -- you can only use the default context
- Page creation within the default context may fail in some scenarios
- CDP connection is "significantly lower fidelity than the Playwright protocol connection"

**This is critical for Vitest** because the provider calls `browser.newContext()` for each test file (line 1064 of the source):

```javascript
const context = this.persistentContext ?? (await browser.newContext(options));
```

If `connectOverCDP` does not support `newContext()`, Vitest would need to reuse the default context for all test files, similar to how `persistentContext` mode works. A custom provider could handle this by setting `this.persistentContext = browser.contexts()[0]`.

---

## Question 3: Patterns for Keeping a Browser Alive Across CI Steps

### Answer: Yes -- well-documented pattern. Background processes persist within a GitHub Actions job.

**Key fact:** In GitHub Actions, background processes started in one step persist until the job completes. This means launching Chrome in step 1 makes it available in steps 2, 3, etc.

### Pattern: Background Browser with Remote Debugging

```yaml
# Step 1: Launch browser in background
- name: Start Chrome Beta with remote debugging
  run: |
    # Find the Chrome Beta executable
    CHROME_BETA=$(which google-chrome-beta || echo "/usr/bin/google-chrome-beta")

    # Launch with persistent profile and CDP
    $CHROME_BETA \
      --remote-debugging-port=9222 \
      --user-data-dir=.playwright-profiles/chrome-beta \
      --enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano \
      --no-first-run \
      --no-sandbox &

    # Wait for CDP to be ready
    for i in $(seq 1 30); do
      if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
        echo "Chrome Beta CDP ready"
        break
      fi
      sleep 1
    done

# Step 2: Run E2E tests connecting via CDP
- name: Run E2E tests
  run: npm run e2e # Playwright connects via connectOverCDP

# Step 3: Run unit tests connecting to same browser
- name: Run unit tests
  run: npm test # Vitest (would need custom provider for CDP)
```

### Windows-Specific Considerations

On `windows-11-arm`, the pattern is similar but with Windows paths:

```yaml
- name: Start Edge Dev with remote debugging
  shell: bash
  run: |
    "/c/Program Files (x86)/Microsoft/Edge Dev/Application/msedge.exe" \
      --remote-debugging-port=9222 \
      --user-data-dir=.playwright-profiles/msedge-dev \
      --enable-features=AIPromptAPI \
      --disable-features=OnDeviceModelPerformanceParams \
      --no-first-run &
```

### Critical Considerations

1. **`--user-data-dir` must be absolute or a fresh path** -- relative paths in CI can resolve unexpectedly
2. **`--no-sandbox` is required on Linux CI** (GitHub Actions runners run as root)
3. **The CDP endpoint URL changes every launch** -- always fetch it from `http://localhost:9222/json/version`
4. **`ignoreDefaultArgs` cannot be applied** because we are launching Chrome directly, not through Playwright. All Playwright defaults (like `--disable-field-trial-config`, `--disable-background-networking`, `--disable-component-update`) must be explicitly NOT passed. Since we control the launch command, this is fine -- we just omit them.
5. **ProcessSingleton is satisfied** -- only one process owns the profile directory

### Why This Pattern Is Incomplete for This Project

The background browser pattern solves the **lifecycle** problem (browser stays alive across steps) but does not solve the **connection** problem for Vitest:

- Playwright E2E can connect via `connectOverCDP` (supported)
- Vitest browser mode cannot connect via CDP without a custom provider (not supported out of the box)

---

## Question 4: Does `@vitest/browser-playwright` Support Custom Providers or wsEndpoint?

### Answer: `wsEndpoint` yes (via `connectOptions`). Custom providers partially (experimental API).

### wsEndpoint Support

Vitest's Playwright provider supports `connectOptions.wsEndpoint` for connecting to remote Playwright servers. This is fully documented and stable. However, as established above, this uses the **Playwright protocol**, not CDP.

### Custom Browser Provider API

Vitest supports custom browser providers via the config:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    browser: {
      provider: myCustomProvider(),
    },
  },
});
```

The provider must implement the `BrowserProvider` interface. From the docs:

> "The custom provider API is **highly experimental** and can change between patches. If you just need to run tests in a browser, use the `browser.instances` option instead."

### Can PlaywrightBrowserProvider Be Extended?

Yes. The class is exported:

```javascript
export { PlaywrightBrowserProvider, playwright };
```

A subclass could override `openBrowser()`:

```typescript
import { PlaywrightBrowserProvider } from '@vitest/browser-playwright';

class CDPBrowserProvider extends PlaywrightBrowserProvider {
  async openBrowser(options) {
    const pw = await import('playwright');
    this.browser = await pw.chromium.connectOverCDP('http://localhost:9222');
    // Set persistentContext to the default context to avoid newContext() calls
    this.persistentContext = this.browser.contexts()[0] || null;
    this.browserPromise = null;
    return this.browser;
  }
}
```

**Risks of this approach:**

1. `PlaywrightBrowserProvider` constructor registers commands and sets up event handlers that assume specific provider behavior
2. The `mocker` (route-based module mocking) creates route handlers on `page.context()` -- unclear if this works on a CDP default context
3. Tracing (`startChunkTrace`, `stopChunkTrace`) depends on context objects having full tracing support -- CDP contexts may not
4. The `close()` method calls `this.persistentContext.close()` which may behave unexpectedly for a CDP-connected context
5. Vitest's iframe-based test runner (`data-vitest="true"`) must be compatible with CDP page creation

### The `defineBrowserProvider` Wrapper

From the source code (line 809):

```javascript
function playwright(options = {}) {
  return defineBrowserProvider({
    name: 'playwright',
    supportedBrowser: playwrightBrowsers,
    options,
    providerFactory(project) {
      return new PlaywrightBrowserProvider(project, options);
    },
  });
}
```

A custom provider would follow the same pattern:

```typescript
import { defineBrowserProvider } from '@vitest/browser';

function cdpProvider(options = {}) {
  return defineBrowserProvider({
    name: 'playwright-cdp',
    supportedBrowser: ['chromium'],
    options,
    providerFactory(project) {
      return new CDPBrowserProvider(project, options);
    },
  });
}
```

**Note:** `defineBrowserProvider` is imported from `@vitest/browser`, not `@vitest/browser-playwright`. This is a Vitest core API.

---

## Summary of Answers

| Question                                                           | Answer                                                                              | Confidence                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1. Can Vitest connect to existing browser via CDP?                 | **No.** `connectOptions` uses Playwright protocol, not CDP.                         | HIGH (source code verified)                            |
| 2. Can `launchPersistentContext`/`connectOverCDP` share a browser? | **No built-in way.** Manual Chrome launch + CDP is the workaround.                  | HIGH (Playwright API confirmed)                        |
| 3. Patterns for background browser across CI steps?                | **Yes.** Background processes persist in GitHub Actions jobs.                       | HIGH (well-documented pattern)                         |
| 4. Custom provider or wsEndpoint support?                          | **wsEndpoint yes** (Playwright protocol only). Custom provider is **experimental**. | HIGH for wsEndpoint, LOW for custom provider stability |

## Recommendation

**Do not pursue CDP-based browser sharing.** The engineering complexity is high (custom experimental provider, CDP fidelity issues, untested LanguageModel API behavior), and the current architecture already shares the persistent profile directory between frameworks. The sequential execution order (E2E warms model, unit tests reuse warm profile) is the correct approach.

**If warm-up time is still unacceptable** after optimizing the Vitest globalSetup to detect an already-warm model, the next step should be a **time-boxed spike** (2-4 hours) to:

1. Manually launch Chrome Beta with `--remote-debugging-port` + `--user-data-dir`
2. Connect via `connectOverCDP` in a standalone Node.js script
3. Verify `LanguageModel.create()` and `session.prompt()` work over CDP
4. If step 3 succeeds, evaluate the custom provider path

If step 3 fails (LanguageModel API does not work over CDP), the entire approach is dead.

## Sources

- Vitest provider source: `node_modules/@vitest/browser-playwright/dist/index.js` (v4.1.0, local)
- [Vitest Playwright Configuration](https://vitest.dev/config/browser/playwright)
- [Vitest Browser Mode Guide](https://vitest.dev/guide/browser/)
- [Vitest Custom Browser Provider](https://vitest.dev/config/browser/provider)
- [Playwright BrowserType API](https://playwright.dev/docs/api/class-browsertype)
- [Playwright issue #1523: launchPersistentServer](https://github.com/microsoft/playwright/issues/1523)
- [Playwright issue #15370: CDP context management not supported](https://github.com/microsoft/playwright/issues/15370)
- [Vitest Discussion #9306: Remote browser in Docker](https://github.com/vitest-dev/vitest/discussions/9306)
- [BrowserStack: Connecting Playwright to Existing Browser](https://www.browserstack.com/guide/playwright-connect-to-existing-browser)
- [Vitest 4.0 Release (InfoQ)](https://www.infoq.com/news/2025/12/vitest-4-browser-mode/)
- [Playwright Browser and Context Management (DeepWiki)](https://deepwiki.com/microsoft/playwright/3.1-browser-and-context-management)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [GitHub Actions: Background processes persist across steps](https://www.eliostruyf.com/devhack-running-background-service-github-actions/)
