# Research: Edge Dev Phi-4-mini LanguageModel API

**Researched:** 2026-03-20
**Overall confidence:** HIGH (official Microsoft docs + community sources corroborate)

## Executive Summary

Microsoft Edge Dev/Canary provides the LanguageModel API (Prompt API) powered by Phi-4-mini, but it uses **completely different flag names** than Chrome Beta's Gemini Nano implementation. The flag names in our current bootstrap script (`optimization-guide-on-device-model`, `prompt-api-for-phi-mini`) are **incorrect for Edge Dev**. Edge uses `edge-llm-*` prefixed flags for the Local State file and does NOT use the `optimization-guide-on-device-model` flag at all. Additionally, Linux is **NOT a supported platform** -- only Windows 10/11 and macOS 13.3+ are officially supported. This is likely the root cause of the bootstrap failure on both Linux containers and macOS runners.

---

## 1. Platform Availability

**Confidence:** HIGH (official Microsoft documentation)

### Supported Platforms

| Platform              | Supported | Notes                                      |
| --------------------- | --------- | ------------------------------------------ |
| Windows 10/11         | YES       | Full support, GPU required (5.5 GB VRAM)   |
| macOS 13.3+ (Ventura) | YES       | Full support, GPU required (5.5 GB VRAM)   |
| Linux                 | **NO**    | Not listed in official docs, not supported |

**Source:** [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) (updated 2026-02-04)

The official documentation explicitly states:

> "The Prompt API is currently limited to: Operating system: Windows 10 or 11 and macOS 13.3 or later."

Linux is conspicuously absent. This means:

- **Linux CI containers will never work** for Edge Dev + Phi-4-mini
- **macOS runners should work** IF hardware requirements are met
- The `edge://flags` page may show "Mac, Windows, Linux" as supported platforms for the flag itself, but the model download and inference require Windows/macOS

### Hardware Requirements

| Requirement      | Value                                         |
| ---------------- | --------------------------------------------- |
| Operating System | Windows 10/11 or macOS 13.3+                  |
| Storage          | 20 GB free on Edge profile volume             |
| GPU VRAM         | 5.5 GB or more                                |
| Network          | Unmetered connection (metered = no download)  |
| Storage floor    | Model deleted if free space drops below 10 GB |

**Implication for CI:** GitHub Actions macOS runners typically have 3-7 GB VRAM depending on the runner type. The `macos-26-intel` runner may or may not meet the 5.5 GB VRAM requirement. The performance override flag can bypass this check.

---

## 2. Required Flags (Edge Dev)

**Confidence:** HIGH (official docs + community confirmation)

### CRITICAL FINDING: Edge uses different flag names than Chrome

Edge Dev does NOT use Chrome's `optimization-guide-on-device-model` or `prompt-api-for-gemini-nano` flags. It has its own Edge-specific flags.

### Edge://flags UI Names

The flags you search for in `edge://flags/`:

| Search Term                                                 | Description                                |
| ----------------------------------------------------------- | ------------------------------------------ |
| "Prompt API for Phi mini"                                   | Enables the LanguageModel (Prompt) API     |
| "Summarization API for Phi mini"                            | Enables the Summarizer API                 |
| "Writer API for Phi mini"                                   | Enables the Writer API                     |
| "Rewriter API for Phi mini"                                 | Enables the Rewriter API                   |
| "Enable on device AI model performance parameters override" | Bypasses hardware performance requirements |
| "Enable on device AI model debug logs"                      | Enables debug logging                      |

**Source:** [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api), [AskVG](https://www.askvg.com/tip-disable-phi-4-mini-and-new-web-ai-apis-in-microsoft-edge/)

### Local State File Flag Names (for programmatic seeding)

**Confidence:** HIGH (confirmed by zoicware/RemoveWindowsAI issue #88 and community testing)

The flag identifiers stored in `Local State` -> `browser.enabled_labs_experiments` use `edge-llm-*` prefixes:

| Flag ID in Local State                         | Purpose                         | Correct Value                                                    |
| ---------------------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| `edge-llm-prompt-api-for-phi-mini@1`           | Enable Prompt API               | `@1` = Enabled                                                   |
| `edge-llm-on-device-model-performance-param@3` | Bypass performance requirements | `@3` = specific option (likely BypassPerfRequirement equivalent) |
| `edge-llm-summarization-api-for-phi-mini@1`    | Enable Summarizer API           | `@1` = Enabled                                                   |
| `edge-llm-writer-api-for-phi-mini@1`           | Enable Writer API               | `@1` = Enabled                                                   |
| `edge-llm-rewriter-api-for-phi-mini@1`         | Enable Rewriter API             | `@1` = Enabled                                                   |

### IMPORTANT: The @N suffix meaning

The `@N` suffix is a **zero-based index into the flag's dropdown options** on the `edge://flags` page:

| Suffix | Meaning (standard 3-option flags)    |
| ------ | ------------------------------------ |
| `@0`   | Default                              |
| `@1`   | Enabled                              |
| `@2`   | Disabled                             |
| `@3+`  | Additional options (varies per flag) |

**Evidence:** The zoicware/RemoveWindowsAI issue #88 uses `@2` (Disabled) for all Phi-mini flags because its purpose is to DISABLE AI features. For our bootstrap script, we need `@1` (Enabled).

**Source:** [zoicware/RemoveWindowsAI#88](https://github.com/zoicware/RemoveWindowsAI/issues/88), [Cypress issue #9440](https://github.com/cypress-io/cypress/issues/9440), [GitHub Gist on Local State flags](https://gist.github.com/vdepagter/c3a66526467c381bc0b416ca879183c8)

### What about `optimization-guide-on-device-model`?

**Confidence:** MEDIUM

Edge Dev does NOT appear to use the Chromium upstream `optimization-guide-on-device-model` flag for Phi-4-mini. This flag is specific to Chrome's Gemini Nano pipeline (which uses Chrome's optimization guide infrastructure to deliver the model). Edge has its own model delivery system.

Evidence:

- The official Microsoft Prompt API docs mention ONLY the "Prompt API for Phi mini" flag
- No Microsoft documentation references `optimization-guide-on-device-model` in the context of Edge
- The `edge-llm-on-device-model-performance-param` flag serves the role that `optimization-guide-on-device-model@2` (BypassPerfRequirement) serves in Chrome
- The zoicware list of Edge AI flags does not include `optimization-guide-on-device-model`

### What about `--enable-features` command-line equivalents?

**Confidence:** LOW (unverified -- the exact PascalCase feature names are not publicly documented)

The `--enable-features` command-line flag names for Edge's Phi-mini APIs are **not publicly documented by Microsoft**. Unlike Chrome where the feature names (e.g., `PromptAPIForGeminiNano`, `OptimizationGuideOnDeviceModel`) can be found in Chromium source code, Edge's `edge-llm-*` features are proprietary additions.

**How to discover them:**

1. Open `edge://version` and note the current command line
2. Go to `edge://flags`, enable "Prompt API for Phi mini"
3. Restart Edge, then check `edge://version` again -- the new `--enable-features` value will show the exact internal flag name

**Speculation based on naming patterns:** Edge features often use `msEdge` prefix in PascalCase. The feature name might be something like `msEdgeLLMPromptAPIForPhiMini`, but this is unverified. Our current bootstrap script uses `PromptAPIForPhiMini` which follows Chrome's naming convention but may be incorrect for Edge.

### Flags comparison: Chrome Beta vs Edge Dev

| Aspect                           | Chrome Beta (Gemini Nano)              | Edge Dev (Phi-4-mini)                          |
| -------------------------------- | -------------------------------------- | ---------------------------------------------- |
| Model                            | Gemini Nano                            | Phi-4-mini (3.5B params)                       |
| Local State flag (API)           | `prompt-api-for-gemini-nano@1`         | `edge-llm-prompt-api-for-phi-mini@1`           |
| Local State flag (perf bypass)   | `optimization-guide-on-device-model@2` | `edge-llm-on-device-model-performance-param@3` |
| `--enable-features` name (API)   | `PromptAPIForGeminiNano`               | **UNKNOWN** (not publicly documented)          |
| `--enable-features` name (model) | `OptimizationGuideOnDeviceModel`       | **NOT USED** (Edge has own delivery)           |
| Model delivery                   | Chrome Component Updater               | Edge-specific download system                  |
| Field trials dependency          | Yes (Finch)                            | **UNKNOWN** (Edge may have own system)         |
| Linux support                    | YES (Chrome Beta on Linux works)       | NO                                             |
| macOS support                    | YES                                    | YES (13.3+)                                    |
| Min GPU VRAM                     | 4 GB (with bypass)                     | 5.5 GB (with bypass flag)                      |

---

## 3. Edge Dev vs Chrome Beta Differences

**Confidence:** HIGH

### Architecture Differences

Edge and Chrome share the Chromium codebase but diverge significantly in how they deliver on-device AI:

1. **Model delivery:** Chrome uses the Optimization Guide Component Updater. Edge uses its own proprietary model download system (controlled by `GenAILocalFoundationalModelSettings` policy).

2. **Flag infrastructure:** Chrome uses upstream Chromium flag names (`optimization-guide-on-device-model`, `prompt-api-for-gemini-nano`). Edge uses custom `edge-llm-*` prefixed flags.

3. **Enterprise policy:** Edge uses `GenAILocalFoundationalModelSettings` (DWORD: 0=Allowed, 1=Disallowed). Chrome uses the same policy name with the same values.

4. **Model size:** Gemini Nano is ~1.7 GB. Phi-4-mini is significantly larger (3.5B parameters, likely 4-6 GB on disk in quantized form). This means Edge requires more storage and higher GPU VRAM.

5. **Context window:** Both are currently restricted to 9216 tokens (confirmed in [MSEdgeExplainers#1224](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1224)), even though Phi-4-mini supports 128K natively.

### Shared Playwright Blockers

The Playwright default args that block Chrome's LanguageModel API likely also block Edge's, but for potentially different reasons:

| Playwright Default                          | Blocks Chrome (Gemini Nano)     | Likely Blocks Edge (Phi-4-mini)       |
| ------------------------------------------- | ------------------------------- | ------------------------------------- |
| `--disable-field-trial-config`              | YES (breaks Finch)              | MAYBE (Edge may use own system)       |
| `--disable-component-update`                | YES (breaks model component)    | MAYBE (Edge uses own delivery)        |
| `--disable-background-networking`           | YES (breaks seed fetch)         | MAYBE (Edge needs network for model)  |
| `OptimizationHints` in `--disable-features` | YES (breaks optimization guide) | UNLIKELY (Edge doesn't use opt guide) |

**Key insight:** Since Edge does NOT use Chrome's Optimization Guide infrastructure, removing `OptimizationHints` from `--disable-features` may be irrelevant for Edge. However, removing `--disable-component-update` and `--disable-background-networking` is still likely necessary because Edge's model download system presumably needs network access and component infrastructure.

---

## 4. Playwright Automation Context

**Confidence:** MEDIUM (inference from Chrome research + Edge-specific constraints)

### Known Issues

1. **No published working example exists.** No one has publicly documented a working Playwright + Edge Dev + Phi-4-mini automation flow. The MSEdgeExplainers issues (#1012, #1224, #1198, #1206) contain no mentions of Playwright or automation.

2. **The same Playwright default args likely interfere.** Since Edge is Chromium-based, the same `--disable-field-trial-config`, `--disable-component-update`, and `--disable-background-networking` flags will affect Edge's ability to initialize its AI subsystem.

3. **The `about:blank` issue applies to Edge too.** The LanguageModel API is a Web Platform API only injected into navigated page contexts. This was confirmed for Chrome and applies equally to Edge.

4. **GPU access required.** The model runs on GPU (not NPU, even on Copilot+ PCs). Headless mode likely lacks GPU access. The `--headless=new` flag may work with GPU acceleration on some platforms, but this is unverified for Edge Dev + Phi-4-mini.

### Why Our Bootstrap Script Fails

Based on this research, the bootstrap script (`scripts/bootstrap-ai-model.mjs`) has these issues for Edge Dev:

1. **Wrong Local State flag names:**
   - Currently seeds: `optimization-guide-on-device-model@2`, `prompt-api-for-phi-mini@1`
   - Should seed: `edge-llm-prompt-api-for-phi-mini@1`, `edge-llm-on-device-model-performance-param@3`

2. **Wrong `--enable-features` value:**
   - Currently uses: `--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForPhiMini`
   - These are Chrome feature names that Edge may not recognize
   - The correct Edge `--enable-features` names are unknown/undocumented

3. **Linux is not supported:**
   - The CI matrix runs Edge Dev on `ubuntu-latest` in a container, but Linux is not a supported platform
   - This will NEVER work regardless of flags

4. **macOS GPU VRAM may be insufficient:**
   - Edge requires 5.5 GB VRAM
   - GitHub Actions macOS runners may not meet this requirement
   - The performance override flag (`edge-llm-on-device-model-performance-param@3`) should bypass this, but the flag name in our script is wrong

5. **OptimizationHints removal may be irrelevant:**
   - Edge doesn't use Chrome's Optimization Guide for Phi-4-mini
   - The `DISABLE_FEATURES_WITHOUT_OPT_HINTS` workaround in our script is solving a Chrome problem, not an Edge problem

### Recommended Fix for Bootstrap Script

For the `msedge-dev` browser configuration:

```javascript
'msedge-dev': {
    flags: [
      'edge-llm-prompt-api-for-phi-mini@1',                // Enable Prompt API
      'edge-llm-on-device-model-performance-param@3',      // Bypass performance requirements
    ],
    // --enable-features value is UNKNOWN for Edge
    // The Local State flags alone may be sufficient if we remove
    // the Playwright defaults that block networking/components
    args: ['--no-first-run', DISABLE_FEATURES_WITHOUT_OPT_HINTS],
  },
```

**CRITICAL:** The `--enable-features=PromptAPIForPhiMini` may be wrong. We need to either:

1. Discover the correct PascalCase feature name by inspecting `edge://version` after enabling the flag manually
2. Rely solely on Local State flag seeding (which does work for Chrome)
3. Remove `--enable-features` for Edge and see if Local State alone is sufficient

---

## 5. Minimum Edge Dev Version

**Confidence:** HIGH

| API                               | Minimum Edge Version |
| --------------------------------- | -------------------- |
| Prompt API                        | 138.0.3309.2         |
| Summarizer, Writer, Rewriter APIs | 138.0.3309.2         |
| Proofreader API                   | 142                  |
| Translator API                    | 143.0.3636.0         |
| Language Detector API             | 147.0.3897.0         |

The current Edge Dev channel is well past version 138, so version is not the issue.

**Source:** [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api)

---

## 6. Known Edge Dev Phi-4-mini Issues

**Confidence:** HIGH (from MSEdgeExplainers GitHub issues)

1. **Context window limited to 9216 tokens** ([#1224](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1224)) -- same as Chrome, despite Phi-4-mini's native 128K capability.

2. **Qualcomm GPU driver incompatibility** ([#1012 comment](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1012)) -- Qualcomm Adreno GPU driver version 31.0.84.0 causes "device GPU not supported" error. Requires 31.0.96.0+. Relevant for ARM64 Surface devices.

3. **Model version confusion** ([#1198](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1198)) -- Edge 142 downloads full Phi-4 instead of Phi-4-mini, regardless of model specification. This suggests Edge's model delivery is still evolving.

4. **Tool calling not supported** ([#1012 comment](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1012)) -- Despite being in the spec, tool calling is not implemented in either Edge or Chrome. Bug tracked at crbug.com/422803232.

5. **GPU-only inference** -- Edge's Phi model runs on GPU, not NPU, even on Copilot+ PCs with dedicated NPUs.

---

## 7. Enterprise Policy Control

**Confidence:** HIGH

The `GenAILocalFoundationalModelSettings` policy controls model download:

| Value                 | Effect                                             |
| --------------------- | -------------------------------------------------- |
| 0 (or not configured) | Model downloads automatically when API is used     |
| 1                     | Model is NOT downloaded; existing model is deleted |

**Registry path (Windows):** `HKLM\SOFTWARE\Policies\Microsoft\Edge\GenAILocalFoundationalModelSettings`

This policy also disables `ComponentUpdatesEnabled`, which means model downloading can be blocked at the enterprise level even if flags are enabled.

**Source:** [Microsoft Edge Policy docs](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/genailocalfoundationalmodelsettings)

---

## 8. Implications for CI Matrix

### Current CI Configuration (Broken)

```yaml
- browser: msedge-dev
  project: edge-phi4-mini
  cache-key: msedge-dev-ai-model-v1
  runner: macos-26-intel
  xvfb: ''
```

### Problems Identified

1. **macOS runner may lack GPU VRAM** -- GitHub Actions macOS Intel runners typically have limited GPU resources. The 5.5 GB VRAM requirement may not be met.

2. **Wrong flag names** -- The bootstrap script seeds Chrome-style flags, not Edge-style flags.

3. **Unknown `--enable-features` values** -- The PascalCase feature names for Edge are undocumented.

4. **Linux container is impossible** -- If the CI ever tried to run Edge Dev on Linux, it would fail because Phi-4-mini on Edge is Windows/macOS only.

### Recommended CI Strategy

**Option A: macOS Only (most viable)**

- Use `macos-latest` or `macos-26-intel` runner
- Fix Local State flag names to use `edge-llm-*` prefix
- Enable performance override flag to bypass VRAM check
- Discover correct `--enable-features` values (or omit them and rely on Local State)
- Accept that this is experimental and may be flaky

**Option B: Defer Edge Dev Testing**

- Focus CI on Chrome Beta (which works) for the LanguageModel API
- Test Edge Dev locally only
- Add Edge Dev CI later when the API stabilizes (Microsoft is still iterating on model delivery)

**Option C: Windows Runner**

- Use `windows-latest` GitHub Actions runner
- Edge Dev + Phi-4-mini is most mature on Windows
- More reliable GPU access than macOS runners
- Significantly more expensive (Windows runners cost 2x Linux)

---

## 9. Action Items

### Immediate (Fix bootstrap script)

1. **Change Local State flag names for `msedge-dev`:**
   - From: `optimization-guide-on-device-model@2`, `prompt-api-for-phi-mini@1`
   - To: `edge-llm-prompt-api-for-phi-mini@1`, `edge-llm-on-device-model-performance-param@3`

2. **Discover correct `--enable-features` names:**
   - Manually enable "Prompt API for Phi mini" in Edge Dev on a local machine
   - Check `edge://version` command line to find the PascalCase feature name
   - Or try omitting `--enable-features` entirely for Edge and relying on Local State

3. **Remove `OptimizationGuideOnDeviceModel` from Edge's `--enable-features`:**
   - This is a Chrome-only feature name that Edge doesn't use

### Short-term (Fix CI)

4. **Remove Linux/container runner for Edge Dev** -- it will never work
5. **Consider using `windows-latest` instead of `macos-26-intel`** for Edge Dev CI
6. **Add performance override flag** to bypass GPU VRAM requirements on CI

### Medium-term (Validation)

7. **File an issue on MSEdgeExplainers** asking for official documentation of:
   - The `--enable-features` PascalCase names for Phi-mini APIs
   - Whether Playwright/automation is a supported use case
   - Linux support timeline (if any)

---

## 10. The bgrins/summarizer-harness Repository

**Confidence:** N/A (does not exist)

No repository named `bgrins/summarizer-harness` was found on GitHub. The user `bgrins` (Brian Grinstead) is a Mozilla employee known for Firefox DevTools work, with no public Edge-related AI testing repos. This reference may be incorrect or the repo may be private/deleted.

---

## Sources

### Official Documentation (HIGH confidence)

- [Microsoft Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) -- Official setup guide, hardware requirements, API reference
- [Microsoft Edge Writing Assistance APIs docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/writing-assistance-apis) -- Summarizer, Writer, Rewriter APIs
- [Microsoft Edge Blog: Introducing the Prompt and Writing Assistance APIs](https://blogs.windows.com/msedgedev/2025/05/19/introducing-the-prompt-and-writing-assistance-apis/) -- Launch announcement
- [GenAILocalFoundationalModelSettings policy](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/genailocalfoundationalmodelsettings) -- Enterprise policy control

### Community Sources (MEDIUM confidence)

- [zoicware/RemoveWindowsAI#88](https://github.com/zoicware/RemoveWindowsAI/issues/88) -- Complete list of `edge-llm-*` flag identifiers
- [AskVG: Disable Phi-4-Mini in Edge](https://www.askvg.com/tip-disable-phi-4-mini-and-new-web-ai-apis-in-microsoft-edge/) -- Flag names and registry policy
- [Leopeva64 on X](https://x.com/Leopeva64/status/1923460107930632617) -- Flag name evolution (Phi3 -> Phi mini)
- [WindowsLatest: Edge Phi-4 mini](https://www.windowslatest.com/2025/05/19/microsoft-edge-could-integrate-phi-4-mini-to-enable-on-device-ai-on-windows-11/) -- Flag names from Canary 138

### GitHub Issues (HIGH confidence)

- [MSEdgeExplainers#1012](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1012) -- Prompt API feedback thread
- [MSEdgeExplainers#1224](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1224) -- 9216 token context window limitation
- [MSEdgeExplainers#1198](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1198) -- Model version confusion (Phi-4 vs Phi-4-mini)

### Related Research (for Chrome comparison)

- [Playwright chromiumSwitches.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts)
- [Puppeteer Issue #13011](https://github.com/puppeteer/puppeteer/issues/13011)
- [CEF Issue #3982](https://github.com/chromiumembedded/cef/issues/3982)
