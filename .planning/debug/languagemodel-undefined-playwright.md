---
status: awaiting_human_verify
trigger: "typeof LanguageModel === 'undefined' when Chrome Beta launched via Playwright launchPersistentContext"
created: 2026-03-20T00:00:00Z
updated: 2026-03-20T00:00:00Z
---

## Current Focus

hypothesis: ROOT CAUSE CONFIRMED - LanguageModel API is not available on about:blank pages. It requires a navigated page (HTTPS, chrome://, etc).
test: Check typeof LanguageModel on about:blank vs navigated pages
expecting: undefined on about:blank, 'function' on real pages
next_action: Fix bootstrap-ai-model.mjs to navigate to a real page before checking API

## Symptoms

expected: LanguageModel API available (typeof LanguageModel === 'function') in Playwright-launched Chrome Beta
actual: typeof LanguageModel === 'undefined'
errors: No error messages - API simply not present on window
reproduction: Run bootstrap-ai-model.mjs or any Playwright launchPersistentContext with chrome-beta channel
started: Always broken in Playwright; works fine when user launches Chrome Beta manually

## Eliminated

- hypothesis: --disable-field-trial-config prevents LanguageModel API binding creation
  evidence: Removed --disable-field-trial-config, --disable-component-update, --disable-background-networking, and OptimizationHints from --disable-features. Also added --enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano. Result still typeof LanguageModel === 'undefined' and typeof self.ai === 'undefined'
  timestamp: 2026-03-20T00:02:00Z

- hypothesis: --enable-automation causes Chrome to hide experimental APIs
  evidence: Removed --enable-automation along with other flags. Result still typeof LanguageModel === 'undefined'
  timestamp: 2026-03-20T00:03:00Z

- hypothesis: Some specific Playwright default arg suppresses LanguageModel API
  evidence: Used ignoreAllDefaultArgs=true to remove ALL Playwright default args. Only passed --no-first-run, --no-default-browser-check, --enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano. Result STILL typeof LanguageModel === 'undefined'. This eliminates ALL individual flag hypotheses.
  timestamp: 2026-03-20T00:04:00Z

## Evidence

- timestamp: 2026-03-20T00:01:00Z
  checked: bootstrap-ai-model.mjs current ignoreDefaultArgs
  found: Only removes --disable-component-update. Does not remove --disable-field-trial-config, --enable-automation, or the --disable-features string
  implication: Many Playwright default args that could suppress the API are still active

- timestamp: 2026-03-20T00:05:00Z
  checked: Playwright binary resolution for channel 'chrome-beta'
  found: Correctly resolves to C:\Program Files\Google\Chrome Beta\Application\chrome.exe (v147.0.7727.3). Command line includes --flag-switches-begin with AIPromptAPI and OnDeviceModelPerformanceParams from Local State seeding
  implication: Binary is correct, flags are correctly seeded

- timestamp: 2026-03-20T00:06:00Z
  checked: typeof LanguageModel on about:blank vs navigated pages
  found: about:blank -> 'undefined'. data: URL -> 'undefined'. chrome://version -> 'function'. https://example.com -> 'function'. New blank page -> 'undefined'. New page then navigate -> 'function'.
  implication: ROOT CAUSE - LanguageModel API is only exposed on navigated pages (HTTP/HTTPS/chrome://), NOT on about:blank. The bootstrap script and all debug tests were checking on about:blank.

## Resolution

root_cause: LanguageModel API is only available in navigated page contexts (HTTPS, chrome://, etc), NOT on about:blank. The bootstrap script evaluates typeof LanguageModel on the default about:blank page without navigating first. When user tests manually in DevTools, they are already on a navigated page.
fix: Added `await page.goto('chrome://gpu')` before evaluating LanguageModel in bootstrap-ai-model.mjs. This navigates away from about:blank to a proper page context where browser APIs are exposed.
verification: 1) Verified typeof LanguageModel is 'undefined' on about:blank, 'function' on chrome://gpu in same session. 2) Verified bootstrap-ai-model.mjs no longer reports 'no-api' -- it now reaches the availability check (returns 'unavailable' on fresh profile without model, which is expected). 3) Tested across 6 page types: about:blank=undefined, data:=undefined, chrome://version=function, https://example.com=function, new blank=undefined, new+navigate=function.
files_changed: [scripts/bootstrap-ai-model.mjs]
