# Project Research Summary

**Project:** In-Browser AI Coding Agent — Code Generation Milestone
**Domain:** In-browser AI code generation using on-device small language models
**Researched:** 2026-03-23
**Confidence:** MEDIUM-HIGH

## Executive Summary

This milestone adds a full prompt-to-preview coding-agent loop to an existing Angular 21 app. The app already has LanguageModel API integration, dual-browser CI, and model status UI; what is missing is the generation pipeline and sandboxed preview. The recommended approach is a two-pass inference pipeline (structured JSON planning pass + HTML code-generation pass) using the W3C LanguageModel (Prompt) API, rendered into a sandboxed iframe. All four research strands agree on this direction — the disagreements are narrowly scoped to implementation details rather than overall approach.

The binding technical constraint throughout every research file is the token budget: Gemini Nano operates at roughly 6,144 tokens total across input and output; Phi-4 Mini is API-capped at 9,216 tokens by Edge despite its native 128K context. This shapes every design decision — prompt engineering, pipeline pass count, output format, and feature scope. Multi-pass generation is not optional: research shows 15%+ Pass@1 improvement and small-model instruction-following is too unreliable for single-shot complex HTML. The DI-based model abstraction (abstract class as DI token, browser-detected provider factory) is essential because Gemini Nano and Phi-4 Mini require materially different prompt templates and pipeline configurations.

The primary risks are security (iframe sandbox misconfiguration), performance (session destruction triggering model cold-starts between pipeline passes), and output quality (truncation detection and semantic error management). All three risks have documented mitigations. The security risk is the highest-stakes: the `allow-scripts` + `allow-same-origin` combination has produced real CVEs in deployed AI tools and must be prevented at the architectural level before any AI output is rendered.

---

## Key Findings

### Recommended Stack

The core code-generation milestone requires zero new npm dependencies. `@types/dom-chromium-ai@0.0.15` and `marked@17.0.5` are already installed; `@tailwindcss/browser@4.2.2` is injected as a CDN `<script>` tag into generated HTML strings (not bundled with the Angular app). The inference pipeline runs entirely on the main thread — the LanguageModel API is `[Exposed=Window]` only, confirmed by the W3C spec and both Chrome and Edge official documentation. Tool calling is spec-only (not shipped); `responseConstraint` with JSON Schema is the reliable structured-output mechanism for pipeline passes.

**Core technologies:**

- W3C LanguageModel (Prompt) API: inference engine — already in use; `promptStreaming()` is essential for UI responsiveness since no Worker offloading is possible
- `responseConstraint` (JSON Schema): structured output for Pass 1 (outline/plan) — reliable for small metadata schemas, unreliable for HTML-in-JSON; use only for structured metadata passes
- `marked@17.0.5` (Lexer): code block extraction from Pass 2 unconstrained markdown responses — fallback when `responseConstraint` is not appropriate
- `@tailwindcss/browser@4.2.2` (CDN-injected): CSS strategy for generated HTML — LLMs generate Tailwind utility classes more reliably than vanilla CSS due to semantic naming in training data
- Angular signals: pipeline state management — `signal<PipelinePhase>`, `signal<string>` for streaming tokens; no RxJS needed
- Sandboxed iframe (blob URL): preview rendering — blob URL iframes get an opaque origin independent of the host page's CSP; `srcdoc` iframes inherit parent CSP and will silently block generated inline scripts

**Critical version notes:**

- Tailwind v4 training data gap: Gemini Nano's training predates v4; N-shot examples with v4 class syntax are required in system prompts
- `topK`/`temperature` are deprecated in web-page contexts; omit sampling parameters entirely

### Expected Features

The feature set is bounded by tight token budgets, not by implementation complexity. Conversation history, self-repair loops, and parallel agent sessions are deferred not because they are hard to build but because Gemini Nano's 6K context cannot accommodate them without crowding out generation headroom.

**Must have (table stakes):**

- Split-pane UI (prompt left, preview right) — the playground layout that immediately communicates purpose
- Natural-language prompt input with submit button — the entry point for the entire product
- Multi-pass pipeline (plan pass + code pass) — required for acceptable output quality; single-pass is not viable for small models
- Per-model DI (separate Gemini Nano and Phi-4 Mini implementations) — different prompt templates and pipeline tuning; cannot share a single implementation
- Sandboxed iframe preview with `sandbox="allow-scripts"` only — security-critical; `allow-same-origin` must never be added
- Streaming token display during generation — prevents blank-screen anxiety; `promptStreaming()` is already in the API
- Loading/progress indicator tied to pipeline phase — required when inference takes 5-60s
- Error feedback for generation failures — trust-critical; map `QuotaExceededError`, model-not-available, truncation to human-readable messages
- Copy to clipboard and download as single HTML file — minimum viable export

**Should have (competitive advantage):**

- Prompt templates (5-8 curated examples: landing page, contact form, countdown timer, quiz, dashboard card) — solves the blank-canvas problem; low implementation cost, high user value
- Viewport toggle (mobile 375px / desktop 1280px) — low effort once preview exists
- Abort/cancel button wired to `AbortController` — required for Phi-4 Mini where inference takes 2+ minutes

**Defer (v1.x after validation):**

- Conversation history / multi-turn refinement — conflicts with 6K-9K token budget; add only after context management strategy is proven
- Self-repair loop (generate → validate → re-prompt) — high complexity, uncertain payoff in v1
- Read-only code display with syntax highlighting — nice for technical users; non-critical for launch

**Defer (v2+):**

- File persistence (File System API)
- Code editor integration (Monaco/CodeMirror)
- Image-to-code (vision input) — models not vision-tuned for code generation
- Parallel agent sessions — requires Web Worker support not yet in the spec

### Architecture Approach

The architecture is organized into three new feature folders under `src/app/`: `coding-agent/` (split-pane UI components), `pipeline/` (orchestration services and signal-based state), and `model/` (abstract DI token, per-model implementations, browser-detection provider factory). These coexist with the existing `LanguageModelService` (availability + download, unchanged) and `ModelStatusComponent` (unchanged). The split-pane coding agent is lazy-loaded at `/agent`; the existing model status UI stays at `/`. Build order must be bottom-up: model abstraction layer first, then code extractor, then pipeline service, then UI.

**Major components:**

1. `ModelService` (abstract class + `model.providers.ts`) — DI token and browser-detection factory; everything else injects this, never raw `LanguageModelService`
2. `GeminiNanoModelService` / `Phi4MiniModelService` — concrete model implementations with their own system prompts, N-shot examples, and token budget constants
3. `CodeGenerationPipelineService` — orchestrates passes, holds anchor session to prevent model unload, manages pipeline phase signals
4. `CodeExtractorService` — strict/loose/raw code-block extraction with three-tier fallback; no Angular dependency, fully unit-testable
5. `PreviewPaneComponent` — blob URL lifecycle (create, revoke previous), injected error-capture script, `postMessage` bridge for runtime errors from iframe
6. `CodingAgentComponent` + panes + `PipelineProgressComponent` — split-pane layout wired to pipeline service signals

### Critical Pitfalls

1. **Iframe sandbox escape via `allow-scripts` + `allow-same-origin`** — Use `sandbox="allow-scripts"` only, never add `allow-same-origin`. This combination has produced stored XSS in production AI tools (Open-WebUI CVE). For preview rendering, use blob URL (not `srcdoc`) because `srcdoc` iframes inherit the parent page's CSP and will silently block generated inline scripts. Lock this in before any AI output is rendered.

2. **`session.destroy()` triggering model cold-start between pipeline passes** — Keep a persistent anchor session alive for the entire pipeline execution. Clone it per pass (`anchorSession.clone()`). Only destroy per-pass sessions after the next pass is already underway. Never destroy the anchor session during active pipeline execution. Missing this causes each pass to pay the full cold-start cost (38s for Gemini Nano, 23-110 min for Phi-4 Mini on ARM64).

3. **Context window is far smaller than advertised** — Phi-4 Mini native 128K is capped at 9,216 tokens by the Edge API. Gemini Nano is ~6,144 tokens total (input + output combined). Query `session.contextWindow` at runtime; never hardcode token budgets. Budget aggressively: system prompt under 300 tokens, user prompt echo under 100, leave 2,000 tokens minimum for output. Monitor `session.contextUsage / session.contextWindow`; treat results above 80% as potentially truncated.

4. **`responseConstraint` unreliable for HTML-in-JSON** — The constraint is reliable for small structured metadata (2-3 fields, enum values). It fails for schemas containing HTML as a JSON string value: small models produce unescaped quotes that break JSON parsing, or stall entirely. Use `responseConstraint` for Pass 1 (structured outline/metadata only); generate code in unconstrained prompts and extract with `CodeExtractorService`.

5. **Output truncation renders silently broken previews** — Small models hit the output token budget and stop mid-tag with no error thrown. Validate that the response contains a closing `</html>` (or at minimum `</body>`) before rendering. If truncated, show an error with retry rather than rendering broken HTML. Prompt engineering must forbid preamble text to maximize the output budget available for actual code.

---

## Implications for Roadmap

Based on combined research, the dependency graph points to five phases. The model abstraction must exist before the pipeline. The pipeline must exist before the UI. Preview security must be locked in before any AI output touches the rendering layer. Prompt engineering is the final tuning step once the full stack is assembled.

### Phase 1: Model Abstraction Layer

**Rationale:** The abstract `ModelService` DI token is the central dependency of every subsequent phase. Building it first enables all other services and components to be developed against a stable interface, with mock implementations for unit tests. The browser-detection provider factory (`model.providers.ts`) belongs here so the pipeline never contains conditional model logic.
**Delivers:** Abstract `ModelService` class, `GeminiNanoModelService`, `Phi4MiniModelService`, `model.providers.ts` registered in `app.config.ts`
**Addresses:** Per-model DI requirement from features research
**Avoids:** Injecting `LanguageModelService` directly in pipeline code; anchor session pattern for model unload prevention lives here
**Research flag:** Standard patterns — Angular abstract class DI is well-documented. No pre-phase research needed.

### Phase 2: Code Extraction and Pipeline Orchestration

**Rationale:** `CodeExtractorService` has no Angular dependencies and can be unit-tested with Vitest in isolation — build it before the pipeline. The pipeline service wires the two-pass flow (JSON-constrained outline pass + markdown code-generation pass) and owns all signal-based state. Building this before the UI means the service API is settled before components depend on it.
**Delivers:** `CodeExtractorService` (strict/loose/raw extraction), `CodeGenerationPipelineService` (two-pass pipeline, anchor session lifecycle, `AbortController` threading, signal-based state)
**Uses:** `responseConstraint` for Pass 1 outline; unconstrained prompting + `CodeExtractorService` for Pass 2; `promptStreaming()` with signal updates
**Implements:** Pipeline service and types from `pipeline/` folder
**Avoids:** Context window exhaustion (Pass 1 JSON constrained to under 300 tokens); model unload between passes (anchor session); output truncation detection before rendering; `responseConstraint` scoped to metadata schema only; context accumulation (separate cloned session per pass)
**Research flag:** Two-pass pipeline structure is MEDIUM confidence (research literature, not verified against these specific models). Treat as exploratory; budget for empirical validation and iteration on pass structure.

### Phase 3: Sandboxed Preview Pane

**Rationale:** Preview security must be locked in as a standalone phase before it is connected to live AI output. Building and reviewing `PreviewPaneComponent` in isolation (with hardcoded HTML test fixtures) lets security decisions be validated independently. Blob URL lifecycle, error-capture script injection, `postMessage` bridge, and CSP injection into generated HTML all belong here.
**Delivers:** `PreviewPaneComponent` with blob URL rendering, injected `window.onerror` → `postMessage` bridge, CSP `<meta>` injection into generated HTML, `URL.revokeObjectURL` cleanup, `sandbox="allow-scripts allow-forms"` (no `allow-same-origin`)
**Addresses:** Sandboxed iframe preview from features research
**Avoids:** Sandbox escape (`allow-scripts` only, blob URL avoids CSP inheritance); prompt injection via CSP injection blocking external network requests from generated HTML
**Note on preview mechanism disagreement:** Stack researcher recommends `srcdoc`; Architecture researcher recommends blob URL; Pitfalls researcher recommends `srcdoc` with `allow-scripts` only. Resolution: use blob URL because it avoids CSP inheritance entirely — the correct choice when the Angular app has or may gain a non-trivial CSP. Document this decision in the component.
**Research flag:** Security patterns are HIGH confidence from official MDN and CVE research. No pre-phase research needed.

### Phase 4: Split-Pane UI and Prompt Engineering

**Rationale:** The UI is the last layer assembled. By this point, the pipeline service exposes stable signals and the preview pane accepts HTML input; the UI just wires them. Prompt engineering (system prompts, N-shot examples, output format instructions, token budget tuning) can only be done once the full stack is assembled and generation can be observed end-to-end.
**Delivers:** `CodingAgentComponent` (split-pane layout, `/agent` lazy-loaded route), `PromptInputPaneComponent` (textarea, submit, prompt templates), `PipelineProgressComponent` (streaming tokens, phase indicators), prompt templates (5-8 curated examples), tuned system prompts for both Gemini Nano and Phi-4 Mini
**Addresses:** All P1 table-stakes features — split-pane UI, prompt input, streaming display, prompt templates, loading indicator, error feedback, copy/download
**Avoids:** Semantic errors (few-shot examples in system prompts); CSS design quality (base CSS instructions in system prompt); truncation (output format instructions forbid preamble); non-deterministic CI tests (structural assertions, not string matching)
**Research flag:** Prompt engineering outcomes for Gemini Nano HTML/CSS generation have LOW-MEDIUM confidence (no published benchmarks for web-specific output). This is the highest empirical-uncertainty phase. Plan for iteration. Chrome/Gemini Nano is the fast iteration loop (~38s warm-up); validate on Edge/Phi-4 Mini after Chrome prompts are satisfactory.

### Phase 5: Quality, Security Hardening, and CI Integration

**Rationale:** Cross-cutting concerns that span the full stack: input sanitization, abort/cancel UI, truncation detection error states, warm-up cache update after prompt stabilization, and structural output testing. These are deferred from earlier phases to avoid premature optimization of prompts that are still being tuned.
**Delivers:** Input sanitization (strip HTML, limit to 500 chars), abort/cancel button wired to `AbortController`, truncation detection with user-visible error and retry, CI warm-up updated to use actual system prompt, structural test suite (DOMParser validation, not string matching), viewport toggle (mobile/desktop), model availability re-check before each pipeline pass
**Addresses:** P2 features (viewport toggle) and security hardening
**Avoids:** Prompt injection (input sanitization layer); model deleted mid-session (re-check before each pass); non-deterministic CI tests (structural assertions); warm-up cache invalidation (update after prompt stabilization)
**Research flag:** Standard patterns for most items. No pre-phase research needed.

### Phase Ordering Rationale

- The model abstraction layer (Phase 1) must precede the pipeline (Phase 2) because the pipeline injects the abstract token; building in reverse order forces rework.
- The pipeline service (Phase 2) must precede the UI (Phase 4) because components read pipeline signals; the service API must be stable first.
- Preview security (Phase 3) is deliberately decoupled from AI output so it can be security-reviewed before live model output ever reaches the rendering layer. Connecting Phase 2 output to Phase 3 rendering is the integration step at the start of Phase 4.
- Prompt engineering (end of Phase 4) must come after the full pipeline is assembled; you cannot tune prompts against a mock model.
- Hardening (Phase 5) is last because input sanitization patterns and CI warm-up strategy depend on the final prompt structure being stable.

### Research Flags

Phases needing empirical validation during implementation (no pre-phase research required):

- **Phase 2 (Pipeline):** Two-pass pipeline structure is MEDIUM confidence. The JSON schema for the outline pass and token budgets per model require empirical measurement. Plan for 1-2 adjustment iterations after the first end-to-end run.
- **Phase 4 (Prompt Engineering):** Gemini Nano HTML/CSS generation quality is LOW-MEDIUM confidence. No published benchmarks for web-specific output from this model. Expect to discover model-specific constraints (preamble tendencies, Tailwind v3 vs v4 confusion) during implementation.

Phases with established patterns (confident, no additional research needed):

- **Phase 1 (Model Abstraction):** Angular abstract class DI is well-documented. HIGH confidence.
- **Phase 3 (Preview Security):** Blob URL sandbox pattern and CSP injection are well-documented with CVE-level validation. HIGH confidence.
- **Phase 5 (Hardening):** Standard web security patterns. HIGH confidence.

---

## Confidence Assessment

| Area         | Confidence  | Notes                                                                                                                                                                                    |
| ------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack        | HIGH        | API layer verified via Chrome and Edge official docs (March 2026); zero new dependencies for v1 is confirmed                                                                             |
| Features     | MEDIUM-HIGH | Token budget data is HIGH confidence (MSEdgeExplainers issue, swyx.io empirical measurement); model quality estimates are MEDIUM (limited HTML/CSS benchmarks for these specific models) |
| Architecture | HIGH        | API constraints from official spec; DI pattern from existing codebase + Angular docs; pipeline structure from multi-stage code generation research literature                            |
| Pitfalls     | HIGH        | Iframe sandbox risk from CVE/advisory; session destroy behavior from Chrome session management docs; token limits from confirmed GitHub issues and official docs                         |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Preview mechanism (blob URL vs. srcdoc):** Three researchers gave inconsistent recommendations. Resolution: use blob URL as the default for CSP independence; document the tradeoff. Validate during Phase 3 that the Angular app's CSP does not need adjustment for `frame-src blob:`.

- **Gemini Nano HTML/CSS generation quality:** No published benchmarks for web-specific output from Gemini Nano. The quality assessment ("Marginal" for most tasks) is inferred from general code benchmarks and model size, not empirical measurement. This gap closes only during Phase 4 prompt engineering. Budget iteration time accordingly.

- **Anchor session token cost on Gemini Nano:** The anchor session pattern occupies tokens in the 6K context window before any pass input arrives. The exact cost is not documented. Measure `session.contextUsage` on an empty anchor session before designing pass token budgets.

- **Tailwind v4 vs v3 confusion in Gemini Nano:** Gemini Nano's training cutoff predates Tailwind v4. The degree to which it generates v3-style syntax is unknown. Provide explicit v4 class examples in N-shot prompts and verify the output during Phase 4.

- **`responseConstraint` schema token cost:** The planned JSON Schema for the outline pass consumes input tokens. Use `session.measureContextUsage()` with the schema to validate it stays within budget before committing to the Pass 1 schema design.

---

## Sources

### Primary (HIGH confidence)

- [W3C Prompt API Draft (19 March 2026)](https://webmachinelearning.github.io/prompt-api/) — `[Exposed=Window]`, session lifecycle, `responseConstraint` IDL, tool calling spec-only
- [Chrome Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api) — Worker exclusion, streaming, `responseConstraint`, `append()`, `clone()`
- [Chrome Structured Output for Prompt API](https://developer.chrome.com/docs/ai/structured-output-for-prompt-api) — `responseConstraint` JSON Schema since Chrome 137, keyword support
- [Chrome Prompt API Session Management](https://developer.chrome.com/docs/ai/session-management) — anchor session pattern, clone semantics, `destroy()` memory pressure
- [Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) — Phi-4 Mini, `responseConstraint`, `initialPrompts`, `clone()`
- [MSEdgeExplainers issue #1224](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1224) — confirmed 9,216-token API cap for Phi-4 Mini in Edge
- [Open-WebUI security advisory GHSA-vjm7-m4xh-7wrc](https://github.com/open-webui/open-webui/security/advisories/GHSA-vjm7-m4xh-7wrc) — real-world `allow-scripts` + `allow-same-origin` exploit in an AI preview tool
- [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) — sandbox attribute semantics and explicit warning
- [Phi-4 Mini Technical Report (arXiv 2503.01743)](https://arxiv.org/abs/2503.01743) — 3.8B params, 128K native context, 74.4% HumanEval
- [npm: @types/dom-chromium-ai](https://www.npmjs.com/package/@types/dom-chromium-ai) — v0.0.15 confirmed March 2026
- [npm: marked](https://www.npmjs.com/package/marked) — v17.0.5 confirmed March 2026

### Secondary (MEDIUM confidence)

- [Gemini Nano token limits (swyx.io)](https://www.swyx.io/gemini-nano) — ~6,144-token context window empirical measurement
- [Multi-stage guided code generation (ScienceDirect 2024)](https://www.sciencedirect.com/science/article/abs/pii/S095219762401649X) — planning → pseudocode → implementation pipeline; 15%+ improvement
- [Multi-agent code generation pipeline research (arXiv 2505.02133)](https://arxiv.org/html/2505.02133v1) — 15%+ Pass@1 improvement with multi-agent + debugging
- [Multi-agent LLM system failure modes (arXiv 2503.13657)](https://arxiv.org/pdf/2503.13657) — error propagation in multi-pass pipelines
- [ICSE 2025: LLM Code Generation Error Characteristics](https://dl.acm.org/doi/10.1109/ICSE55347.2025.00180) — semantic vs syntactic error rates in small models
- [iframe srcdoc code preview guide](https://mionskowski.pl/posts/iframe-code-preview/) — `srcdoc` + `sandbox` pattern for playground preview
- [Building a Secure Code Sandbox — iframe + postMessage](https://medium.com/@muyiwamighty/building-a-secure-code-sandbox-what-i-learned-about-iframe-isolation-and-postmessage-a6e1c45966df) — srcdoc CSP inheritance vs blob URL isolation
- [Tailwind CSS Play CDN docs](https://tailwindcss.com/docs/installation/play-cdn) — `@tailwindcss/browser@4` CDN setup, limitations
- [Phi-4-mini-instruct (Hugging Face)](https://huggingface.co/microsoft/Phi-4-mini-instruct) — 3.8B params, 128K context, Python-heavy training
- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) — prompt injection risk taxonomy

### Tertiary (LOW confidence)

- Gemini Nano HTML/CSS benchmark data — no dedicated source found; quality estimates are inferences from model size and general code benchmarks
- [Flowbite LLM + Tailwind docs](https://flowbite.com/docs/getting-started/llm/) — Tailwind utility class reliability for AI generation
- [AI UX patterns — prompt augmentation (Jakob Nielsen)](https://jakobnielsenphd.substack.com/p/prompt-augmentation) — template and suggestion patterns for non-technical users

---

_Research completed: 2026-03-23_
_Ready for roadmap: yes_
