# Feature Landscape

**Domain:** In-browser AI coding agent -- prompt-to-preview code generation with on-device small language models
**Researched:** 2026-03-23
**Confidence:** MEDIUM-HIGH (competitor patterns HIGH; model capability claims MEDIUM; UX patterns HIGH; token budget analysis HIGH)

---

## Context: What This Milestone Adds

The existing app has a LanguageModel API wrapper service, model status/download UI, dual-browser CI
pipeline, and single-prompt inference. This milestone adds the actual coding-agent loop: natural
language prompt in, rendered HTML/CSS/JS preview out.

**Critical constraint:** Two on-device models, both small, both token-limited:

| Model                | Browser     | Context Window             | Output Ceiling                              | Code Quality (estimated) |
| -------------------- | ----------- | -------------------------- | ------------------------------------------- | ------------------------ |
| Gemini Nano (~3.25B) | Chrome Beta | ~6,144 tokens total        | ~3,000-4,000 tokens after pipeline overhead | 2-4/10 for code tasks    |
| Phi-4 Mini (3.8B)    | Edge Dev    | 9,216 tokens (API-imposed) | ~5,000-6,500 tokens after pipeline overhead | 4-6/10 for code tasks    |

**Confidence note on Gemini Nano code quality:** No published HTML code generation benchmarks exist
for Gemini Nano. Google positions it for summarization, reformulation, and classification -- not code
generation. The 2-4/10 estimate is based on its ~3.25B parameter count, limited context window, and
SitePoint's assessment that "multi-step chain-of-thought prompts or requests exceeding roughly 2,000
input tokens degrade noticeably" and "code generation pushes well beyond what Gemini Nano handles
reliably." Confidence: LOW.

**Confidence note on Phi-4 Mini code quality:** Phi-4 Mini achieves 74.4% HumanEval Pass@1 (HIGH
confidence, from the technical report). However, HumanEval measures Python function completion, not
HTML/CSS/JS page generation. A 2026 SLM-as-a-Judge study showed that Phi-4 Mini (4B class) has an
~11.6% Pass@1 gap vs. its larger family member. For HTML generation specifically, no benchmarks
exist. The 4-6/10 estimate accounts for strong reasoning but limited output length. Confidence: MEDIUM.

---

## Table Stakes

Features users expect. Missing these = product feels broken or incomplete.

| Feature                                      | Why Expected                                                              | Complexity           | Depends On                          | Notes                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------- | -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Natural-language prompt textarea             | The entire value proposition -- user types what they want                 | LOW                  | Existing LanguageModel API wrapper  | Single `<textarea>` + submit button; already partially exists in `model-status.component.ts`                              |
| Live preview of generated HTML/CSS/JS        | Every comparable tool (v0, bolt.new, CodePen, JSFiddle) shows preview     | MEDIUM               | Pipeline output, iframe sandbox     | Sandboxed `<iframe>` with `sandbox="allow-scripts"` (no `allow-same-origin`); blob URL or `srcdoc`                        |
| Loading/progress indicator during generation | Generation takes 5-60s on-device; blank screen reads as broken            | LOW                  | Pipeline state signals              | Streaming via `promptStreaming()` is the indicator -- show tokens arriving. Fall back to spinner if streaming unavailable |
| Error messages when generation fails         | Blank output or crash with no explanation destroys user trust immediately | LOW                  | Pipeline error handling             | Catch `QuotaExceededError`, `NotSupportedError`, model unavailable, malformed/truncated output; explain in plain English  |
| Copy generated code to clipboard             | Users expect to take their output with them                               | LOW                  | Pipeline output (final HTML string) | `navigator.clipboard.writeText()`; single button                                                                          |
| Download as .html file                       | Users expect a file they can open in any browser or share                 | LOW                  | Pipeline output (final HTML string) | `<a download>` with blob URL; zero dependencies                                                                           |
| Model download / status indicator            | Models are 2-4 GB; first-run blocks all generation until complete         | LOW (already exists) | Already built                       | Already in codebase as `model-status.component.ts`; must remain prominent                                                 |

### Why These Are Table Stakes

Cloud tools like v0.dev, bolt.new, and Lovable all provide prompt input, live preview, progress
indicators, and export. Users arriving from those tools (or from CodePen/JSFiddle) will expect the
same baseline. The on-device constraint changes the _quality_ of output but not the _shape_ of the
interaction -- users still expect to type, wait, see, and export.

---

## Differentiators

Features that set this product apart. Not expected, but valued -- and specifically amplified by the
on-device constraint.

| Feature                                        | Value Proposition                                                                                                                                                                                                                                                                | Complexity                                | Depends On                                           | Notes                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 100% on-device inference (no cloud API)        | Privacy: prompts never leave device. Offline: works without internet after model download. Zero cost per generation. No account required.                                                                                                                                        | LOW (architectural decision already made) | Existing infrastructure                              | This is the #1 differentiator vs. v0.dev, bolt.new, Lovable. All three send data to cloud servers, require accounts, and have credit/cost limits. Lean into this hard in UI copy.                                                                             |
| Multi-pass pipeline (plan then code)           | Small models produce materially better output with structured intermediate steps. Research shows SCoT prompting improves Pass@1 by up to 13.79% vs. standard CoT. Multi-stage guided generation (MSG) with planning + design + implementation phases further improves coherence. | HIGH                                      | Per-model DI, `responseConstraint` for planning pass | Two passes minimum: (1) structured JSON plan via `responseConstraint`, (2) HTML/CSS/JS code generation. The planning pass forces even Gemini Nano to produce coherent structure before attempting code.                                                       |
| Streaming token display during code generation | Users see the code being written instead of staring at a blank screen for 5-60s. Creates a sense of AI "working" that builds trust.                                                                                                                                              | MEDIUM                                    | `promptStreaming()` API, code display area           | Show streaming tokens in a code pane; render final HTML in iframe only after generation completes. Do NOT attempt incremental iframe rendering -- partially-formed HTML produces white screens and broken layouts.                                            |
| Prompt templates / example gallery             | Non-technical users face the "blank canvas problem" -- research shows unstructured starting points increase cognitive load and slow users down. Templates solve the articulation barrier.                                                                                        | LOW                                       | No dependencies beyond UI                            | 5-10 curated examples: landing page, contact form, countdown timer, quiz, dashboard card, greeting card, pricing table. Selecting a template pre-fills the textarea with an editable natural-language description, not code.                                  |
| Per-model prompt engineering via DI            | Gemini Nano and Phi-4 Mini have fundamentally different instruction-following strengths. A single prompt strategy that works for both will be suboptimal for both.                                                                                                               | MEDIUM                                    | Angular DI, abstract model service                   | Gemini Nano needs shorter, more explicit, more constrained prompts. Phi-4 Mini tolerates longer system prompts and produces better structured output. DI isolates this without branching the UI or pipeline logic.                                            |
| Structured JSON output for planning pass       | `responseConstraint` (JSON Schema) forces the model to output machine-readable plan data, reducing hallucinated or partial code in Pass 1. Available in Chrome 137+ and Edge.                                                                                                    | MEDIUM                                    | `responseConstraint` API, JSON Schema definition     | Use for planning pass only. Code generation pass should output raw HTML -- constraining HTML output to a JSON schema would waste tokens on escaping and wrapping. `responseConstraint` consumes context window tokens; use `measureContextUsage()` to budget. |
| Viewport toggle (mobile / desktop preview)     | Generated pages should look usable at different widths; toggle demonstrates the output is responsive.                                                                                                                                                                            | LOW                                       | Preview iframe exists                                | Pure CSS iframe width toggle: 375px (mobile) vs 1280px (desktop). No JavaScript required.                                                                                                                                                                     |
| Truncation detection and error recovery        | Small models frequently hit output token limits mid-generation, producing broken HTML (unclosed tags, missing `</body>`). Detecting this before rendering prevents blank/broken previews.                                                                                        | MEDIUM                                    | Pipeline output, DOMParser                           | Parse output with `DOMParser`, check for well-formedness. If `</html>` is missing or structure is broken, show "Output was truncated" error instead of rendering garbage. This is unique to small on-device models -- cloud tools rarely truncate.            |

### Why These Differentiate

The on-device story (privacy, offline, zero cost) is the primary differentiator vs. every cloud tool.
The multi-pass pipeline and per-model prompt engineering are differentiators _within_ the on-device
space -- they demonstrate that a small model can produce usable output when given proper scaffolding.
Truncation detection is a differentiator by necessity: cloud tools with 128K-200K context windows
rarely truncate, but 6K-9K on-device models truncate frequently. Handling it gracefully is a quality
signal.

---

## Anti-Features

Features to deliberately NOT build. Each has been considered and rejected with reasoning.

| Anti-Feature                                         | Why It Seems Desirable                                                              | Why It Is Problematic                                                                                                                                                                                                                                                                                                                                                              | What to Do Instead                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud API fallback                                   | Users want generation to always work, even when on-device model is unavailable      | Destroys the core value proposition (privacy, offline, zero cost). Creates two inference paths with different quality levels, confusing users about what to expect.                                                                                                                                                                                                                | Show a clear "model not available" error with browser-specific instructions to enable the LanguageModel API and download the model.                                                                                                |
| Conversation history / multi-turn editing            | v0.dev and Lovable use chat-based refinement; users may expect iterative refinement | Gemini Nano has ~6,144 tokens total. A two-pass pipeline already consumes 2,500-4,500 tokens for system prompts + plan + code prompt. Adding conversation history would crowd out generation headroom, degrading output quality with each turn. Even Phi-4 Mini's 9,216 tokens leave minimal room. Bolt.new reports "context loss after 15-20 iterations" with much larger models. | The multi-pass pipeline IS the v1 answer to refinement: the model refines internally via planning + code passes. Users can re-generate with a modified prompt. Defer conversation history to v2 once context management is proven. |
| Self-repair loop (generate, detect errors, auto-fix) | Users want working code without manual debugging                                    | Each repair pass consumes tokens from an already-tight budget. Phi-4 Mini may not produce reliably different output on re-prompt without explicit error context. The loop could burn through the entire context window on a single generation attempt. High complexity for uncertain payoff at this model size.                                                                    | Detect structural validity (well-formed HTML via DOMParser) but do NOT attempt semantic repair. Show "output has issues" with a regenerate button. Defer self-repair to v2 after pipeline quality is established.                  |
| Full code editor (Monaco/CodeMirror)                 | Power users want to tweak generated code before previewing                          | Monaco is ~2.5 MB (minified). CodeMirror is lighter but still significant. Target audience is non-technical -- editing raw HTML defeats the purpose. Adding an editor also creates a second code-entry path alongside the prompt, doubling the UX surface area.                                                                                                                    | Show generated code in a read-only `<pre>` or `<code>` block. Copy/download for editing in a real editor. Consider syntax highlighting (Prism.js, ~11KB) as a v1.x enhancement, not a v1 feature.                                  |
| WebContainer / Node.js runtime                       | bolt.new generates full React/Vue apps running in-browser via WebContainer          | WebContainer requires a commercial license for production use, adds COOP/COEP header requirements, and is massive WASM overhead. The target output is static HTML/CSS/JS -- no build step needed. Small models cannot reliably generate React component trees or npm-dependent code within 6K-9K tokens.                                                                           | Generate single-file HTML with inline CSS and JS. This is the correct scope for 3-4B parameter models.                                                                                                                             |
| Image-to-code (screenshot/Figma input)               | v0.dev's highest-rated feature; Figma Make launched design-to-code                  | The Prompt API supports image inputs, but Gemini Nano and Phi-4 Mini are not vision-tuned for code generation from screenshots. Image understanding quality is unpredictable at this model size. Adding image input also doubles the input UX complexity.                                                                                                                          | Text-only prompts in v1. Add image input in v2 if/when on-device models with vision-code capabilities ship.                                                                                                                        |
| Multiple simultaneous AI sessions (Web Workers)      | Faster pipeline via parallel agent passes                                           | `session.destroy()` can unload the model if no other sessions reference it. Parallel sessions on the same profile trigger ProcessSingleton conflicts on Chrome. Memory usage doubles. The LanguageModel API does not yet support Worker contexts.                                                                                                                                  | Sequential passes in the main thread. Use `session.clone()` for per-pass sessions sharing the anchor session's model weights. Research Workers when the API adds support.                                                          |
| Deployment/hosting integration                       | Users want a live URL for their generated page                                      | Requires server infrastructure, user accounts, persistent storage, and hosting costs -- all contrary to the on-device, zero-cost philosophy.                                                                                                                                                                                                                                       | Download the HTML file and host it anywhere (Netlify Drop, GitHub Pages, email attachment). The file is self-contained.                                                                                                            |
| Follow-up questions before generating                | Clarify user intent for more precise output (like a product requirements interview) | Adds complexity to the UX for non-technical users. Each clarification question consumes tokens. v1 should prove the prompt-to-code pipeline works before adding pre-processing steps.                                                                                                                                                                                              | Use prompt templates to guide users toward well-specified prompts. Prompt augmentation (rewriting the user's prompt to be more detailed) is a better v2 approach than interrogation.                                               |

---

## Feature Dependencies

```
Natural-language prompt input
    requires --> LanguageModel API wrapper (ALREADY EXISTS)
    requires --> Model download / status indicator (ALREADY EXISTS)

Per-model DI architecture (abstract ModelService)
    requires --> LanguageModel API wrapper (ALREADY EXISTS)
    blocks --> Multi-pass pipeline (needs model-specific prompts)
    blocks --> Prompt engineering per model

Multi-pass pipeline (plan pass + code pass)
    requires --> Per-model DI architecture
    requires --> Structured JSON output (responseConstraint, planning pass)
    requires --> Natural-language prompt input
    blocks --> Live preview (needs final HTML output)
    blocks --> Streaming token display (needs code gen pass)
    blocks --> Error feedback (catches generation failures)
    blocks --> Copy/Download (needs final HTML string)

Sandboxed iframe preview
    requires --> Multi-pass pipeline (needs final HTML output)
    requires --> Truncation detection (should not render broken HTML)
    blocks --> Viewport toggle

Streaming token display
    requires --> promptStreaming() API
    requires --> Multi-pass pipeline (code gen pass)
    enhances --> Loading/progress indicator (streaming IS the primary indicator)

Prompt templates
    enhances --> Natural-language prompt input
    has no hard dependencies (can be built in parallel with pipeline)

Viewport toggle
    requires --> Sandboxed iframe preview

Copy to clipboard / Download as HTML
    requires --> Multi-pass pipeline (needs final HTML output)
    can be built independently once pipeline outputs HTML

Truncation detection
    requires --> Multi-pass pipeline (needs raw output to analyze)
    enhances --> Error feedback (specific "truncated" error message)

Error feedback
    requires --> Multi-pass pipeline (catches errors)
    requires --> Truncation detection (specific error type)
```

### Dependency Notes

- **Per-model DI must exist before pipeline tuning.** The pipeline's prompt strategies differ
  fundamentally between models. Building the pipeline first and adding DI later means building it
  twice.
- **Structured JSON planning pass requires `responseConstraint`.** This is available in Chrome 137+
  and Edge. Without it, Gemini Nano's weaker instruction-following makes structured plan output
  unreliable. The planning pass is what makes the multi-pass pipeline work -- without structure, it
  degrades to two uncoordinated single-pass attempts.
- **Streaming display conflicts with iframe-first rendering.** You cannot stream partially-formed
  HTML into a live iframe reliably (unclosed tags, missing CSS, broken JS). The design is: stream
  tokens to a code display area, render the iframe only after generation completes and truncation
  check passes.
- **Truncation detection must happen before preview rendering.** Rendering truncated HTML produces
  broken layouts, missing content, or white screens. The pipeline should parse with DOMParser and
  check for structural completeness before handing output to the iframe.
- **Conversation history is deferred because of token limits, not complexity.** Gemini Nano has
  ~6,144 tokens total. A two-pass pipeline consumes 2,500-4,500 tokens for system prompt + plan +
  code prompt, leaving only 1,600-3,600 for output. Adding prior conversation context would leave
  almost no room for generated code.

---

## MVP Recommendation

### Launch With (v1.0 Milestone)

Prioritized by dependency order and user-facing impact:

1. **Per-model DI architecture** -- everything else injects this; must be first
2. **Multi-pass pipeline** (plan pass + code pass) -- core product capability; quality depends on this
3. **Structured JSON planning pass** (`responseConstraint`) -- makes the pipeline actually work for small models
4. **Streaming token display** (`promptStreaming()`) -- prevents blank-screen anxiety; shows progress
5. **Sandboxed iframe preview** (`sandbox="allow-scripts"`, blob URL, no `allow-same-origin`) -- renders output
6. **Truncation detection** (DOMParser well-formedness check) -- prevents broken previews
7. **Natural-language prompt textarea** with submit button -- entry point
8. **Prompt templates** (5-8 curated examples) -- solves blank canvas problem
9. **Loading/progress indicator** tied to pipeline state -- spinner for non-streaming phases
10. **Error feedback** for failures (`QuotaExceededError`, model unavailable, truncation, malformed output)
11. **Copy to clipboard** -- minimum viable export
12. **Download as HTML file** -- minimum viable persistence
13. **Viewport toggle** (mobile 375px / desktop 1280px) -- low effort once preview exists

### Defer to v1.x (Post-Validation)

Add once the core loop works and generates useful output:

- **Self-repair loop** (detect structural errors, re-prompt with error context) -- improves quality
  but consumes tokens and adds complexity; only add if baseline quality is insufficient
- **Syntax highlighting for code display** (Prism.js or highlight.js, ~11-50KB gzip) -- nice for
  technical users who want to inspect output
- **Prompt augmentation** (rewrite user's prompt to be more specific before sending to model) --
  bridges the articulation gap without conversation history
- **Conversation history / iterative refinement** -- only after proving context management can handle
  Gemini Nano's 6K limit without degrading output

### Defer to v2+ (Future Milestones)

- **File persistence** (File System API) -- requires state management, project management UX
- **Code editor integration** (Monaco/CodeMirror) -- large dependency; wrong audience
- **Image-to-code** -- requires vision-capable on-device model versions
- **Parallel agent sessions** (Web Workers) -- blocked by LanguageModel API Worker support
- **Deployment integration** -- requires server infrastructure

---

## Feature Prioritization Matrix

| Feature                       | User Value                       | Implementation Cost | Risk                                      | Priority |
| ----------------------------- | -------------------------------- | ------------------- | ----------------------------------------- | -------- |
| Per-model DI                  | HIGH (enables all tuning)        | MEDIUM              | LOW                                       | P0       |
| Multi-pass pipeline           | HIGH (core product)              | HIGH                | HIGH (model quality uncertainty)          | P0       |
| Structured JSON planning pass | HIGH (makes pipeline work)       | MEDIUM              | MEDIUM (responseConstraint API stability) | P0       |
| Sandboxed iframe preview      | HIGH (shows the result)          | MEDIUM              | LOW                                       | P0       |
| Natural-language prompt input | HIGH (entry point)               | LOW                 | LOW                                       | P0       |
| Streaming token display       | HIGH (eliminates blank screen)   | MEDIUM              | LOW (promptStreaming is stable)           | P0       |
| Error feedback                | HIGH (trust-critical)            | LOW                 | LOW                                       | P0       |
| Prompt templates              | HIGH (blank canvas problem)      | LOW                 | LOW                                       | P0       |
| Copy to clipboard             | MEDIUM (export)                  | LOW                 | LOW                                       | P0       |
| Download as HTML              | MEDIUM (export)                  | LOW                 | LOW                                       | P0       |
| Truncation detection          | MEDIUM (prevents broken preview) | MEDIUM              | LOW                                       | P0       |
| Loading/progress indicator    | MEDIUM (UX polish)               | LOW                 | LOW                                       | P0       |
| Viewport toggle               | MEDIUM (responsive preview)      | LOW                 | LOW                                       | P1       |
| Syntax highlighting           | LOW (developer appeal)           | LOW                 | LOW                                       | P1       |
| Self-repair loop              | HIGH (quality)                   | HIGH                | HIGH (token budget)                       | P2       |
| Prompt augmentation           | MEDIUM (UX)                      | MEDIUM              | MEDIUM                                    | P2       |
| Conversation history          | HIGH (refinement)                | HIGH                | HIGH (context budget)                     | P2       |

**Priority key:**

- P0: Must have for this milestone (v1.0)
- P1: Add immediately after core loop works (v1.x)
- P2: Deferred to future milestone

---

## Competitor Feature Analysis

| Feature             | v0.dev                       | bolt.new                           | Lovable            | CodePen/JSFiddle           | Our Approach                                                       |
| ------------------- | ---------------------------- | ---------------------------------- | ------------------ | -------------------------- | ------------------------------------------------------------------ |
| Inference model     | GPT-4 class (cloud)          | Claude Sonnet (cloud)              | Claude/GPT (cloud) | N/A (no AI)                | Gemini Nano + Phi-4 Mini (on-device, 3-4B params)                  |
| Output type         | React + Tailwind             | Full-stack Node.js                 | Full-stack + DB    | User-written code          | Single HTML file (inline CSS/JS)                                   |
| Live preview        | Yes (component)              | Yes (WebContainer dev server)      | Yes (app preview)  | Yes (iframe)               | Yes (sandboxed iframe)                                             |
| Code editing        | Visual + text chat           | Full IDE                           | Partial visual     | Full editor                | Read-only display (v1)                                             |
| Multi-turn chat     | Yes                          | Yes                                | Yes                | N/A                        | No (multi-pass internal pipeline instead)                          |
| Streaming output    | Yes                          | Yes (real-time code writing)       | Yes                | N/A                        | Yes (promptStreaming tokens in code pane)                          |
| Template library    | Yes (components)             | No                                 | Yes (paid)         | Community pens             | Yes (5-8 curated prompt examples, free)                            |
| Download/export     | React code copy              | GitHub push                        | GitHub sync        | Download pen               | Download as single HTML file                                       |
| Privacy             | Cloud (data sent to servers) | Cloud                              | Cloud              | User code stays in browser | 100% on-device; nothing leaves browser                             |
| Offline use         | No                           | No                                 | No                 | Editing yes, no AI         | Yes (after model download)                                         |
| Cost per generation | Credits ($20/mo+)            | Credits ($20/mo+)                  | Credits ($20/mo+)  | Free (no AI)               | Zero (on-device, free)                                             |
| Account required    | Yes                          | Yes                                | Yes                | Optional                   | No                                                                 |
| Context limit       | Large (128K-200K)            | Large (200K)                       | Large              | N/A                        | Tight: 6K (Gemini Nano), 9K (Phi-4 Mini)                           |
| Code quality        | 9/10                         | 6-7/10                             | 7/10               | User-dependent             | Estimated 3-6/10 depending on model and task complexity            |
| Error recovery      | Re-prompt chat               | Runtime error detection + auto-fix | Basic re-prompt    | Manual debugging           | Structural validation + truncation detection; self-repair deferred |
| Responsive preview  | Yes                          | Yes (mobile/tablet/desktop)        | Yes                | Resize pane                | Yes (375px / 1280px toggle)                                        |

### Key Competitive Insight

This tool cannot match cloud tools on code quality for complex applications. The context window is
20-30x smaller. The model quality is 3-10x weaker. Users who need a React app with a database
should use Lovable or bolt.new.

**Where this tool wins:**

- Privacy: zero data leaves the device (GDPR/HIPAA compliant by design)
- Cost: zero marginal cost per generation (no credits, no subscription for inference)
- Offline: fully functional after initial model download
- No account: no signup, no login, no data collection
- Speed to first generation: instant (no API latency, no queue)

**Where this tool loses:**

- Output quality (3-6/10 vs 6-9/10)
- Output complexity (single HTML page vs full-stack app)
- Refinement capability (no multi-turn vs chat-based iteration)
- Framework support (raw HTML vs React/Vue/Svelte)

Feature choices must reinforce the winning positioning, not try to compete on the losing dimensions.

---

## Model Capability Assessment

### What Small On-Device Models Can Do Reliably

Based on Phi-4 Mini HumanEval 74.4%, SLM code generation research, context window constraints, and
the SCoT prompting improvement data:

| Task                                 | Gemini Nano (est.) | Phi-4 Mini (est.) | Output Size         | Notes                                |
| ------------------------------------ | ------------------ | ----------------- | ------------------- | ------------------------------------ |
| Simple landing page (hero, nav, CTA) | Marginal           | Good              | ~400-800 tokens     | CSS-heavy; within both windows       |
| Greeting card / announcement         | Marginal           | Good              | ~300-600 tokens     | Simple layout, minimal JS            |
| CSS-only animations / effects        | Marginal           | Good              | ~300-500 tokens     | Pure CSS; no JS budget needed        |
| Contact form with basic validation   | Poor               | Marginal          | ~800-1,200 tokens   | JS validation logic adds complexity  |
| Countdown timer                      | Poor               | Marginal          | ~600-1,000 tokens   | Requires coherent JS intervals logic |
| Simple quiz (3-5 questions)          | Poor               | Marginal          | ~1,000-1,500 tokens | Significant JS state management      |
| Responsive layout (flexbox/grid)     | Marginal           | Good              | ~400-700 tokens     | CSS layout; reliable pattern         |
| Dashboard card / stats widget        | Poor               | Marginal          | ~600-1,000 tokens   | Requires realistic mock data         |
| Pricing table (3 tiers)              | Marginal           | Good              | ~500-900 tokens     | Mostly HTML/CSS structure            |
| Calculator                           | Poor               | Marginal-Good     | ~800-1,200 tokens   | Well-represented in training data    |
| Multi-section page (3+ sections)     | Poor               | Poor-Marginal     | ~1,500-2,500 tokens | May exceed Gemini Nano output budget |
| Multi-page application               | Not feasible       | Not feasible      | >3,000 tokens       | Context window too small             |
| App with backend/database            | Not feasible       | Not feasible      | N/A                 | Architecturally excluded             |

**Rating definitions:**

- **Good** = works most of the time with proper prompt engineering and planning pass
- **Marginal** = works some of the time; expect frequent regeneration needed
- **Poor** = unreliable even with multi-pass pipeline; user will often need to regenerate or simplify
- **Not feasible** = physically impossible given context window or architecture constraints

### Token Budget Reality

**Gemini Nano (~6,144 tokens total, pipeline budget):**

```
Pass 1 (planning):
  System prompt:           ~200 tokens
  User prompt:             ~50-100 tokens
  responseConstraint overhead: ~50-100 tokens
  Model output (JSON plan):  ~200-400 tokens
  Subtotal:                ~500-800 tokens

Pass 2 (code generation):
  System prompt:           ~300 tokens
  Plan (from Pass 1):      ~200-400 tokens
  User prompt (echo):      ~50 tokens
  Model output (HTML/CSS/JS): ~1,000-3,000 tokens
  Subtotal:                ~1,550-3,750 tokens

Total pipeline:            ~2,050-4,550 tokens
Maximum HTML output:       ~3,000 tokens (~150-200 lines)
```

Single-file HTML outputs should target under 200 lines for Gemini Nano.

**Phi-4 Mini (9,216 tokens via Edge API, pipeline budget):**

```
Pass 1 (planning):
  System prompt:           ~300 tokens
  User prompt:             ~50-100 tokens
  responseConstraint overhead: ~50-100 tokens
  Model output (JSON plan):  ~300-500 tokens
  Subtotal:                ~700-1,000 tokens

Pass 2 (code generation):
  System prompt:           ~400 tokens
  Plan (from Pass 1):      ~300-500 tokens
  User prompt (echo):      ~50 tokens
  Model output (HTML/CSS/JS): ~2,000-5,000 tokens
  Subtotal:                ~2,750-5,950 tokens

Total pipeline:            ~3,450-6,950 tokens
Maximum HTML output:       ~5,000 tokens (~250-350 lines)
```

Phi-4 Mini has roughly 50-65% more output headroom than Gemini Nano.

---

## Multi-Pass Pipeline Recommendation

Based on research into Structured Chain-of-Thought (SCoT) prompting (up to 13.79% Pass@1
improvement), Multi-Stage Guided code generation (MSG: planning + design + implementation), and
DSPy's modular pipeline optimization for small models:

### Recommended Pipeline Structure

**Pass 1 -- Structured Planning (JSON output via `responseConstraint`):**

- Input: system prompt + user's natural-language description
- Output: JSON object describing page sections, component types, interaction behaviors, color scheme
- Purpose: forces coherent structure even from Gemini Nano; provides explicit intermediate reasoning
- Uses `responseConstraint` with a JSON Schema to guarantee parseable output
- Budget: ~500-1,000 tokens total

**Pass 2 -- Code Generation (streaming raw HTML):**

- Input: system prompt + JSON plan (from Pass 1) + user prompt echo
- Output: single HTML file with inline `<style>` and `<script>` blocks
- Purpose: generates the actual code, guided by the structured plan
- Uses `promptStreaming()` for real-time token display in the code pane
- Budget: remainder of context window after Pass 1

**Pass 3 -- Structural Validation (deterministic JavaScript, not AI):**

- Input: raw HTML string from Pass 2
- Operation: `DOMParser` well-formedness check, `</html>` presence, unclosed tag detection
- Purpose: truncation detection and basic quality gate before rendering
- This is NOT an AI pass -- it is a programmatic check. Deterministic work should not consume tokens.

**Optional future pass (v2) -- AI Review + Repair:**

- Re-prompt with generated HTML asking for a short list of structural issues
- Only viable on Phi-4 Mini where token budget allows a third AI pass
- Not recommended for Gemini Nano in v1 due to context budget constraints

### Why Two AI Passes, Not One or Three

**One pass fails** because small models (~3-4B params) need explicit intermediate reasoning to produce
coherent code. Without a plan, the model tries to simultaneously decide structure, choose colors,
write JS logic, and format HTML -- producing chaotic output. SCoT research confirms that structured
intermediate steps materially improve code generation quality.

**Three AI passes are too expensive in v1** because the planning + code passes already consume
2,000-5,000 tokens. A third AI pass (review/repair) would need the full generated HTML as input
context, potentially exceeding Gemini Nano's 6K budget entirely. On Phi-4 Mini, a third pass is
theoretically possible but risky -- better to defer until v2 when the baseline pipeline quality is
established.

**A deterministic validation pass (Pass 3) is free** -- it uses zero tokens and catches the most
common failure mode (truncation) before it reaches the user.

---

## Sandbox Security Recommendation

Based on research into iframe sandbox patterns used by CodePen, JSFiddle, and the Vue Repl, plus
MDN and web.dev security guidance:

**Use blob URL + `sandbox="allow-scripts"` (no `allow-same-origin`).**

Rationale:

- `allow-scripts` is required because generated code contains `<script>` blocks
- Omitting `allow-same-origin` forces an opaque origin, preventing the iframe from accessing the
  parent page's DOM, cookies, localStorage, or any same-origin resources
- Blob URL (not `srcdoc`) avoids escaping issues with inline HTML strings that may contain quotes,
  backticks, or other characters that break `srcdoc` attribute parsing. The project requirements
  already specify blob URL over `srcdoc`
- `URL.revokeObjectURL()` after iframe loads to prevent stale references
- No `allow-forms`, `allow-popups`, `allow-top-navigation` -- these are not needed and each one
  widens the attack surface

This matches the requirements document (PREV-01, PREV-02, PREV-03) and provides defense-in-depth
through origin isolation.

---

## UX Patterns for Non-Technical Users

Based on research into the "blank canvas problem" and AI UX patterns:

### Prompt Templates (Solving the Blank Canvas)

Research shows that unstructured starting points increase cognitive load. Non-technical users don't
know how to craft an effective prompt. Solution: curated template gallery.

**Recommended template set (8 examples spanning complexity tiers):**

| Template              | Category       | Expected Quality (Phi-4 Mini) | Example Prompt Text                                                                                |
| --------------------- | -------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Personal landing page | Simple         | Good                          | "A personal portfolio landing page with a hero section, about me paragraph, and contact links"     |
| Greeting card         | Simple         | Good                          | "A birthday greeting card with a festive design, animated confetti, and a personalized message"    |
| Pricing table         | Simple         | Good                          | "A pricing comparison table with three tiers: Basic, Pro, and Enterprise, with feature checkmarks" |
| Contact form          | Medium         | Marginal                      | "A contact form with name, email, and message fields, plus client-side validation"                 |
| Countdown timer       | Medium         | Marginal                      | "A countdown timer showing days, hours, minutes, and seconds until a specific date"                |
| Simple quiz           | Medium-Complex | Marginal                      | "A 5-question multiple choice quiz about world capitals with a score at the end"                   |
| Calculator            | Medium-Complex | Marginal-Good                 | "A calculator app with basic arithmetic operations and a clean, modern design"                     |
| Dashboard card        | Complex        | Marginal                      | "A dashboard stats card showing revenue, users, and growth with mock data and a mini chart"        |

### Error Messages for Non-Technical Users

Every error must be explained without technical jargon:

| Technical Error               | User-Facing Message                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `QuotaExceededError`          | "The AI model ran out of memory for this request. Try a simpler description."                |
| `NotSupportedError`           | "This browser doesn't support on-device AI. Please use Chrome Beta or Edge Dev."             |
| Model not available           | "The AI model isn't ready yet. Please download it first using the button above."             |
| Truncated output              | "The AI couldn't finish generating the full page. Try a simpler design with fewer sections." |
| Malformed HTML                | "The generated code has some issues. Try generating again -- results may vary."              |
| `InvalidStateError`           | "The AI model couldn't start. Please refresh the page and try again."                        |
| Network error during download | "Model download was interrupted. Please check your internet connection and try again."       |

---

## Sources

### HIGH Confidence (Official docs, specs, research papers)

- [W3C Prompt API spec](https://webmachinelearning.github.io/prompt-api/) -- streaming, structured output, session management
- [Chrome Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api) -- capabilities, `promptStreaming()`, `responseConstraint`
- [Chrome structured output docs](https://developer.chrome.com/docs/ai/structured-output-for-prompt-api) -- JSON Schema constraints, RegExp constraints
- [Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) -- Edge-specific implementation
- [Phi-4-Mini technical report](https://arxiv.org/html/2503.01743v1) -- 74.4% HumanEval, 3.8B params, architecture
- [SCoT prompting for code generation](https://arxiv.org/abs/2305.06599) -- up to 13.79% Pass@1 improvement
- [Multi-stage guided code generation (MSG)](https://www.sciencedirect.com/science/article/abs/pii/S095219762401649X) -- planning + design + implementation phases
- [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) -- `sandbox` attribute security
- [web.dev sandboxed iframes](https://web.dev/articles/sandboxed-iframes) -- security best practices

### MEDIUM Confidence (Multiple sources agree, community verified)

- [v0 vs bolt.new vs Lovable comparison (NxCode)](https://www.nxcode.io/resources/news/v0-vs-bolt-vs-lovable-ai-app-builder-comparison-2025) -- competitor features
- [v0 vs bolt vs Lovable (ToolJet)](https://blog.tooljet.com/lovable-vs-bolt-vs-v0/) -- competitor analysis
- [bolt.diy architecture (DeepWiki)](https://deepwiki.com/stackblitz-labs/bolt.diy) -- streaming code generation patterns
- [SitePoint Chrome Prompt API tutorial](https://www.sitepoint.com/chrome-window-ai-prompt-api-tutorial/) -- Gemini Nano limitations
- [Prompt augmentation UX patterns (Jakob Nielsen)](https://jakobnielsenphd.substack.com/p/prompt-augmentation) -- template and suggestion patterns
- [Blank canvas UX problem (Yukti Poddar)](https://medium.com/ui-for-ai/no-more-blank-canvas-rethinking-how-people-start-with-ai-fd427af24dc8) -- blank canvas research
- [Shape of AI patterns](https://www.shapeof.ai) -- GenAI UX pattern library
- [Code generation with small language models (Codeforces study)](https://arxiv.org/abs/2504.07343) -- SLM code quality benchmarks
- [Iframe sandbox security (2026)](https://qrvey.com/blog/iframe-security/) -- current best practices
- [Building a secure code sandbox (Muyiwa Johnson)](https://medium.com/@muyiwamighty/building-a-secure-code-sandbox-what-i-learned-about-iframe-isolation-and-postmessage-a6e1c45966df) -- iframe isolation patterns
- [Browser sandbox architecture deep dive](https://dev.to/alexgriss/the-architecture-of-browser-sandboxes-a-deep-dive-into-javascript-code-isolation-1dnj) -- JS isolation mechanisms

### LOW Confidence (Single source, unverified, training-data-only)

- Gemini Nano code generation quality estimates (no published benchmarks found)
- HTML-specific output quality predictions for either model (extrapolated from HumanEval/Python benchmarks)
- Exact token consumption by `responseConstraint` schema overhead (API-specific, needs measurement)

---

_Feature research for: in-browser AI coding agent -- v1.0 prompt-to-preview milestone_
_Researched: 2026-03-23_
_Overall confidence: MEDIUM-HIGH_
