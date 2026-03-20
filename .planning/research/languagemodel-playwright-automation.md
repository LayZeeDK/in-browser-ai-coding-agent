# Research: Chrome LanguageModel API in Playwright Automation

**Researched:** 2026-03-20
**Overall confidence:** HIGH (multiple sources corroborate, root causes identified)

## Executive Summary

The `LanguageModel` API (Chrome's Prompt API / Gemini Nano) being `undefined` when Chrome Beta is launched via Playwright is caused by **multiple Playwright default flags working together** to prevent the API from initializing. The single biggest blocker is `--disable-field-trial-config`, which prevents Chrome's server-side feature configuration (Finch/Variations) from activating -- and the LanguageModel API depends on this infrastructure even when flags are manually enabled. Secondary blockers include `--disable-component-update` (prevents the model component from registering) and `--disable-background-networking` (prevents the variations seed from being fetched).

This is a known, unsolved problem in the browser automation ecosystem. No one has published a fully working, reproducible Playwright or Puppeteer integration with the LanguageModel API. The Puppeteer team has made progress (removing `--disable-component-update` in PR #13201), but the fundamental issue -- that Chrome's built-in AI depends on Google-internal infrastructure that automation tools deliberately disable -- remains.

## Confirmed Working Solution (2026-03-20)

We verified the following configuration makes `LanguageModel.availability()` return `'available'` in Playwright with Chrome Beta:

1. **Use `launchPersistentContext`** with a profile containing the model files (copied from a working Chrome Beta profile)
2. **Remove four Playwright defaults** via `ignoreDefaultArgs`:
   - `--disable-features=...OptimizationHints...` (exact string match required)
   - `--disable-field-trial-config`
   - `--disable-background-networking`
   - `--disable-component-update`
3. **Replace `--disable-features`** with the same list minus `OptimizationHints`
4. **Navigate away from `about:blank`** before checking the API (see below)
5. **Seed `Local State`** with chrome://flags entries

### The `about:blank` Discovery (CRITICAL)

The `LanguageModel` global is a Web Platform API that is **only injected into navigated page contexts** (HTTPS, `chrome://`). It does NOT exist on `about:blank` or `data:` URLs. Since Playwright's default page is `about:blank`, any `page.evaluate(() => typeof LanguageModel)` on the initial page will always return `'undefined'` — regardless of flags, profiles, or command-line arguments.

| Page URL              | `typeof LanguageModel` |
| --------------------- | ---------------------- |
| `about:blank`         | `undefined`            |
| `data:text/html,...`  | `undefined`            |
| `chrome://version`    | `function`             |
| `chrome://gpu`        | `function`             |
| `https://example.com` | `function`             |

This was the initial red herring that led to hours of debugging flag combinations. The fix is simply to navigate to any real URL before checking the API. Use `chrome://gpu` for a network-free option.

---

## Root Cause Analysis

### Primary Blocker: `--disable-field-trial-config` (CRITICAL)

**Confidence:** HIGH

Chrome's built-in AI APIs are gated by server-side field trial configurations (internally called "Finch"). Every 30 minutes (or on startup), Chrome fetches a "variations seed" from Google's servers that controls which features are active. The LanguageModel API's eligibility is partially determined by this seed.

Playwright passes `--disable-field-trial-config` by default, which disables ALL field trial definitions. This means:

1. Even if `chrome://flags` are set correctly, the field trial infrastructure that the optimization guide relies on is inactive
2. The on-device model eligibility check fails because it depends on field trial parameters
3. The API global (`LanguageModel`) is never exposed to JavaScript

**Evidence:** The Chromium variations README explicitly states that `--disable-field-trial-config` "disables all field trial tests." The CEF project confirmed that "built-in AI currently depends on Google-internal (Google Chrome only) code" -- this internal code uses field trials for feature gating. Users on the chrome-ai-dev-preview-discuss group have reported "Foundational model state: Not Eligible" when field trials are disrupted.

**Source:** [Chromium Variations README](https://chromium.googlesource.com/chromium/src/+/main/testing/variations/README.md), [CEF Issue #3982](https://github.com/chromiumembedded/cef/issues/3982)

### Secondary Blocker: `--disable-component-update`

**Confidence:** HIGH

The Gemini Nano model is delivered via Chrome's component updater as the "Optimization Guide On Device Model" component. Playwright's `--disable-component-update` flag does two things:

1. Disables component updates (intended)
2. Prevents bundled components from initializing (unintended side effect)

With this flag active, the model component never registers, so `chrome://components` shows it as missing entirely. Even if you copy model files from a working profile, the component installer code never runs, so the optimization guide never discovers the model.

**Evidence:** Puppeteer issue #13011 confirmed this is a blocker. A user showed that Puppeteer-launched Chrome has 23 components vs 25 when launched normally -- the missing two are "Optimization Guide On Device Model" and "Optimization Hints." Puppeteer removed this flag from defaults in PR #13201 (October 2024), but Playwright still includes it.

**Source:** [Puppeteer Issue #13011](https://github.com/puppeteer/puppeteer/issues/13011), [Puppeteer Issue #13010](https://github.com/puppeteer/puppeteer/issues/13010)

### Tertiary Blocker: `--disable-background-networking`

**Confidence:** MEDIUM

Chrome needs background networking to:

1. Fetch the variations seed (field trial config)
2. Download the on-device model via the component updater
3. Check model eligibility with Google's optimization guide service

Playwright disables this by default. While the flags can override some behavior, the initial eligibility check may require network access to Google's servers.

**Source:** [Playwright chromiumSwitches.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts)

### Additional Factor: Google-Internal Dependencies

**Confidence:** HIGH

The built-in AI feature depends on `enable_ml_internal` and `build_with_internal_optimization_guide` GN build arguments that only ship with Google Chrome (not Chromium, not Chrome for Testing, not CEF). The critical binary `optimization_guide_internal.dll` is proprietary to Google Chrome. This means:

- Playwright's bundled Chromium will **never** support the LanguageModel API
- Only branded Chrome (Chrome Beta, Chrome Canary, Chrome Stable) can provide it
- Chrome for Testing (what Puppeteer bundles) also cannot provide it

**Source:** [CEF Issue #3982](https://github.com/chromiumembedded/cef/issues/3982)

## Complete List of Problematic Playwright Default Args

The following Playwright defaults interfere with the LanguageModel API:

| Flag                                       | Why It Blocks AI                           | Must Remove?            |
| ------------------------------------------ | ------------------------------------------ | ----------------------- |
| `--disable-field-trial-config`             | Kills all field trial feature gating       | YES (critical)          |
| `--disable-component-update`               | Prevents model component registration      | YES (critical)          |
| `--disable-background-networking`          | Prevents variations seed + model download  | YES (likely needed)     |
| `--disable-client-side-phishing-detection` | May disable optimization guide features    | MAYBE                   |
| `--disable-extensions`                     | Blocks extension origin trials for the API | Only if using extension |

The `--disable-features` list in Playwright does NOT currently include `OptimizationHints` or `OptimizationGuideModelDownloading` -- those are not set by default. But other tools (like Cypress) have been known to disable those explicitly.

**Note on `--enable-automation`:** This flag is unlikely to be a direct blocker for the API. It primarily sets `navigator.webdriver = true` and shows the automation infobar. No evidence was found that it disables the LanguageModel API specifically.

## Known Working Approach (Puppeteer, Partial)

The closest anyone has gotten is via Puppeteer with `ignoreDefaultArgs: true`:

```javascript
const browser = await puppeteer.launch({
  executablePath: '/path/to/Google Chrome Canary',
  ignoreDefaultArgs: true,
  args: [
    '--enable-features=EnableAIPromptAPI,OptimizationGuideOnDeviceModel:compatible_on_device_performance_classes/*',
    '--no-first-run',
    '--user-data-dir=/tmp/test',
    // NOTE: They KEPT --disable-fieldtrial-config here, which is suspicious
  ],
  headless: false,
  defaultViewport: null,
});
```

**However:** Even this approach required manually navigating to `chrome://components`, triggering the model download via `ai.assistant.create()` (the old API name), and waiting for the component to update. It was not a clean automated flow.

**Source:** [Puppeteer Issue #13011](https://github.com/puppeteer/puppeteer/issues/13011)

## Recommended Approach for Playwright

### Strategy 1: Maximum Flag Removal (Best Chance)

```typescript
// playwright.config.ts
{
  name: 'chrome-gemini-nano',
  use: {
    channel: 'chrome-beta',
    launchOptions: {
      headless: false, // REQUIRED - model needs GPU access
      ignoreDefaultArgs: [
        '--disable-field-trial-config',
        '--disable-component-update',
        '--disable-background-networking',
      ],
      args: [
        '--enable-features=OptimizationGuideOnDeviceModel:compatible_on_device_performance_classes/*,PromptAPIForGeminiNano',
      ],
    },
  },
}
```

**Caveat on `ignoreDefaultArgs` and `--disable-features`:** Playwright issue #22186 revealed that `ignoreDefaultArgs` does exact string matching. To remove `--disable-features`, you must pass the ENTIRE string including all values, not just `--disable-features`. PR #26705 ("Allow to filter defaultArgs by parameter name alone") may have improved this -- verify with the current Playwright version.

**Source:** [Playwright Issue #22186](https://github.com/microsoft/playwright/issues/22186)

### Strategy 2: Persistent Context with Pre-Configured Profile

Use `launchPersistentContext` with a Chrome Beta user data directory where:

1. The flags are already set via `chrome://flags` (stored in `Local State`)
2. The model is already downloaded
3. The component updater has already registered

```typescript
const context = await chromium.launchPersistentContext('/path/to/chrome-beta-profile', {
  channel: 'chrome-beta',
  headless: false,
  ignoreDefaultArgs: ['--disable-field-trial-config', '--disable-component-update', '--disable-background-networking'],
  args: ['--enable-features=OptimizationGuideOnDeviceModel:compatible_on_device_performance_classes/*,PromptAPIForGeminiNano'],
});
```

### Strategy 3: CDP Diagnostics

Use Playwright's CDP access to diagnose the exact failure point:

```typescript
const client = await page.context().newCDPSession(page);

// Check if LanguageModel exists in the actual browser context
const result = await client.send('Runtime.evaluate', {
  expression: 'typeof LanguageModel',
  awaitPromise: false,
});
console.log('LanguageModel type:', result.result.value);

// Check availability if it exists
const availability = await client.send('Runtime.evaluate', {
  expression: 'LanguageModel.availability ? LanguageModel.availability() : "API not found"',
  awaitPromise: true,
});
console.log('Availability:', availability.result.value);
```

This can help determine if the API is missing entirely vs present but returning "unavailable."

### Strategy 4: Nuclear Option - `ignoreAllDefaultArgs`

As a last resort, use `ignoreAllDefaultArgs: true` and manually reconstruct only the flags you need:

```typescript
{
  ignoreDefaultArgs: true, // removes ALL defaults
  args: [
    // Minimum required for Playwright to function
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--metrics-recording-only',
    '--password-store=basic',
    '--use-mock-keychain',
    '--export-tagged-pdf',
    // AI-specific
    '--enable-features=OptimizationGuideOnDeviceModel:compatible_on_device_performance_classes/*,PromptAPIForGeminiNano',
  ],
}
```

**Warning:** This may break Playwright's own functionality. Test thoroughly.

## The `--enable-features` Flag Names

The exact Chrome feature flag names (PascalCase, for `--enable-features`) based on research:

| chrome://flags ID                             | `--enable-features` name         | Notes                                                                            |
| --------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `optimization-guide-on-device-model`          | `OptimizationGuideOnDeviceModel` | Use with `:compatible_on_device_performance_classes/*` to bypass hardware checks |
| `prompt-api-for-gemini-nano`                  | `PromptAPIForGeminiNano`         | Confirmed from Puppeteer issue examples                                          |
| (older API name)                              | `EnableAIPromptAPI`              | May be the older feature name; seen in Puppeteer examples                        |
| `prompt-api-for-gemini-nano-multimodal-input` | Unknown PascalCase name          | For multimodal support; flag name not confirmed                                  |

**Confidence:** MEDIUM -- the exact PascalCase names are inferred from chrome://flags kebab-case IDs and confirmed by Puppeteer issue examples, but not verified against Chromium source code (the feature definitions are in Google-internal code, not public Chromium).

## User Activation Requirement

**Confidence:** HIGH

Chrome requires a user activation (click, keypress, etc.) before `LanguageModel.create()` will succeed if the model needs to be downloaded. This is checked via `UserActivation.isActive`. In Playwright, you may need to simulate a click before calling `create()`:

```typescript
await page.click('body'); // Satisfy user activation requirement
const result = await page.evaluate(async () => {
  const session = await LanguageModel.create();
  return await session.prompt('Hello');
});
```

**Source:** [Chrome AI Get Started](https://developer.chrome.com/docs/ai/get-started)

## Hardware Requirements

The model will NOT download or run if hardware requirements are not met:

- **Storage:** At least 22 GB free space on the Chrome profile volume
- **GPU:** Strictly more than 4 GB VRAM (bypassed by `BypassPerfRequirement` / `compatible_on_device_performance_classes/*`)
- **CPU:** 16 GB RAM, 4+ cores
- **Network:** Unmetered connection for initial download

The `compatible_on_device_performance_classes/*` parameter on the `OptimizationGuideOnDeviceModel` feature bypasses the GPU/performance requirements, equivalent to selecting "Enabled BypassPerfRequirement" in chrome://flags.

**Source:** [Chrome AI Get Started](https://developer.chrome.com/docs/ai/get-started), [SWyx Gemini Nano Notes](https://www.swyx.io/gemini-nano)

## Diagnostic Checklist

When debugging why `LanguageModel` is `undefined` in Playwright:

1. **Are you using branded Chrome?** Bundled Chromium and Chrome for Testing will never work.
2. **Is `--disable-field-trial-config` removed?** This is the #1 blocker.
3. **Is `--disable-component-update` removed?** Without this, the model component won't register.
4. **Is `--disable-background-networking` removed?** Needed for variations seed and model download.
5. **Are `--enable-features` set correctly?** Use `OptimizationGuideOnDeviceModel:compatible_on_device_performance_classes/*,PromptAPIForGeminiNano`.
6. **Is the model already downloaded?** Check the profile's `OptGuideOnDeviceModel` directory or use `chrome://on-device-internals`.
7. **Are you running headful?** Headless mode likely lacks GPU access needed for inference.
8. **Does `chrome://on-device-internals` show "Not Eligible"?** If so, the field trial config is the issue.
9. **Does `chrome://components` show the model component?** If missing, `--disable-component-update` is still active.
10. **Is there a user activation before `create()`?** Chrome requires a click/keypress for model download.

## Debugging via chrome:// Pages

Playwright can navigate to `chrome://` pages for diagnostics:

```typescript
// Check model status
await page.goto('chrome://on-device-internals');

// Check component registration
await page.goto('chrome://components');

// Check active features and flags
await page.goto('chrome://version');

// Check field trials
await page.goto('chrome://flags');
```

**Source:** [Debug Gemini Nano](https://developer.chrome.com/docs/ai/debug-gemini-nano)

## Why the Same Chrome Works Manually But Not Via Playwright

When you open Chrome Beta manually:

1. Chrome fetches the variations seed and activates field trials
2. The component updater registers and initializes all components
3. Background networking is active for eligibility checks
4. The optimization guide internal code runs the eligibility check successfully
5. `LanguageModel` is exposed to JavaScript

When Playwright launches the same Chrome Beta:

1. `--disable-field-trial-config` prevents field trials from activating
2. `--disable-component-update` prevents the model component from registering
3. `--disable-background-networking` prevents the variations seed fetch
4. Even with flags set in Local State, the runtime infrastructure is disabled
5. `LanguageModel` is never exposed

**Copying model files from a working profile does not help** because the component installer code must run to register the model with the optimization guide service. The files alone are not sufficient -- the runtime registration path must execute.

## Open Questions (Updated 2026-03-20)

1. **Does removing all three critical flags actually work?** **YES, CONFIRMED.** Removing `--disable-field-trial-config`, `--disable-component-update`, `--disable-background-networking`, AND replacing `--disable-features` to exclude `OptimizationHints` makes the API return `'downloading'` then `'available'` within ~5 seconds when model files are present in the profile.

2. **Is there a Chromium source-level block on automation mode?** Chrome checks for `--enable-automation` in some codepaths. It is possible (but unconfirmed) that the optimization guide checks for this flag.

3. **Will the `ignoreDefaultArgs` fix for `--disable-features` (PR #26705) help?** If `--disable-features` contains optimization-related items in newer Playwright versions, removing it by name alone may be necessary.

4. **Can `--force-field-trials` be used to manually set the right trial configuration?** Chrome supports `--force-field-trials=TrialName/GroupName` to manually activate specific field trial groups, but the exact trial name and group for built-in AI is unknown (it is Google-internal).

5. **Does the model work with CPU-only inference (no GPU)?** The `compatible_on_device_performance_classes/*` parameter suggests a CPU fallback exists, which would be important for headless/CI environments.

## Sources

- [Playwright chromiumSwitches.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts) -- Default flags source code
- [Puppeteer Issue #13011: Loading Chrome components](https://github.com/puppeteer/puppeteer/issues/13011) -- Gemini Nano component loading
- [Puppeteer Issue #13010: Stop using --disable-component-update](https://github.com/puppeteer/puppeteer/issues/13010) -- Component update removal
- [CEF Issue #3982: Chrome built-in AI feature status](https://github.com/chromiumembedded/cef/issues/3982) -- Google-internal dependency confirmation
- [Chromium Variations README](https://chromium.googlesource.com/chromium/src/+/main/testing/variations/README.md) -- Field trial config docs
- [Chrome AI Get Started](https://developer.chrome.com/docs/ai/get-started) -- Official setup guide
- [Chrome AI Model Management](https://developer.chrome.com/docs/ai/understand-built-in-model-management) -- Model lifecycle docs
- [Debug Gemini Nano](https://developer.chrome.com/docs/ai/debug-gemini-nano) -- Debugging guide
- [SWyx Gemini Nano Notes](https://www.swyx.io/gemini-nano) -- Community research
- [Playwright Issue #22186: ignoreDefaultArgs with --disable-features](https://github.com/microsoft/playwright/issues/22186) -- Flag filtering bug
- [Chrome Variations Docs](https://developer.chrome.com/docs/web-platform/chrome-variations) -- How Finch works
