# v1 Requirements — In-Browser AI Coding Agent

## Core Value

A non-technical user types a description of what they want and gets working, well-designed HTML/CSS/JS rendered in a preview — without needing any implementation knowledge. Everything runs on-device via the W3C LanguageModel API. No cloud APIs.

---

## v1 Requirements

### Pipeline

- [ ] **PIPE-01**: User can type a natural-language description and receive generated HTML/CSS/JS as output via a multi-pass inference pipeline
- [ ] **PIPE-02**: Pipeline uses a planning pass that produces structured JSON (via `responseConstraint`) describing the page structure, components, and interactions before code generation
- [ ] **PIPE-03**: Pipeline uses a code generation pass that takes the structured plan and produces a single HTML file with inline CSS and JavaScript
- [ ] **PIPE-04**: Pipeline supports programmatic validation passes (HTML well-formedness, syntax checking) alongside AI passes — deterministic work is offloaded to JavaScript, not the model
- [ ] **PIPE-05**: Model service uses Angular DI with an abstract class token and browser-specific implementations (Gemini Nano for Chrome, Phi-4 Mini for Edge)
- [ ] **PIPE-06**: Each model implementation has its own system prompts, temperature settings, and token budget management tuned to that model's strengths
- [ ] **PIPE-07**: Pipeline maintains an anchor session to prevent model unload, with fresh sessions created per pass (each with its own system prompt) and destroyed individually
- [ ] **PIPE-08**: Pipeline uses `promptStreaming()` for the code generation pass to enable real-time token display

### User Interface

- [ ] **UI-01**: App displays a 3-pane split layout: prompt input (left), generated code (center), preview (right)
- [ ] **UI-02**: Code pane is visible by default and toggle-able (can be hidden/shown)
- [ ] **UI-03**: Prompt input pane has a textarea and a generate/submit button
- [ ] **UI-04**: App provides 5-10 curated prompt templates including canonical examples (todo list, calculator) and novel examples (landing page, contact form, countdown timer, quiz, dashboard card) that pre-fill the prompt textarea
- [ ] **UI-05**: App displays a loading/progress indicator while the pipeline is running (spinner or step indicator tied to pipeline state)
- [ ] **UI-06**: Code pane shows streaming tokens as they arrive during the code generation pass
- [ ] **UI-07**: Preview pane has a viewport toggle to switch between mobile (375px) and desktop (1280px) width
- [ ] **UI-08**: User can abort/cancel an in-progress generation via an abort button (wired to AbortController)

### Preview

- [ ] **PREV-01**: Generated HTML/CSS/JS renders in a sandboxed iframe using blob URLs (not `srcdoc`) with `sandbox="allow-scripts"` and without `allow-same-origin`
- [ ] **PREV-02**: Preview updates after code generation completes (final render, not incremental streaming)
- [ ] **PREV-03**: Preview iframe is isolated — no access to parent DOM, no shared origin, no cookie access

### Output & Export

- [ ] **OUT-01**: User can copy generated HTML code to clipboard via a copy button
- [ ] **OUT-02**: User can download the generated output as a single `.html` file
- [ ] **OUT-03**: App displays human-readable error messages when generation fails (QuotaExceededError, NotSupportedError, model not available, malformed output)
- [ ] **OUT-04**: Error messages are written for non-technical users — no stack traces, no jargon

### Quality & Testing

- [ ] **QA-01**: A synthetic prompt corpus exists with prompts at varying complexity: canonical (todo list, calculator), simple (landing page, greeting card), medium (contact form, countdown timer), and ambitious (quiz, dashboard card)
- [ ] **QA-02**: Prompt corpus is used to benchmark code generation quality across both models (Gemini Nano and Phi-4 Mini)
- [ ] **QA-03**: Prompt corpus doubles as CI warm-up prompts to cache inference state between workflow runs
- [ ] **QA-04**: Tests use structural assertions (well-formed HTML, expected elements) not snapshot tests — model output is non-deterministic

---

## v2 Requirements (Deferred)

- [ ] AI follow-up questions before generating — clarify user intent for better output
- [ ] Conversation history / multi-turn editing — refine output iteratively (blocked by token budget constraints: 6K Gemini Nano, 9K Phi-4 Mini)
- [ ] Self-repair loop — generate, detect errors (runtime + structural), auto-fix (research lint/debug passes first)
- [ ] Read-only code display with syntax highlighting (Prism.js or highlight.js)
- [ ] Prompt API tool calling integration — when browsers ship it, use for programmatic validation callbacks
- [ ] Parallel agent sessions via Web Workers — blocked until LanguageModel API adds Worker support

## v3+ Requirements (Future)

- [ ] File persistence (File System API or in-browser storage)
- [ ] Nodepod/wZed file explorer and code editor integration
- [ ] Image-to-code (screenshot/Figma input) — requires vision-capable model versions
- [ ] Code editor in UI (Monaco/CodeMirror) — heavy dependency, target audience is non-technical
- [ ] Deployment/hosting integration

---

## Out of Scope

- Cloud API fallback — explicitly excluded; core value is fully on-device inference, privacy, offline, zero cost
- macOS support — ONNX Runtime CoreML GPU fallback issue (documented in platform findings)
- WebContainer / Node.js runtime — requires commercial license, COOP/COEP headers, target output is static HTML not React/Vue
- Multi-page app generation — context window too small (6K-9K tokens)
- Backend/database generation — architecturally excluded; output is client-side HTML/CSS/JS only

---

## Traceability

<!-- Updated by roadmap creation -->

| REQ-ID  | Phase   | Status  |
| ------- | ------- | ------- |
| PIPE-01 | Phase 2 | Pending |
| PIPE-02 | Phase 2 | Pending |
| PIPE-03 | Phase 2 | Pending |
| PIPE-04 | Phase 2 | Pending |
| PIPE-05 | Phase 1 | Pending |
| PIPE-06 | Phase 1 | Pending |
| PIPE-07 | Phase 1 | Pending |
| PIPE-08 | Phase 2 | Pending |
| UI-01   | Phase 3 | Pending |
| UI-02   | Phase 3 | Pending |
| UI-03   | Phase 3 | Pending |
| UI-04   | Phase 3 | Pending |
| UI-05   | Phase 3 | Pending |
| UI-06   | Phase 3 | Pending |
| UI-07   | Phase 3 | Pending |
| UI-08   | Phase 3 | Pending |
| PREV-01 | Phase 2 | Pending |
| PREV-02 | Phase 2 | Pending |
| PREV-03 | Phase 2 | Pending |
| OUT-01  | Phase 3 | Pending |
| OUT-02  | Phase 3 | Pending |
| OUT-03  | Phase 3 | Pending |
| OUT-04  | Phase 3 | Pending |
| QA-01   | Phase 4 | Pending |
| QA-02   | Phase 4 | Pending |
| QA-03   | Phase 4 | Pending |
| QA-04   | Phase 4 | Pending |

---

_Requirements defined: 2026-03-23_
_Last updated: 2026-03-23 after research — PIPE-07 corrected (clone to fresh sessions), UI-08 added (abort)_
_27 v1 requirements across 5 categories_
