# Unit Test Architecture

**Project:** in-browser-ai-coding-agent
**Date:** 2026-03-22

This document explains the unit test architecture, the reasoning behind every design decision, and the problems each solution addresses.

---

## 1. Overview

Unit tests run in **real branded browsers** (Chrome Beta and Edge Dev) via Vitest browser mode with `@vitest/browser-playwright`. This is not a convenience choice -- it is a hard requirement.

The `LanguageModel` API (formerly the Prompt API) is a browser-native API that only exists in branded Chromium builds with specific feature flags enabled. It does not exist in:

- Playwright's bundled Chromium (stripped of proprietary Google/Microsoft features)
- Node.js or JSDOM (no browser engine at all)
- Headless Chrome without the correct `--enable-features` flags

The service under test (`LanguageModelService`) calls `LanguageModel.availability()` and `LanguageModel.create()` directly on the global `LanguageModel` object. Mocking this API would defeat the purpose of the tests, which is to verify that the on-device AI model is actually accessible and functional in the browser environment that ships to users.

Vitest browser mode solves this by running test code inside a real browser page. The `@vitest/browser-playwright` provider launches a Playwright-controlled browser instance, navigates to a Vitest-served page that loads the test bundle, and executes assertions in the browser's JavaScript context. The test code has direct access to the browser's `LanguageModel` global, `DomSanitizer`, and the real DOM -- no simulation layer.

---

## 2. Browser Instances

Two browser instances are defined in `vitest.config.mts`:

| Instance             | Browser  | Channel       | Model       | Feature Flags                                              |
| -------------------- | -------- | ------------- | ----------- | ---------------------------------------------------------- |
| `chrome-gemini-nano` | Chromium | `chrome-beta` | Gemini Nano | `OptimizationGuideOnDeviceModel`, `PromptAPIForGeminiNano` |
| `edge-phi4-mini`     | Chromium | `msedge-dev`  | Phi-4 Mini  | `AIPromptAPI`, disables `OnDeviceModelPerformanceParams`   |

### Persistent Contexts

Each instance uses a **persistent context** (a Playwright concept) stored in `.playwright-profiles/<channel>`. A persistent context is a browser profile directory that preserves state across launches -- cookies, localStorage, IndexedDB, component registrations, and critically, the **downloaded AI model files**.

Without persistent contexts, each test run would need to re-download the AI model (Gemini Nano is ~80 MB; Phi-4 Mini via ONNX is ~4-6 GB). With persistent contexts, the model is downloaded once during initial profile bootstrapping and reused across all subsequent runs.

The `persistentContext` option (added in `@vitest/browser-playwright` v4.1.0) accepts a string path to the profile directory:

```typescript
provider: playwright({
  persistentContext: resolve('.playwright-profiles/chrome-beta'),
  launchOptions: { channel: 'chrome-beta', /* ... */ },
}),
```

### CI Instance Filtering

The `CI_VITEST_BROWSER_INSTANCE` environment variable filters to a single instance. In CI, each browser runs in a separate matrix job (different runners, different OS, different hardware). Locally, both instances are available:

```typescript
const filterInstance = process.env['CI_VITEST_BROWSER_INSTANCE'];
const instances = filterInstance ? allInstances.filter((i) => i.name === filterInstance) : allInstances;
```

**Why filter instead of running both?** CI runners have a single pre-bootstrapped browser profile. A Windows ARM64 runner has Edge Dev with Phi-4 Mini; a different runner has Chrome Beta with Gemini Nano. Running both on the same runner would require both browsers installed and both models downloaded, which doubles setup time and disk usage.

### No File Parallelism

```typescript
fileParallelism: false,
```

Playwright's `launchPersistentContext` binds exclusively to a profile directory. The browser creates a `lockfile` in the profile directory, and a second launch attempt against the same directory fails. Since all test files share the same persistent context, they must run sequentially. This is also correct from a hardware perspective: on-device AI inference uses a single GPU/NPU, and parallel model sessions would contend for the same compute resources.

### Playwright Default Args Override

Playwright launches Chromium with default `--disable-features` and `--disable-*` flags that break the LanguageModel API. The config removes these defaults via `ignoreDefaultArgs`:

```typescript
const AI_IGNORE_DEFAULT_ARGS = [
  PLAYWRIGHT_DISABLE_FEATURES, // contains OptimizationHints -- disables the model system
  '--disable-field-trial-config', // disables model eligibility checks
  '--disable-background-networking', // prevents model registration with Google/Microsoft servers
  '--disable-component-update', // prevents model component from being loaded
];
```

The `DISABLE_FEATURES_WITHOUT_OPT_HINTS` string re-applies all of Playwright's default disabled features except `OptimizationHints`, which is the one feature that must remain enabled for the AI model system to function in Chrome. For Edge, the equivalent is `AIPromptAPI`.

---

## 3. Global Setup

The file `global-setup.ts` is a Vitest `globalSetup` that runs in **Node.js** before any browser launches. Its purpose is to warm up the on-device AI model so that test-time inference is fast.

### Why `globalSetup` Instead of `setupFile`

The current `globalSetup` approach replaced an earlier `setupFile` approach that was tried first and rejected. Understanding why requires knowing the difference between the two Vitest hooks:

- **`setupFile`**: Runs inside the browser context (in browser mode). Has access to the DOM and browser APIs but NOT to `process.env`. Vite only exposes `VITE_`-prefixed environment variables to the browser via `import.meta.env`, so `import.meta.env.CI` is `undefined` -- making conditional CI logic impossible.
- **`globalSetup`**: Runs in Node.js before any browser launches. Has full access to `process.env` and Node.js APIs (`node:fs`, `node:path`, `playwright`).

The `setupFile` approach had two problems:

1. **No access to `process.env.CI`:** The setup needed conditional timeouts and behavior for CI vs local. In the browser context, `process.env` does not exist and `import.meta.env.CI` is undefined because `CI` is not prefixed with `VITE_`. This made it impossible to vary warm-up behavior between environments.

2. **Blocked Vitest UI for up to 5 minutes:** The setup file used a `window.__modelWarmedUp` flag to run the warm-up prompt only once across test files. But because the setup file executes synchronously before tests appear in the UI, the warm-up prompt (which can take minutes on Phi-4 Mini) blocked Vitest UI from rendering the test list. Developers stared at a blank UI with no feedback. The `globalSetup` runs before the browser even opens, so Vitest UI shows tests immediately once the browser is ready.

### Why the File Lives Outside `src/`

The `global-setup.ts` file lives at `apps/in-browser-ai-coding-agent/global-setup.ts`, not inside `src/`. This is not arbitrary. The Angular compiler (via `@angular/build` and its underlying esbuild/TypeScript pipeline) processes all `.ts` files within `src/`. The global setup imports Node.js modules (`node:fs`, `node:path`) and Playwright, which are not available in the browser and have no Angular-compatible type definitions. Placing the file inside `src/` would cause the Angular compiler to reject it with errors about unresolved modules. The file lives at the app root, alongside `vitest.config.mts`, where it is only consumed by Vitest's Node.js runtime.

### Why Warm Up?

On-device AI models have a cold-start penalty. The first inference after browser launch loads the model weights into memory (or onto the NPU/GPU), compiles the ONNX execution graph, and allocates inference buffers. For Phi-4 Mini on ARM64, this cold-start can take **11+ minutes**. Subsequent inferences are fast (seconds). Without warm-up, the first test that calls `LanguageModel.create()` would absorb the entire cold-start latency, likely timing out.

The global setup front-loads this cost: it launches the browser, navigates to `chrome://on-device-internals` (or `edge://on-device-internals`), runs a warm-up prompt, verifies the model reaches "Ready" state, and then closes the browser. When Vitest later opens the same persistent context for tests, the model is already warm.

### Execution Flow

```
1. enableInternalDebugPages(profileDir)
   - Seeds "internal_only_uis_enabled": true into Local State JSON
   - Required to access chrome://on-device-internals

2. Launch persistent context (with retry loop)
   - Up to 5 attempts, 2s delay between retries
   - Handles Chrome ProcessSingleton lock contention

3. Navigate to on-device-internals page

4. Run warm-up inference
   - page.evaluate(() => { const s = await LanguageModel.create(); await s.prompt('warmup'); s.destroy(); })
   - This triggers model loading + first inference

5. Wait for "Foundational model state: Ready"
   - Click "Model Status" tab
   - Poll for text matching /Foundational model state:\s*Ready/i
   - 600s deadline (10 minutes)
   - Handle "Not Ready For Unknown Reason" by refreshing

6. Close context
```

### The `enableInternalDebugPages()` Function

Chrome and Edge gate access to internal debug pages (like `chrome://on-device-internals`) behind a flag in the browser's `Local State` file. Without this flag, navigating to the internals page shows a blank page or an error. The function reads the `Local State` JSON from the profile directory, sets `internal_only_uis_enabled` to `true`, and writes it back:

```typescript
function enableInternalDebugPages(profileDir: string) {
  const localStatePath = join(profileDir, 'Local State');
  let state: Record<string, unknown> = {};

  if (existsSync(localStatePath)) {
    try {
      state = JSON.parse(readFileSync(localStatePath, 'utf8'));
    } catch {
      // ignore corrupt file
    }
  }

  if (!state['internal_only_uis_enabled']) {
    state['internal_only_uis_enabled'] = true;
    writeFileSync(localStatePath, JSON.stringify(state, null, 2));
  }
}
```

**Problem addressed:** Without this seed, the global setup cannot navigate to the on-device-internals page to verify model readiness. The enable gate is a browser-internal mechanism that normally requires a user to visit `chrome://flags` or `edge://flags` first.

### The Retry Loop for Chrome ProcessSingleton

On Windows, Chrome enforces single-instance access to a profile directory through a `ProcessSingleton` mechanism. It creates a `lockfile` in the user data directory using `CreateFile` with `FILE_FLAG_DELETE_ON_CLOSE`. When the lockfile exists, a second Chrome launch against the same profile exits cleanly with code 0.

The problem: after `context.close()` in a previous run (or if the CI runner reuses a workspace), child processes like `chrome_crashpad_handler` may still hold file handles that delay the lockfile's deletion. The `lockfile` enters a "delete pending" state in Windows NTFS/ReFS, where `CreateFile` with `CREATE_NEW` fails with `ERROR_ACCESS_DENIED`.

The retry loop addresses this:

```typescript
const maxAttempts = 5;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    context = await chromium.launchPersistentContext(instance.profileDir, {
      channel: instance.channel,
      headless: false,
      args: instance.args,
      ignoreDefaultArgs: AI_IGNORE_DEFAULT_ARGS,
      timeout: 60_000,
    });
    break;
  } catch (error) {
    if (attempt === maxAttempts) {
      throw error;
    }
    console.warn(`[global-setup] ${instance.name}: launch attempt ${attempt}/${maxAttempts} failed, retrying in 2s...`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}
```

Five attempts with 2-second delays gives the crashpad handler up to 10 seconds to release the lockfile. This is sufficient for both NTFS (C: drive) and ReFS (D: Dev Drive) on this machine.

### Model Status Tab Guard

The global setup clicks the "Model Status" tab on the internals page to read the model state. Container-rendered environments (like some CI setups) may not render this tab. The setup checks visibility with a 10-second timeout and bails gracefully if the tab is not found:

```typescript
if (!(await modelStatusTab.isVisible({ timeout: 10_000 }).catch(() => false))) {
  console.warn(`[global-setup] ${instance.name}: Model Status tab not found, skipping`);
  return;
}
```

### "Not Ready For Unknown Reason" Handling

Chrome occasionally reports the model as "Not Ready For Unknown Reason" -- a transient state that resolves after a page refresh. The warm-up loop detects this text and refreshes:

```typescript
const notReady = page.getByText(/Not Ready For Unknown Reason/i);

if (await notReady.isVisible({ timeout: 1_000 }).catch(() => false)) {
  console.log(`[global-setup] ${instance.name}: model not ready, refreshing...`);
  await page.reload();
  await modelStatusTab.click();
}
```

---

## 4. Model Availability Guard Tests

Both `language-model.service.spec.ts` and `model-status.component.spec.ts` contain guard tests that assert the model is in an acceptable state:

```typescript
it('should have a model that is available, downloading, or downloadable', async () => {
  const status = await service.checkAvailability();

  expect(status, `Expected model to be available, downloading, or downloadable but got "${status}". ` + 'Ensure the browser has the LanguageModel API enabled and the model profile is bootstrapped.').toMatch(/^(available|downloading|downloadable)$/);
});
```

### Problem Addressed

These guard tests were added because the original prompt tests would **time out for 120 seconds** with no indication of why. When the test environment was misconfigured (wrong browser channel, missing feature flags, profile not bootstrapped, model not downloaded), the `LanguageModel` API returned `'unavailable'` or was not defined at all. The prompt test would call `LanguageModel.create()`, which would hang or throw, and the test would eventually fail with a generic timeout message like "Element not found within 120000ms". A developer seeing this in CI had no way to diagnose the root cause without manually reproducing the failure.

The guard tests run before the prompt test (by ordering within the describe block) and fail **immediately** with a diagnostic message that tells the developer exactly what to check:

> Expected model to be available, downloading, or downloadable but got "unavailable". Ensure the browser has the LanguageModel API enabled and the model profile is bootstrapped.

The accepted statuses are:

- `available` -- model is loaded and ready for inference (expected state after warm-up)
- `downloading` -- model is actively downloading (acceptable in CI during first run)
- `downloadable` -- model can be downloaded on demand (acceptable, means the API is working)

Only `unavailable` is rejected, because it indicates a fundamental environment problem that no amount of waiting will resolve.

---

## 5. Prompt Error Detection

The component test for prompt submission uses a race pattern to detect errors immediately instead of waiting for a timeout:

```typescript
// Wait for either a response or an error -- whichever appears first
const resultEl = await waitForElement(compiled, '[data-testid="prompt-response"], [data-testid="prompt-error"]', 240_000);

const testId = resultEl.getAttribute('data-testid');

if (testId === 'prompt-error') {
  expect.fail(`Prompt failed with error: ${resultEl.textContent?.trim()}`);
}
```

### Problem Addressed

The original test only watched for `[data-testid="prompt-response"]`. When Chrome threw an `UnknownError` during model inference, the component correctly caught the error and set its `error()` signal, which rendered the `[data-testid="prompt-error"]` element in the template. But the test was blind to it -- it kept polling for `prompt-response`, which never appeared. The test timed out after 120 seconds with a generic "Element not found" message, wasting CI minutes and giving no information about the actual failure.

By querying for both selectors (`prompt-response` OR `prompt-error`) in a single CSS selector, whichever element the component renders first wins the race. If the error element appears, the test fails immediately with the actual error message from the model (e.g., `Prompt failed with error: UnknownError: Model execution failed`), providing actionable diagnostic output instead of a blind timeout.

### The `waitForElement` Helper

The helper polls the DOM every 200ms:

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

This is a manual polling approach rather than using Vitest's built-in `expect.element()` locator because the test needs to match a CSS selector that targets either of two mutually exclusive elements. The component's template conditionally renders exactly one: either the response or the error.

---

## 6. Timeouts

### Service Prompt Test: 300s

```typescript
it('should respond to a prompt', async () => {
  const response = await service.prompt('Hello, AI!');
  // ...
  expect(response).toBeTruthy();
}, 300_000);
```

### Component Prompt Test: 240s wait + 300s test-level

```typescript
it('should respond when a prompt is submitted', async () => {
  // ...
  const resultEl = await waitForElement(compiled, '[data-testid="prompt-response"], [data-testid="prompt-error"]', 240_000);
  // ...
}, 300_000);
```

### Why These Values

The 300-second (5-minute) test-level timeout and 240-second element wait accommodate the worst-case scenario: **Phi-4 Mini cold-start on ARM64 CI runners**.

Phi-4 Mini is a ~4 GB model that Edge Dev loads via ONNX Runtime. On ARM64 hardware (like the Microsoft Surface Laptop 7 with Snapdragon X Elite), the model inference pipeline includes:

1. ONNX execution graph compilation (CPU-bound, first-run cost)
2. Model weight loading into memory (~4 GB)
3. Tokenizer initialization
4. First inference pass (often slower than subsequent passes due to cache warming)

In CI, shared ARM64 runners may have slower I/O and memory bandwidth than local development machines. The global setup warm-up mitigates most of this, but if the warm-up was incomplete (e.g., skipped due to a transient error), the first inference in the test absorbs the full cold-start.

The 240-second `waitForElement` timeout is 60 seconds less than the 300-second test timeout, leaving a buffer for test setup (TestBed configuration, component creation, availability check, DOM interaction) before the element wait begins.

For non-prompt tests (availability checks, component creation), the default timeout or 30-second overrides are sufficient because they do not trigger model inference.

---

## 7. Retry and Flakiness

### Retry Configuration

```typescript
retry: process.env['CI'] ? 2 : 0,
```

Tests retry up to 2 times in CI, 0 times locally.

**Why 2 in CI:** This matches the Playwright e2e retry count set by `@nx/playwright/preset` (`nxE2EPreset` sets `retries: process.env.CI ? 2 : 0` at line 70 of `node_modules/@nx/playwright/src/utils/preset.js`). Consistency between unit and e2e retry policies avoids confusion when comparing CI results across test suites.

**Why 0 locally:** Retries mask failures during development. If a test fails locally, the developer should investigate immediately, not have the retry system silently absorb the failure.

### What Gets Retried

Vitest retries at the test function level. When a test fails, the test function re-executes within the same browser page and persistent context. The browser is NOT relaunched. This is important: the downloaded AI model and warm session state survive the retry. A retried prompt test does not re-download the model.

### GitHub Actions Reporter

```typescript
reporters: process.env['CI'] ? ['default', 'github-actions'] : ['default'],
```

The `github-actions` reporter adds annotations to the GitHub Actions job summary. Tests that fail and then pass on retry are flagged as "flaky" with permalink URLs to the source line. This surfaces flakiness that the default terminal reporter hides (Vitest's default reporter shows retried-then-passed tests as simply "passed").

**Why this was added explicitly:** The Nx Playwright preset (`nxE2EPreset`) includes `html` and `blob` reporters for e2e but does NOT include the `github-actions` reporter. The Vitest config adds it independently so that unit tests get flaky-test annotations in CI job summaries -- a capability the e2e side gets through a different mechanism (Playwright's own GitHub Actions integration).

### Trace on First Retry

```typescript
browser: {
  trace: process.env['CI'] ? 'on-first-retry' : 'off',
},
```

When a test fails and is retried for the first time, Vitest captures a Playwright trace (a `.trace.zip` file containing DOM snapshots, network requests, and console logs). This trace can be opened in Playwright's Trace Viewer for post-mortem debugging of CI failures.

**Why `on-first-retry` instead of `on`:** Capturing traces for every test adds overhead (disk I/O, memory). `on-first-retry` only captures when something goes wrong, and only on the first retry (not the second), keeping the overhead proportional to actual failures.

---

## 8. Prompt Response Logging

Both the service and component prompt tests log responses with a structured format:

```typescript
// Service test
console.log(`[unit] Prompt: "Hello, AI!"\n[unit-response]${response.trim()}[/unit-response]`);

// Component test
console.log(`[unit] Component prompt: "Hello, AI!"\n[unit-response]${responseText}[/unit-response]`);
```

### The `[unit]` Prefix

Distinguishes unit test output from e2e test output in combined CI logs. When both test suites run in the same workflow, grepping for `[unit]` isolates unit test prompt results.

### The `[unit-response]...[/unit-response]` Delimiters

**Problem addressed:** The original logging format wrapped the model response in double quotes (`"..."`). This broke the regex parser in the CI summary step because model responses routinely contain embedded quotes. A response like:

> The word "meet" has several meanings. For example, "Hello, World!" is a common greeting.

...would cause the regex to extract only `The word ` (up to the first inner quote) or match incorrectly across line boundaries. The CI summary step would show truncated or garbled responses.

The `[unit-response]...[/unit-response]` delimiters replaced the quote wrapping because:

1. **They are guaranteed not to appear in model output.** No language model will spontaneously generate `[unit-response]` or `[/unit-response]` in a conversational reply. Quotes, backticks, code blocks, and HTML tags all appear regularly in model output.
2. **Unambiguous boundary parsing.** A CI script can reliably extract everything between these markers regardless of what the model generates:

```bash
sed -n 's/.*\[unit-response\]\(.*\)\[\/unit-response\].*/\1/p' test-output.log
```

3. **The square-bracket format (`[tag]` not `<tag>`)** avoids collision with HTML or XML that the model might generate in its response.

---

## 9. Markdown Rendering

The `ModelStatusComponent` renders model responses as HTML by converting Markdown to HTML via the `marked` library and bypassing Angular's security sanitizer:

```typescript
protected readonly responseHtml = computed(() => {
  const md = this.response();

  if (!md) {
    return '';
  }

  return this.sanitizer.bypassSecurityTrustHtml(
    marked.parse(md, { async: false }) as string,
  );
});
```

### Why Markdown-to-HTML

Language models produce Markdown-formatted responses: headings, bullet lists, code blocks, bold/italic text. The `marked` library was added because rendering model responses as plain text lost all formatting and made responses hard to read in the UI. `marked` converts Markdown to HTML, and `DomSanitizer.bypassSecurityTrustHtml` tells Angular to render the HTML without escaping it.

### Why `bypassSecurityTrustHtml`

Angular's default security policy strips all HTML from `[innerHTML]` bindings to prevent XSS attacks. Since the HTML comes from a local on-device model (not user input or a remote server), the XSS risk is minimal. The content never traverses a network -- it is generated entirely within the browser process by the on-device model. The alternative -- using Angular's built-in sanitizer -- would strip code blocks, headings, and other HTML elements that `marked` produces, defeating the purpose of the Markdown conversion.

The `{ async: false }` option ensures `marked.parse()` returns a string synchronously, which is required inside a `computed()` signal (computed signals must be synchronous).

### Test Implications

The component prompt test reads `resultEl.textContent` (plain text content of the rendered HTML element), not `innerHTML`. This means the test validates that the response has content without depending on the specific HTML structure that `marked` produces. The Markdown-to-HTML conversion is tested implicitly (if `marked` fails, `textContent` would be empty or malformed).

---

## 10. Known Issues

### Phi-4 Mini Cold-Start on ARM64 CI (11+ minutes)

Phi-4 Mini's first inference after a fresh profile launch takes **11 or more minutes** on ARM64 CI runners. This is the ONNX Runtime compiling the execution graph and loading ~4 GB of model weights. The global setup warm-up mitigates this for test runs, but the warm-up itself can time out (600-second deadline) on exceptionally slow runners.

**Mitigation:** The 600-second global setup deadline and 300-second per-test timeouts accommodate this. CI matrix jobs for Edge/Phi-4 Mini are expected to be significantly slower than Chrome/Gemini Nano jobs.

**Detection:** If the global setup logs `Model warm-up skipped for edge-phi4-mini: <timeout>`, subsequent prompt tests will absorb the cold-start and likely time out. The guard tests ("should have a model that is available, downloading, or downloadable") will pass (the API is present), but the prompt test will fail with a timeout.

### Chrome ProcessSingleton on Windows

Chrome's profile locking mechanism on Windows uses a `lockfile` with `FILE_FLAG_DELETE_ON_CLOSE`. After `context.close()`, child processes (`chrome_crashpad_handler`, GPU process) may hold file handles that delay the lockfile's actual deletion. The lockfile enters a "delete pending" state where `CreateFile` with `CREATE_NEW` fails with `ERROR_ACCESS_DENIED`, causing the next launch to exit with code 0 (interpreted as "another instance owns this profile").

**Mitigation:** The global setup retry loop (5 attempts, 2-second delays). Vitest's own browser launch also benefits from the prior global setup having closed its context seconds earlier.

**Detection:** Log messages like `[global-setup] chrome-gemini-nano: launch attempt 2/5 failed, retrying in 2s...` indicate the lockfile contention is occurring. If all 5 attempts fail, the warm-up is skipped and tests may fail.

**Platform note:** This issue is specific to Windows. On macOS and Linux, Chrome uses Unix domain sockets for process singleton enforcement, which release immediately when the process exits. Edge Dev on Windows appears to have a faster crashpad shutdown path and is less affected.

### Model "Not Ready For Unknown Reason" Transient State

Chrome's on-device-internals page occasionally reports the model as "Not Ready For Unknown Reason" even when the model files are present and the API is functional. This is a transient state that typically resolves after a page refresh.

**Mitigation:** The global setup detects this text and refreshes the page:

```typescript
const notReady = page.getByText(/Not Ready For Unknown Reason/i);

if (await notReady.isVisible({ timeout: 1_000 }).catch(() => false)) {
  await page.reload();
  await modelStatusTab.click();
}
```

**Root cause:** Unknown. The state appears to be a race condition in Chrome's model registration system where the component is registered but the optimization guide service has not yet acknowledged it. It occurs more frequently after abrupt browser shutdowns (e.g., CI runner killed mid-test).

---

## Test File Summary

| File                             | Type              | Key Tests                                                                                 | Timeouts                              |
| -------------------------------- | ----------------- | ----------------------------------------------------------------------------------------- | ------------------------------------- |
| `app.spec.ts`                    | App component     | Renders title, displays model-status component                                            | Default                               |
| `language-model.service.spec.ts` | Service           | API support detection, availability guard, prompt response                                | 300s for prompt                       |
| `model-status.component.spec.ts` | Component         | Loading state, availability guard, prompt input/submit, prompt response with error racing | 30s for availability, 300s for prompt |
| `global-setup.ts`                | Warm-up (Node.js) | Model loading, first inference, ready state verification                                  | 600s deadline                         |

---

_Document date: 2026-03-22_
