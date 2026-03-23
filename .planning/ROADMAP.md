# Roadmap: In-Browser AI Coding Agent

## Overview

Starting from a validated LanguageModel API integration, milestone v1.0 adds the full prompt-to-preview coding-agent loop in four phases. The build order is bottom-up: model abstraction layer first (the DI contract everything injects), then the two-pass generation pipeline with sandboxed preview (the core product capability), then the split-pane UI wired to pipeline signals with tuned prompts (the user experience), and finally quality hardening with a synthetic prompt corpus. Key architectural constraints from research: create-per-pass sessions (not clone) because each pass needs its own system prompt; `promptStreaming()` emits cumulative text (assign directly to signal, never concatenate); `sandbox="allow-scripts"` must be a static attribute (Angular NG0910); blob URLs for opaque-origin isolation; CSS Grid for the three-pane layout; AbortController for generation cancellation with 500ms cooldown; DOMParser for deterministic truncation detection (no AI tokens consumed).

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Model Abstraction Layer** - Abstract DI token and per-model implementations that everything else injects
- [ ] **Phase 2: Generation Pipeline and Sandboxed Preview** - Two-pass inference pipeline and security-reviewed iframe preview
- [ ] **Phase 3: Split-Pane UI and Prompt Engineering** - Full user-facing experience wired to pipeline signals, tuned prompts, abort support
- [ ] **Phase 4: Quality Hardening and CI Integration** - Synthetic prompt corpus, structural tests, warm-up cache

## Phase Details

### Phase 1: Model Abstraction Layer

**Goal**: A stable Angular DI interface exists so that all subsequent services and components can inject a model without conditional browser logic -- each model has its own system prompts, token budgets, and an anchor session that prevents cold-starts between pipeline passes
**Depends on**: Nothing (first phase)
**Requirements**: PIPE-05, PIPE-06, PIPE-07
**Success Criteria** (what must be TRUE):

1. An abstract `ModelService` class exists as the DI token; a factory provider in `model.providers.ts` resolves to `GeminiNanoModelService` in Chrome Beta and `Phi4MiniModelService` in Edge Dev automatically at startup -- no runtime branching in callers
2. Each concrete implementation has its own system prompts and queries `session.contextWindow` at runtime for token budget management -- swapping models requires no changes outside the `model/` folder
3. A persistent anchor session is created on initialization and never destroyed while the app is open; creating and destroying per-pass sessions (each with its own system prompt) does not trigger model unload -- verifiable by running two consecutive pipeline passes without a cold-start delay
4. Unit tests can inject a mock `ModelService` to validate downstream consumers without a real browser model

**Plans:** 2 plans

Plans:

- [ ] 01-01-PLAN.md -- Create @layzeedk/model Nx library with abstract ModelService, concrete implementations, provideModel() factory, and testing entrypoint
- [ ] 01-02-PLAN.md -- Integrate into app, build temp component, delete old code, full test coverage (unit + e2e)

### Phase 2: Generation Pipeline and Sandboxed Preview

**Goal**: A user can submit a prompt and receive a live HTML/CSS/JS preview rendered in a secure sandboxed iframe, with the full two-pass pipeline (structured JSON planning pass via `responseConstraint`, then streaming code generation pass) running correctly for both models
**Depends on**: Phase 1
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-08, PREV-01, PREV-02, PREV-03
**Success Criteria** (what must be TRUE):

1. A natural-language prompt produces a rendered preview with visible HTML/CSS/JS output in the iframe -- no blank screen, no console errors in the parent page
2. The pipeline runs a structured JSON planning pass (Pass 1, using `responseConstraint` with a minimal 2-3 field schema) before the streaming code generation pass (Pass 2); each pass creates a fresh session with its own system prompt, destroyed after use
3. Streaming tokens from the code generation pass update a signal in real time via direct assignment (`signal.set(chunk)`, not concatenation) -- the application is not frozen during inference
4. The preview iframe has static `sandbox="allow-scripts"` (no `allow-same-origin`, no dynamic binding) and loads via blob URL -- verifiable in browser DevTools; iframe scripts cannot access parent DOM or cookies
5. Truncated output is detected deterministically via DOMParser (tag-balance check, `</html>` presence) before rendering; the user sees an error state rather than broken HTML -- no AI tokens are consumed for validation
   **Plans**: TBD

### Phase 3: Split-Pane UI and Prompt Engineering

**Goal**: A non-technical user can open the app, select or type a prompt, watch generation progress with streaming tokens, abort if needed, see the result in a live preview, and copy or download the output -- with system prompts tuned per model for acceptable HTML/CSS/JS quality
**Depends on**: Phase 2
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, OUT-01, OUT-02, OUT-03, OUT-04
**Success Criteria** (what must be TRUE):

1. The app shows a 3-pane CSS Grid layout (prompt input left, generated code center, preview right); the code pane can be toggled hidden/shown
2. Selecting a prompt template pre-fills the textarea with one of at least 5 curated examples spanning canonical (todo list, calculator) to medium (contact form, countdown timer) complexity; the user can also type freely
3. A progress indicator is visible during generation (step indicators: Outlining / Generating / Rendering) and disappears on completion or error; streaming tokens appear in the code pane as they arrive
4. The user can abort an in-progress generation via an abort button wired to AbortController; a 500ms cooldown after cancel prevents the abort-then-prompt latency issue before the next generation can start
5. After generation, the user can copy the HTML to clipboard or download it as a `.html` file with a single click each
6. When generation fails (model unavailable, quota exceeded, truncation, malformed output), the user sees a plain-English explanation -- no stack traces, no jargon, no error codes
   **Plans**: TBD

### Phase 4: Quality Hardening and CI Integration

**Goal**: The generation pipeline is validated across both models at multiple prompt complexities with structural assertions, CI warms inference using realistic prompts from a synthetic corpus, and cross-browser parity is verified
**Depends on**: Phase 3
**Requirements**: QA-01, QA-02, QA-03, QA-04
**Success Criteria** (what must be TRUE):

1. A synthetic prompt corpus of at least 8 prompts exists as TypeScript data files, spanning canonical (todo list, calculator), simple (landing page, greeting card), medium (contact form, countdown timer), and ambitious (quiz, dashboard card) complexity tiers
2. Both Gemini Nano and Phi-4 Mini are benchmarked against the corpus; quality results exist for comparison (Chrome is the primary development loop due to ~20s warm-up vs. Phi-4 Mini's 23+ min)
3. CI warm-up uses prompts from the corpus with the real system prompt (not the generic 'warmup' string); warm inference state is cached between workflow runs
4. Tests validate generation output with structural assertions via DOMParser (well-formed HTML, expected elements, `<!DOCTYPE html>` presence, `<style>` block) -- no string snapshot tests exist for model output
   **Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 --> 2 --> 3 --> 4

| Phase                                        | Plans Complete | Status      | Completed |
| -------------------------------------------- | -------------- | ----------- | --------- |
| 1. Model Abstraction Layer                   | 0/2            | Planned     | -         |
| 2. Generation Pipeline and Sandboxed Preview | 0/TBD          | Not started | -         |
| 3. Split-Pane UI and Prompt Engineering      | 0/TBD          | Not started | -         |
| 4. Quality Hardening and CI Integration      | 0/TBD          | Not started | -         |
