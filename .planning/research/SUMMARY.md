# Project Research Summary

**Project:** In-Browser AI Coding Agent — v1.0 prompt-to-preview milestone
**Domain:** Browser-native AI code generation using on-device small language models
**Researched:** 2026-03-23
**Confidence:** HIGH (stack and architecture); MEDIUM-HIGH (features and pitfalls)

## Executive Summary

This milestone adds the core coding-agent loop to an existing Angular 21 app that already has model download, availability checking, and single-shot inference. The app targets two on-device small language models: Gemini Nano (~3.25B params, Chrome Beta, ~6,144 token context) and Phi-4 Mini (3.8B params, Edge Dev, 9,216 token API-imposed cap). The recommended approach is a two-pass pipeline: a structured JSON planning pass using `responseConstraint` forces even the smallest model to produce a coherent page specification before the code generation pass runs. A deterministic third pass (DOMParser truncation detection, no AI tokens consumed) validates output before rendering. Every feature in the milestone is implementable with zero new npm dependencies — the entire stack is the W3C LanguageModel API, Angular 21 primitives, and browser platform APIs already present in the project.

The primary competitive angle is privacy and cost: 100% on-device inference means no data leaves the device, no account is required, and there is zero marginal cost per generation. This is the opposite of every cloud tool (v0.dev, bolt.new, Lovable), whose 128K–200K context windows and GPT-4-class models cannot be matched at this model size. The correct positioning is a privacy-first, offline-capable tool for simple static pages — not a competitor on output quality for complex applications. Prompt templates solve the blank-canvas problem for non-technical users and naturally scope prompts to tasks the models handle reliably.

The critical risks are all manageable with known patterns. The anchor-session pattern (keep one empty session alive at all times) prevents costly model cold-starts between pipeline passes. The sandboxed iframe pattern (`sandbox="allow-scripts"` without `allow-same-origin`, blob URL, not `srcdoc`) isolates generated code in an opaque null origin. Cumulative streaming semantics (`promptStreaming()` emits the full response so far per chunk, not deltas) is a non-obvious API behaviour that must be handled correctly from the first pass. Angular's NG0910 error enforces static `sandbox` attributes on iframes, which directly reinforces the security requirement. Build order matters: the abstract `ModelService` DI token must come before the pipeline, because it defines the contract that all pipeline code programs against.

---

## Key Findings

### Recommended Stack

The existing stack — Angular 21, TypeScript, RxJS, `@types/dom-chromium-ai@^0.0.15`, `marked@^17.0.5` — covers every v1.0 feature without additions. All inference goes through the W3C LanguageModel (Prompt) API, which is already typed and partially exercised in the codebase. The deliberate no-new-dependencies constraint is correct: `angular-split` has no Angular 21 release, Monaco/CodeMirror is multi-megabyte overkill for a read-only display, DOMPurify is unnecessary when the iframe sandbox already provides origin isolation, and JSON repair libraries are futile given that `responseConstraint` enforces schema compliance at the inference engine level. Tailwind CSS v4 Play CDN is the one recommended addition — injected as a `<script>` tag into the generated HTML string, not as a build dependency, because LLMs produce utility classes more reliably than hand-crafted CSS property names.

**Core technologies:**

- W3C LanguageModel API (`session.prompt`, `session.promptStreaming`, `responseConstraint`, `session.clone`) — two-pass inference pipeline; already typed by `@types/dom-chromium-ai@^0.0.15`; must run on main thread only (`[Exposed=Window]`)
- Angular 21 signals + `computed()` — reactive pipeline state without RxJS; `OnPush` change detection handles streaming token updates at ~5–20 signal writes/second automatically
- `Blob` + `URL.createObjectURL` + `<iframe sandbox="allow-scripts">` — sandboxed preview with opaque null origin; blob URLs bypass parent CSP for inline scripts, which `srcdoc` does not
- `DOMParser.parseFromString()` — deterministic truncation detection and structural validation; no AI tokens consumed
- `navigator.clipboard.writeText()` / `<a download>` — clipboard copy and HTML file download; both Baseline Available since 2025
- Custom CSS Grid split-pane component (~60 lines, pointer events for drag-to-resize) — no `angular-split` dependency needed for a three-pane layout
- `@tailwindcss/browser@4` CDN (injected into generated HTML, not an app dependency) — LLMs generate Tailwind utility classes reliably; no build step needed in generated output

**Critical API details:**

- `promptStreaming()` yields the full accumulated response per chunk, not deltas — this is opposite to every other LLM streaming API; assign each chunk directly to the signal, never concatenate
- `responseConstraint` is reliable for small metadata schemas (outline pass); unreliable for HTML-in-JSON (code generation pass) — keep it to 2–3 levels of nesting, `object`/`array`/`string`/`boolean`/`number`/`maxItems`/`required` only
- `topK` and `temperature` are deprecated in web-page contexts — omit them
- `omitResponseConstraintInput: true` saves context tokens on Gemini Nano by not counting the schema against the context window

### Expected Features

The feature set is fully defined by the dependency graph: the abstract model service must exist before the pipeline, and the pipeline must exist before the preview, prompt templates, or export features.

**Must have (table stakes):**

- Natural-language prompt textarea + submit button — the product entry point
- Live sandboxed preview of generated HTML/CSS/JS — expected by every comparable tool (v0.dev, bolt.new, CodePen)
- Loading/progress indicator — streaming tokens are the primary indicator; spinner covers non-streaming phases
- Error messages in plain English for all failure modes — trust-critical for non-technical users (`QuotaExceededError`, `NotSupportedError`, `InvalidStateError`, truncation, malformed output)
- Copy to clipboard — minimum viable export
- Download as .html file — minimum viable persistence
- Model download/status indicator — already exists, must remain prominent

**Should have (competitive differentiators):**

- Multi-pass pipeline (JSON planning pass + streaming code generation pass) — SCoT research shows up to 13.79% Pass@1 improvement; the core quality lever for small models
- 100% on-device inference positioning in UI copy — the #1 differentiator vs. every cloud tool
- Streaming token display during code generation — eliminates blank-screen anxiety during 10–60s generation
- Prompt templates (8 curated examples spanning simple to medium complexity) — solves the blank canvas problem for non-technical users
- Per-model prompt engineering via Angular DI abstraction — Gemini Nano needs short, constrained prompts; Phi-4 Mini tolerates N-shot HTML examples
- Structured JSON planning pass with `responseConstraint` — forces coherent structure before code generation
- Truncation detection + user-friendly error — small models hit output budget frequently; cloud tools rarely truncate
- Viewport toggle (375px mobile / 1280px desktop) — demonstrates responsive output; low effort once preview exists
- Abort/cancel button wired to `AbortController` — required for Phi-4 Mini where inference takes 2+ minutes

**Defer to v1.x (post-validation):**

- Self-repair loop (detect structural errors, re-prompt with error context) — consumes tokens from a tight budget; add only if baseline quality is insufficient
- Syntax highlighting (Prism.js ~11KB) — developer appeal; wrong priority for the non-technical target audience
- Prompt augmentation (rewrite user's prompt before sending)

**Defer to v2+:**

- Conversation history / iterative refinement — Gemini Nano's 6K total context cannot support multi-turn history without degrading output quality
- Code editor integration (Monaco/CodeMirror) — wrong audience; 2MB+ bundle
- Image-to-code — requires vision-capable on-device models, not yet available
- File persistence (File System API)
- Parallel Web Worker inference — LanguageModel API is `[Exposed=Window]` only; no Worker support exists or is planned

### Architecture Approach

The architecture separates into three clear layers: a model abstraction layer (`ModelService` abstract class + browser-specific implementations), a pipeline orchestration layer (`CodeGenerationPipelineService` + `CodeExtractorService`), and a UI layer (`CodingAgentComponent` with three panes). All pipeline state lives as Angular signals in the service layer; UI components are pure reactive consumers. The new route `/agent` is lazy-loaded, keeping the initial bundle small. The existing `LanguageModelService` (availability, download) is left untouched — it serves a different concern and must not be merged with the new `ModelService`.

**Major components:**

1. `ModelService` (abstract class + `GeminiNanoModelService` + `Phi4MiniModelService` + `model.providers.ts`) — DI token hiding which model is running; the only place that reads `navigator.userAgent`; holds the anchor session to prevent model unloads between generations
2. `CodeGenerationPipelineService` — orchestrates the two-pass pipeline; owns all pipeline signals (`phase`, `streamingTokens`, `generatedCode`, `outline`, `error`, `isRunning`); handles abort propagation via `AbortController`
3. `CodeExtractorService` — pure TypeScript, no Angular dependencies; parses markdown code fences (strict/loose/raw three-tier fallback), detects truncation via tag-balance and `</html>` check; independently unit-testable without a browser
4. `CodingAgentComponent` + panes (`PromptInputPaneComponent`, `CodeViewPaneComponent`, `PreviewPaneComponent`, `PipelineProgressComponent`) — 3-pane CSS Grid layout; pure signal consumers; no direct model or session access
5. `PreviewPaneComponent` — manages blob URL lifecycle (create, revoke-on-update, revoke-on-destroy); injects error-capture `postMessage` script; caches `DomSanitizer.bypassSecurityTrustResourceUrl()` result in `computed()` to prevent iframe flicker

**Key patterns:**

- Abstract class DI token (not interface — interfaces are erased at runtime) with factory provider detecting browser at startup via `navigator.userAgent`
- Anchor session (never destroyed while app is open) + create-per-pass sessions (destroyed after each pass) — passes need different system prompts so `clone()` is not used for pass isolation
- `promptStreaming()` to signal bridge — each chunk is the full response so far; assign directly to signal (`signal.set(chunk)`), never concatenate
- Static `sandbox="allow-scripts"` attribute on iframe (Angular NG0910 enforces this) + blob URL (not `srcdoc`) for opaque-origin isolation independent of parent CSP
- `bypassSecurityTrustResourceUrl()` result cached in `computed()` — uncached calls reload the iframe on every change detection cycle

### Critical Pitfalls

1. **`sandbox="allow-scripts" allow-same-origin` combination completely nullifies iframe security** — Blob URLs inherit the creator's origin; with both flags, iframe scripts can remove the sandbox attribute, access parent DOM, and exfiltrate data. Open-WebUI had a real stored XSS from this exact mistake (GHSA-vjm7-m4xh-7wrc). Use `sandbox="allow-scripts"` only, always. Angular NG0910 prevents dynamic sandbox binding and is a direct enforcement mechanism.

2. **`promptStreaming()` is cumulative, not delta** — Each chunk is the full response accumulated so far, not a new-token delta. All other LLM streaming APIs (OpenAI, Anthropic, WebLLM) are delta-based. Developers bring that expectation and write concatenation logic, producing doubled, tripled output in the code pane. Assign each chunk directly: `signal.set(chunk)`.

3. **`session.destroy()` triggers model unload; cold-starts cost 23–110 minutes on ARM64** — Destroying all sessions signals the browser to unload the model after ~1 minute. Each pipeline pass needs a different system prompt, so sessions cannot be cloned for pass isolation. Correct pattern: keep a persistent anchor session alive, create fresh sessions per pass with the appropriate system prompt, destroy pass sessions after use.

4. **Context window caps are far below advertised model limits** — Phi-4 Mini's model card says 128K; the Edge API enforces 9,216. Gemini Nano's usable window is ~4,096–6,000 tokens total (input + output combined). Never hardcode token budgets. Query `session.contextWindow` at runtime. Budget: system prompt under 300 tokens, pass output needs minimum 2,000 tokens headroom.

5. **Angular NG0910: `sandbox` must be a static attribute, not a property binding** — `<iframe [sandbox]="value">` and `<iframe [attr.sandbox]="value">` both throw NG0910 at runtime. Use `<iframe sandbox="allow-scripts" [src]="safeBlobUrl()">`. Use `@if`/`@switch` to render different `<iframe>` elements with different static sandbox values if conditional configurations are ever needed.

---

## Implications for Roadmap

Based on dependency analysis across all four research files, the suggested phase structure has four phases. The dependency graph enforces a strict bottom-up build order: DI contract before pipeline, pipeline before UI, preview security locked in before AI output reaches the rendering layer.

### Phase 1: Model Abstraction Layer

**Rationale:** The abstract `ModelService` DI token defines the contract that the pipeline, tests, and UI all program against. Building it first means every subsequent layer can be developed and tested against a stable interface with mock implementations. Chrome Beta must come first: Gemini Nano warms up in ~20 seconds vs. 23+ minutes for Phi-4 Mini on ARM64 CI, making it the fast iteration loop throughout all phases.

**Delivers:** `ModelService` abstract class, `GeminiNanoModelService`, `Phi4MiniModelService`, `model.providers.ts` factory (browser detection via `navigator.userAgent`), anchor session management, per-model system prompt constants, `provideModelService()` registered in `app.config.ts`.

**Addresses:** Per-model DI architecture (FEATURES P0), per-model prompt engineering (FEATURES P0)

**Avoids:** Worker architecture mistake (Pitfall 3 — LanguageModel API is `[Exposed=Window]` only), model unload between pipeline passes (Pitfall 4 — anchor session lives in this layer), hardcoded token budgets (Pitfall 2 — `contextWindow` property queried at runtime from concrete service)

**Research flag:** Standard patterns — Angular abstract class DI is well-documented. No phase research needed.

### Phase 2: Generation Pipeline and Sandboxed Preview

**Rationale:** The pipeline is the core product capability. `CodeExtractorService` must be built first because it has no Angular dependencies and can be validated with plain Vitest (no browser needed). `PreviewPaneComponent` can be developed in isolation with hardcoded HTML to validate the sandbox security model before connecting to live AI output. The pipeline service completes this phase by wiring the two-pass flow and owning all reactive state. Preview security is locked in this phase, before any AI output touches the rendering layer.

**Delivers:** `CodeExtractorService` (markdown parsing, truncation detection, three-tier code block extraction), `CodeGenerationPipelineService` (two-pass orchestration, signal state: `phase`/`streamingTokens`/`generatedCode`/`outline`/`error`/`isRunning`, abort handling, streaming bridge), `PreviewPaneComponent` (blob URL lifecycle, `DomSanitizer` caching in `computed()`, error-capture `postMessage` injection, CSP meta tag injection into generated HTML), pipeline type definitions (`PipelinePhase`, `GeneratedCode`, `PageOutline`), `/agent` lazy-loaded route stub.

**Addresses:** Multi-pass pipeline (FEATURES P0), structured JSON planning pass (FEATURES P0), streaming token display (FEATURES P0), sandboxed preview (FEATURES P0), truncation detection (FEATURES P0), error feedback (FEATURES P0)

**Avoids:** `allow-scripts` + `allow-same-origin` security hole (Pitfall 1 — `sandbox="allow-scripts"` static attribute, no `allow-same-origin` ever), cumulative streaming mishandled (Pitfall 6 — direct assignment in streaming bridge), `responseConstraint` used for full HTML output (Pitfall 7 — constraint only for planning pass metadata), context overflow across passes (Pitfall 10 — fresh session per pass with appropriate system prompt), Angular NG0910 (Pitfall 11 — static sandbox attribute), blob URL memory leak (Pitfall 18 — revoke-on-update in `PreviewPaneComponent`), prompt injection via CSP meta tag injection (Pitfall 8)

**Research flag:** The `responseConstraint` planning schema reliability (Pitfall 7) warrants early empirical testing before finalising schema complexity. The API is documented but small-model reliability with complex nested schemas is LOW confidence. Start with a minimal schema (2–3 fields) and validate parse success rate before adding depth. No pre-phase research needed, but build empirical validation into the phase work.

### Phase 3: Split-Pane UI and Prompt Engineering

**Rationale:** UI assembly requires the full end-to-end pipeline to be wired before it can be assembled. Prompt engineering specifically requires a running Chrome Beta loop (~20s per iteration) with a live preview to evaluate output quality — it cannot be done against stubs. All Phase 3 features (prompt templates, viewport toggle, copy/download, abort UX, input sanitization) are independent of each other once the split-pane host component exists and can be built in parallel.

**Delivers:** `CodingAgentComponent` (3-pane CSS Grid layout, pipeline wiring, abort button), `PromptInputPaneComponent` (textarea, template selector, disabled-during-generation state, input sanitization: strip HTML, cap at 500 chars, strip control chars), `CodeViewPaneComponent` (streaming token display, final code view), `PipelineProgressComponent` (step indicators: Outlining / Generating / Rendering), prompt templates (8 curated examples), viewport toggle (375px / 1280px), copy to clipboard, download as HTML, abort button with 500ms cooldown after cancel.

**Addresses:** Natural-language prompt textarea (FEATURES P0), prompt templates (FEATURES P0), copy/download (FEATURES P0), viewport toggle (FEATURES P1), error messages for non-technical users (FEATURES P0), abort support

**Avoids:** Prompt injection via user input (Pitfall 8 — input sanitization layer), CSS design quality degradation (Pitfall 14 — system prompt design instructions, base CSS variables), semantic errors from over-ambitious tasks (Pitfall 9 — templates scope prompts to achievable complexity), abort-then-prompt latency (Pitfall 12 — 500ms cooldown in stop button)

**Research flag:** Prompt engineering for small models generating HTML is MEDIUM confidence (model-specific behaviour needs empirical measurement). Budget 2–3 iteration days explicitly for system prompt tuning on Chrome Beta, then Edge Dev verification after Chrome prompts are satisfactory. Do not block on Edge's 23-min warm-up during the iteration loop.

### Phase 4: Quality Hardening

**Rationale:** This phase stabilises what Phase 3 delivers. Test infrastructure for AI output requires structural assertions (well-formed HTML, expected elements, no browser console errors) not snapshot tests. CI warm-up needs to use the real system prompt after it stabilises in Phase 3. Token budget monitoring and cross-browser verification complete the production-readiness story.

**Delivers:** Synthetic prompt corpus (TypeScript data files, 20–30 prompts across complexity tiers), structural test assertions (DOMParser validation, `<!DOCTYPE html>` presence, `<style>` block, no console errors — not string matching), CI warm-up updated to use actual system prompt from pipeline, token budget monitoring (`session.contextUsage` / `session.contextWindow` logging), cross-browser verification (Edge/Phi-4 Mini after Chrome/Gemini Nano baseline), manual quality rubric review (10 test prompts).

**Addresses:** Quality hardening, CI stability, cross-browser parity, structural output testing

**Avoids:** Non-deterministic CI tests from snapshot assertions (Pitfall 16 — structural assertions only), warm-up cache invalidation after prompt changes (Pitfall 17 — cache key should include a hash of the system prompt content)

**Research flag:** Standard patterns. The synthetic corpus design and structural assertion patterns are well-established in the project's existing test infrastructure (`docs/SUMMARY.md`). No phase research needed.

### Phase Ordering Rationale

- **DI before pipeline is non-negotiable:** `CodeGenerationPipelineService` injects `ModelService`; building the pipeline before the abstraction means retrofitting the DI seam later.
- **Extraction before pipeline orchestration:** `CodeExtractorService` is pure TypeScript with no Angular dependencies; validate it independently (plain Vitest, no browser) before adding the async orchestration layer.
- **Preview security before AI output:** `PreviewPaneComponent` sandbox security is validated with hardcoded HTML before any live model output is connected. The security model cannot be reviewed retroactively after AI output is rendering.
- **Chrome before Edge throughout all phases:** Gemini Nano's ~20s warm-up vs. Phi-4 Mini's 23–110 min warm-up on ARM64 makes Chrome the fast iteration loop. Edge is the verification pass, not the development loop.
- **Prompt engineering late in Phase 3, not Phase 2:** Prompt engineering requires a running end-to-end pipeline with a live preview to evaluate output quality. Doing it in Phase 2 would require iterating against a service-only stub, which gives incomplete quality signals.

### Research Flags

Phases likely needing empirical validation during implementation:

- **Phase 2 (responseConstraint schema):** The planning pass schema complexity is LOW confidence for small-model reliability. Start minimal, test `JSON.parse()` success rate, add fields incrementally. Use `session.measureContextUsage({ responseConstraint: schema })` to validate schema fits the context budget before committing to the schema design.
- **Phase 3 (prompt engineering):** Model-specific system prompt token limits and optimal N-shot example counts for Phi-4 Mini are MEDIUM confidence. Allocate explicit iteration time and do not estimate prompt quality from published benchmarks — no HTML generation benchmarks exist for either model.

Phases with standard patterns (no additional research needed):

- **Phase 1 (Model Abstraction Layer):** Angular DI with abstract class token is well-documented. Factory provider with `navigator.userAgent` detection is straightforward.
- **Phase 4 (Quality Hardening):** Structural test assertions for AI output and CI warm-up patterns are established in the existing project. No new patterns required.

---

## Confidence Assessment

| Area         | Confidence  | Notes                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack        | HIGH        | All technologies verified against official Chrome/Edge docs, existing codebase, and MDN. Zero new runtime dependencies confirmed. `@types/dom-chromium-ai@0.0.15` covers the full API surface in use.                                                                                                                                          |
| Features     | MEDIUM-HIGH | Competitor feature analysis and UX patterns are HIGH confidence. Model capability estimates for HTML generation are LOW confidence — no published HTML/CSS benchmarks exist for Gemini Nano or Phi-4 Mini. Phi-4 Mini HumanEval (74.4%) is HIGH confidence but measures Python function completion.                                            |
| Architecture | HIGH        | API surface verified against TypeScript type definitions and official Chrome/Edge docs. Angular patterns (signals, DI, NG0910, `DomSanitizer`) verified against Angular 21 documentation and existing codebase. Session lifecycle (anchor pattern, destroy semantics) verified against Chrome session management guide and W3C spec.           |
| Pitfalls     | HIGH        | Critical pitfalls backed by official documentation, W3C spec, CVE advisories (GHSA-vjm7-m4xh-7wrc), Angular framework errors (NG0910), and Chromium developer group discussions. Security pitfalls (Pitfall 1, 8) are the highest-confidence findings in the entire research corpus — the threat model is documented with real-world exploits. |

**Overall confidence:** HIGH for the implementation approach; MEDIUM for output quality predictions at these model sizes.

### Gaps to Address

- **Gemini Nano HTML generation quality:** No published benchmarks. The 2–4/10 quality estimate is based on parameter count and third-party assessments, not empirical measurement. Address during Phase 3 prompt engineering: treat first-pass output as a baseline, iterate, and if quality is consistently below a usable threshold, the milestone can be validated primarily on Phi-4 Mini with Gemini Nano as a secondary target.
- **`responseConstraint` schema token overhead:** The exact token cost of injecting a JSON schema into the context is not documented. Use `session.measureContextUsage({ responseConstraint: schema })` before finalising the planning pass schema in Phase 2. On Gemini Nano, every token counts.
- **`omitResponseConstraintInput` token savings:** This option prevents the schema from counting against the context window, but its effect on Gemini Nano's 6K budget is not quantified. Test empirically — it may be the difference between the planning pass fitting or not.
- **Abort-then-prompt latency root cause:** The 2–5x latency increase after aborting a prompt is confirmed by the Chromium developer group but marked "under investigation." The 500ms cooldown is a workaround. Monitor Chrome release notes; the workaround is acceptable for v1.

---

## Sources

### Primary (HIGH confidence)

- [Chrome Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api) — streaming, `responseConstraint`, `clone()`, Web Worker exclusion, cumulative streaming semantics
- [Chrome Session Management Guide](https://developer.chrome.com/docs/ai/session-management) — anchor session pattern, model unload timing, destroy lifecycle
- [Chrome Structured Output for Prompt API](https://developer.chrome.com/docs/ai/structured-output-for-prompt-api) — `responseConstraint` JSON Schema, available since Chrome 137, `omitResponseConstraintInput`
- [Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) — Phi-4 Mini, `responseConstraint`, `initialPrompts`, `clone()`
- [W3C Prompt API spec](https://github.com/webmachinelearning/prompt-api) — `[Exposed=Window]` only (no Workers), session lifecycle, `responseConstraint` IDL
- [`@types/dom-chromium-ai@0.0.15`](https://www.npmjs.com/package/@types/dom-chromium-ai) — TypeScript definitions for full Prompt API surface; verified locally
- [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe/sandbox) — sandbox attribute semantics, `allow-scripts`+`allow-same-origin` explicit warning
- [Angular NG0910 error docs](https://angular.dev/errors/NG0910) — static `sandbox` attribute requirement
- [Angular Security Best Practices](https://angular.dev/best-practices/security) — `DomSanitizer`, `bypassSecurityTrustResourceUrl`, resource URL context
- [Angular Signals Guide](https://angular.dev/guide/signals) — signals, `computed()`, reactive context loss after `await`
- [Open-WebUI security advisory GHSA-vjm7-m4xh-7wrc](https://github.com/open-webui/open-webui/security/advisories/GHSA-vjm7-m4xh-7wrc) — real-world `allow-scripts`+`allow-same-origin` exploit in an AI preview tool
- [Phi-4-Mini technical report](https://arxiv.org/html/2503.01743v1) — 74.4% HumanEval Pass@1, 3.8B params, architecture
- [SCoT prompting research](https://arxiv.org/abs/2305.06599) — up to 13.79% Pass@1 improvement for structured chain-of-thought code generation

### Secondary (MEDIUM confidence)

- [MSEdgeExplainers issue #1224](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1224) — confirmed 9,216 token context cap for Phi-4 Mini in Edge Prompt API
- [Chromium dev group: Prompt API performance](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/Nzsxe78l0zQ) — model unload timing (~1 min after last session destroyed), abort-then-prompt latency under investigation
- [Chromium dev group: API oddities](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/tpHL6bvJyVg) — cumulative streaming behaviour confirmed
- [web.dev: Chatbot with Prompt API](https://web.dev/articles/ai-chatbot-promptapi) — cumulative streaming: "the Prompt API responds with the full string response"
- [Multi-stage guided code generation (MSG)](https://www.sciencedirect.com/science/article/abs/pii/S095219762401649X) — planning + design + implementation phases improve small-model code coherence
- [v0 vs bolt.new vs Lovable comparison](https://www.nxcode.io/resources/tools/v0-vs-bolt-vs-lovable-ai-app-builder-comparison-2025) — competitor feature analysis
- [Blank canvas UX problem](https://medium.com/ui-for-ai/no-more-blank-canvas-rethinking-how-people-start-with-ai-fd427af24dc8) — cognitive load research supporting prompt templates
- [ICSE 2025: LLM Code Generation Error Characteristics](https://dl.acm.org/doi/10.1145/3672456) — semantic vs. syntactic error rates in small models; semantic errors dominate
- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) — prompt injection risk taxonomy and mitigation

### Tertiary (LOW confidence)

- Gemini Nano HTML generation quality estimates — no published benchmarks found; extrapolated from parameter count and third-party SitePoint assessment
- `responseConstraint` schema overhead in tokens — API-specific, not documented; must be measured empirically with `measureContextUsage()`
- Exact token consumption by planning pass JSON schema — needs runtime measurement; affects Gemini Nano context budget materially

---

_Research completed: 2026-03-23_
_Ready for roadmap: yes_
