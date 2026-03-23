# In-Browser AI Coding Agent

## What This Is

An Angular 21 application that lets non-technical users describe what they want to build in plain language, and an on-device AI model (Gemini Nano in Chrome Beta, Phi-4 Mini in Edge Dev) generates HTML, CSS, and JavaScript and renders it in a live preview pane. No cloud APIs, no server-side inference — everything runs in the browser using the W3C LanguageModel (Prompt) API.

## Core Value

A non-technical user types a description of what they want and gets working, well-designed HTML/CSS/JS rendered in a preview — without needing any implementation knowledge.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. Inferred from existing codebase. -->

- Validated: LanguageModel API wrapper service with availability check, model download, and single-prompt inference — existing
- Validated: Model status display component with download progress and prompt/response UI — existing
- Validated: Dual-browser support (Chrome Beta / Gemini Nano + Edge Dev / Phi-4 Mini) with shared browser-profiles Nx lib — existing
- Validated: Vitest browser mode unit tests running real model inference in branded browsers (no mocks) — existing
- Validated: Playwright E2E tests with worker-scoped persistent context and model warm-up — existing
- Validated: CI pipeline with 4 parallel jobs (Chrome e2e, Chrome unit, Edge e2e, Edge unit) on ubuntu-latest and windows-11-arm — existing
- Validated: Profile caching, bootstrap scripts, and cold-start mitigation for CI — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Research what Gemini Nano and Phi-4 Mini can actually do for HTML/CSS/JS code generation (quality, limits, prompt strategies)
- [ ] Research multi-pass pipeline structures for small on-device models (pseudo-code to code, structured JSON output, lint/debug passes)
- [ ] Research Prompt API structured JSON output and tool calling capabilities
- [ ] Research preview rendering approach (sandboxed iframe vs Shadow DOM trade-offs)
- [ ] Research Workers for offloading LanguageModel API usage and parallelizing pipeline passes
- [ ] Research streaming capabilities of the Prompt API for progress reporting
- [ ] Dependency-injectable model service with separate implementations for Chrome (Gemini Nano) and Edge (Phi-4 Mini)
- [ ] Multi-pass code generation pipeline (research-driven structure, at minimum: prompt to pseudo-code, pseudo-code to HTML/CSS/JS)
- [ ] Prompt engineering optimized per model for generating well-structured, well-designed HTML/CSS/JS from natural language descriptions
- [ ] Split-pane UI layout (prompt input left, preview right)
- [ ] Sandboxed preview pane rendering generated HTML/CSS/JS
- [ ] Single HTML file output (inline CSS/JS), with option to split into separate files if research shows benefit
- [ ] Loading/progress indicator during code generation
- [ ] Generated output usable and well-designed enough for non-technical users
- [ ] Synthetic user prompt corpus — curated set of prompts at varying complexity (landing pages, forms, games, dashboards) for benchmarking model quality, regression testing pipeline changes, and warming CI inference cache
- [ ] CI-compatible warm-up strategy for code generation prompts (cache warm inference state between workflow runs)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- AI follow-up questions before generating — deferred to later milestone, v1 goes straight from prompt to code
- Conversation history / multi-turn editing — deferred to later milestone, v1 is single prompt to output
- Self-repair loop (generate, detect errors, auto-fix) — deferred to later milestone, lint/debug passes researched but not implemented in v1
- File persistence (File System API or in-browser storage) — deferred, no persistence in v1
- Notepod/wZed file explorer and code editor integration — deferred to later milestone, requires persistence layer first
- Parallel agent sessions — deferred, research Workers first, implement after pipeline is proven
- Cloud API fallback — explicitly excluded, the core value is fully on-device inference
- macOS support — ONNX Runtime CoreML GPU fallback issue makes it non-viable (documented in platform findings)

## Context

### Existing Codebase

The application already has a working LanguageModel API integration with model availability checking, download progress, and single-prompt inference. The CI infrastructure is mature with dual-browser testing (Chrome Beta on ubuntu-latest, Edge Dev on windows-11-arm), profile caching, and cold-start mitigation. The architecture uses Angular 21 with standalone components, signal-based reactivity, and an Nx monorepo structure.

### Model Capabilities

Two on-device models are available through the same LanguageModel API:

| Model                           | Browser     | Strengths                                    | Weaknesses                               |
| ------------------------------- | ----------- | -------------------------------------------- | ---------------------------------------- |
| Gemini Nano                     | Chrome Beta | Fast inference, fast CI                      | Likely weaker at complex code generation |
| Phi-4 Mini (3.8B, 128K context) | Edge Dev    | Stronger reasoning, NPU acceleration locally | 23-110 min cold-start on ARM64 CI        |

Research is needed to determine actual code generation quality for each model. The DI pattern will allow model-specific prompt engineering and pipeline tuning.

### CI Performance Reality

- **Chrome Beta / Gemini Nano on ubuntu-latest:** Fast warm-up (~38s), fast inference. Rapid iteration possible.
- **Edge Dev / Phi-4 Mini on windows-11-arm:** 23-110 min cold-start, limited hardware. CI verification takes hours per run. Need to research whether subsequent prompts after warm-up are faster, and whether we can warm the model with HTML/CSS/JS generation sample prompts and cache that state.

### Key References

- [W3C Prompt API spec](https://webmachinelearning.github.io/prompt-api/) — structured JSON output, tool calling
- [PhiCookBook](https://github.com/microsoft/PhiCookBook) — Phi model best practices
- [Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api)
- [Chrome Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api)
- [Edge built-in AI blog post](https://blogs.windows.com/msedgedev/2025/05/19/introducing-the-prompt-and-writing-assistance-apis/)
- [Chrome AI demos](https://chrome.dev/web-ai-demos/) and [Edge AI demos](https://microsoftedge.github.io/Demos/built-in-ai/playgrounds/prompt-api/)
- [WebNN spec](https://www.w3.org/TR/webnn/) and [samples](https://webmachinelearning.github.io/webnn-samples/)
- [web-llm](https://github.com/mlc-ai/web-llm) — reference for in-browser LLM patterns
- [Structured JSON output tracking](https://issues.chromium.org/issues/422803232)

## Constraints

- **Browser requirement**: Chrome Beta 138+ or Edge Dev 138+ with feature flags enabled — no fallback to standard browsers
- **Light GPU/NPU okay, CI has neither**: Local machine (Snapdragon X Elite) has Adreno iGPU + Hexagon NPU — ONNX Runtime (Edge/Phi-4 Mini) leverages NPU well; Chrome/Gemini Nano likely uses CPU (XNNPACK) even locally. CI runners (ubuntu-latest, windows-11-arm) have zero GPU/NPU — must fall back to pure CPU inference
- **CI time budget**: Phi-4 Mini CI runs take hours; Chrome/Gemini Nano CI is the fast feedback loop for iteration
- **On-device only**: No cloud APIs for inference — this is a hard architectural constraint, not a cost optimization
- **Model size**: Gemini Nano ~4 GB, Phi-4 Mini ~2.3 GB on disk — users must download models before first use

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision                                 | Rationale                                                                                                                          | Outcome    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Dual-model DI architecture               | Chrome and Edge have different models with different capabilities; DI allows model-specific prompt engineering and pipeline tuning | -- Pending |
| Split-pane UI layout                     | Classic code playground pattern, familiar to users, good use of screen space                                                       | -- Pending |
| Single HTML output initially             | Simplest for AI to generate consistently; can split to multi-file later if research shows benefit                                  | -- Pending |
| Research-driven multi-pass pipeline      | Small on-device models may need multiple passes (pseudo-code to code) for quality; research determines structure                   | -- Pending |
| Sandboxed preview (iframe or Shadow DOM) | Security isolation for generated code; trade-offs to be researched                                                                 | -- Pending |
| No follow-up questions in v1             | Keep v1 focused on prompt-to-code pipeline quality; follow-ups add complexity                                                      | -- Pending |
| No persistence in v1                     | Simplifies architecture; persistence (File System API, Notepod/wZed) deferred                                                      | -- Pending |

---

_Last updated: 2026-03-23 after initialization_
