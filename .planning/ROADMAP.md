# Roadmap: In-Browser AI Coding Agent

## Overview

Starting from a validated LanguageModel API integration, this milestone adds the full prompt-to-preview coding-agent loop. The build order is bottom-up: model abstraction layer first (the central DI dependency), then the two-pass generation pipeline with sandboxed preview (the core product), then the split-pane UI wired to pipeline signals (the user experience), and finally quality hardening once prompts stabilize. The Preview phase is merged into the Pipeline phase — sandboxed rendering is the output stage of the pipeline, not a separate product capability.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Model Abstraction Layer** - Abstract DI token and per-model implementations that everything else injects
- [ ] **Phase 2: Generation Pipeline and Sandboxed Preview** - Two-pass inference pipeline and security-reviewed iframe preview
- [ ] **Phase 3: Split-Pane UI and Prompt Engineering** - Full user-facing experience wired to pipeline signals, tuned prompts
- [ ] **Phase 4: Quality Hardening and CI Integration** - Synthetic prompt corpus, structural tests, warm-up cache, input hardening

## Phase Details

### Phase 1: Model Abstraction Layer

**Goal**: A stable Angular DI interface exists so that all subsequent services and components can inject a model without any conditional browser logic
**Depends on**: Nothing (first phase)
**Requirements**: PIPE-05, PIPE-06, PIPE-07
**Success Criteria** (what must be TRUE):

1. An abstract `ModelService` class exists as the DI token; no code anywhere injects raw `LanguageModelService` for generation
2. Chrome Beta resolves to `GeminiNanoModelService` and Edge Dev resolves to `Phi4MiniModelService` automatically at startup — no runtime branching in callers
3. Each concrete implementation has its own system prompts and token budget constants; swapping models requires no changes outside the `model/` folder
4. The anchor session pattern is implemented in the model layer — destroying a session never causes model cold-start during a pipeline run
   **Plans**: TBD

### Phase 2: Generation Pipeline and Sandboxed Preview

**Goal**: A user can submit a prompt and receive a live HTML/CSS/JS preview rendered in a secure sandboxed iframe, with the full two-pass pipeline running correctly for both models
**Depends on**: Phase 1
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, PIPE-08, PREV-01, PREV-02, PREV-03
**Success Criteria** (what must be TRUE):

1. A natural-language prompt produces a rendered preview with visible HTML/CSS/JS output in the iframe — no blank screen, no console errors in the parent page
2. The pipeline runs a structured JSON planning pass (Pass 1) before the code generation pass (Pass 2); the outline is visible in pipeline state signals
3. Streaming tokens from the code generation pass update the pipeline state in real time — the application is not frozen during inference
4. The preview iframe has `sandbox="allow-scripts"` only (no `allow-same-origin`) and loads via blob URL — verifiable in browser DevTools
5. Truncated output is detected before rendering; the user sees an error state rather than broken HTML
   **Plans**: TBD

### Phase 3: Split-Pane UI and Prompt Engineering

**Goal**: A non-technical user can open the app, select or type a prompt, watch generation progress, see the result, and copy or download the output — with prompts tuned for acceptable quality on both models
**Depends on**: Phase 2
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, OUT-01, OUT-02, OUT-03, OUT-04
**Success Criteria** (what must be TRUE):

1. The app shows a 3-pane split layout (prompt input left, generated code center, preview right); the code pane can be hidden and shown
2. Selecting a prompt template pre-fills the textarea with one of at least 5 curated examples; the user can also type freely
3. A progress indicator is visible during generation and disappears when complete or on error; streaming tokens appear in the code pane as they arrive
4. After generation, the user can copy the HTML to clipboard or download it as a `.html` file with a single click each
5. When generation fails (model unavailable, quota exceeded, malformed output), the user sees a plain-English explanation with no stack trace or technical jargon
6. The preview viewport can be toggled between mobile (375px) and desktop (1280px) width
   **Plans**: TBD

### Phase 4: Quality Hardening and CI Integration

**Goal**: The generation pipeline is validated across both models at multiple prompt complexities, CI warms the inference cache using realistic prompts, and tests use structural assertions rather than string matching
**Depends on**: Phase 3
**Requirements**: QA-01, QA-02, QA-03, QA-04
**Success Criteria** (what must be TRUE):

1. A synthetic prompt corpus covers at least 8 prompts spanning canonical (todo list, calculator), simple (landing page, greeting card), medium (contact form, countdown timer), and ambitious (quiz, dashboard card) complexity tiers
2. Both Gemini Nano and Phi-4 Mini are benchmarked against the corpus; results exist for comparison
3. CI warm-up uses prompts from the corpus rather than the generic 'warmup' string; warm inference state is cached between workflow runs
4. Tests validate generation output with structural assertions (well-formed HTML, expected elements via DOMParser) — no string snapshot tests exist for model output
   **Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase                                        | Plans Complete | Status      | Completed |
| -------------------------------------------- | -------------- | ----------- | --------- |
| 1. Model Abstraction Layer                   | 0/TBD          | Not started | -         |
| 2. Generation Pipeline and Sandboxed Preview | 0/TBD          | Not started | -         |
| 3. Split-Pane UI and Prompt Engineering      | 0/TBD          | Not started | -         |
| 4. Quality Hardening and CI Integration      | 0/TBD          | Not started | -         |
