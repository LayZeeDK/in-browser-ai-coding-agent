# Feature Research

**Domain:** In-browser AI coding agent — code generation, preview rendering, multi-pass pipeline
**Researched:** 2026-03-23
**Confidence:** MEDIUM (token limit data HIGH; model quality claims MEDIUM; UX pattern applicability MEDIUM)

---

## Context: What This Milestone Adds

The existing app has LanguageModel API integration, model status UI, and dual-browser CI. This
milestone adds the actual coding-agent loop: take a natural-language description, generate
HTML/CSS/JS with an on-device model, and render it in a sandboxed preview. Two on-device models
are in scope:

- **Gemini Nano** (Chrome Beta): ~6,144-token context window (confirmed), per-prompt limit
  ~1,024 tokens (earlier reports, may have been relaxed to full 6 K in Chrome 137+). Weaker
  instruction-following. Good for fast CI iteration.
- **Phi-4 Mini 3.8B** (Edge Dev): 9,216-token context window in the Edge Prompt API (API-imposed
  ceiling; model natively supports 128 K). 74.4% HumanEval pass rate, outperforms all sub-4B
  models and most 8B models. Stronger reasoning. Slow CI cold-start (23-110 min ARM64).

Cloud tools for comparison: v0.dev uses large frontier models (GPT-4 class) and produces 9/10
quality output; Lovable and bolt.new sit at 6-7/10. Both are orders of magnitude larger than
Phi-4 Mini and have no on-device constraint.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature                              | Why Expected                                                              | Complexity           | Notes                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Natural-language prompt input        | Core value proposition; the whole point of the tool                       | LOW                  | Single `<textarea>`; no markdown editor needed yet                                                         |
| Live preview of generated code       | Every comparable tool (v0, bolt.new, CodePen) shows preview immediately   | MEDIUM               | Sandboxed `<iframe srcdoc>` with `sandbox="allow-scripts"` and no `allow-same-origin`; prevents XSS escape |
| Loading/progress indicator           | Generation takes 5-60s; blank screen reads as broken                      | LOW                  | Streaming via `promptStreaming()` lets you show tokens as they arrive                                      |
| Error feedback when generation fails | Blank output or crash with no message destroys trust                      | LOW                  | Catch `QuotaExceededError`, `NotSupportedError`, network errors; show human-readable message               |
| Copy generated code to clipboard     | Users expect to take their code with them                                 | LOW                  | Navigator Clipboard API; single button                                                                     |
| Download as HTML file                | Users expect a file they can open in a browser or send to someone         | LOW                  | `<a download>` with a `data:text/html` URL; zero dependencies                                              |
| Model download / status indicator    | Models are multi-GB; first-run blocks generation for minutes              | LOW (already exists) | Already in codebase; must stay visible and prominent                                                       |
| Responsive preview frame             | Generated pages must look usable; wrong viewport makes output look broken | LOW                  | Set `<iframe>` width to a realistic viewport (e.g., 375px mobile, 1280px desktop toggle)                   |

### Differentiators (Competitive Advantage)

Features that set this product apart. The core differentiator is fully on-device inference —
no cloud API, no data leaving the device, no usage cost. All features below amplify that story.

| Feature                                        | Value Proposition                                                                                                                                                                       | Complexity                         | Notes                                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 100% on-device inference (no cloud API)        | Privacy: code and prompts never leave the device. Offline: works without internet after model download. Zero marginal cost per generation.                                              | LOW (architecture already decided) | This is the #1 differentiator vs. v0.dev, bolt.new, Lovable. Lean into it in UI copy.                                                                                |
| Multi-pass pipeline (plan -> code)             | Small models (especially Gemini Nano) produce better output when given explicit intermediate steps. Chain-of-Thought + structured generation mitigates the gap vs. larger cloud models. | HIGH                               | Research shows 15%+ Pass@1 improvement with multi-agent pipelines. Two minimum passes: (1) pseudo-code/plan, (2) full HTML/CSS/JS. Optional third pass: self-review. |
| Streaming token display during generation      | Users see progress instead of a blank wait. Streaming is already in the Prompt API spec (`promptStreaming()`).                                                                          | MEDIUM                             | Show streaming output in a code preview area before rendering the iframe, OR render incrementally (harder). Showing tokens is simpler and equally reassuring.        |
| Prompt templates / example prompts             | Non-technical users face the "blank canvas" problem: they don't know what to type. Templates and examples solve the articulation barrier.                                               | LOW                                | Curated list: landing page, contact form, countdown timer, quiz, dashboard card. Selecting a template pre-fills the prompt box with a concrete, editable example.    |
| Per-model prompt engineering (DI architecture) | Gemini Nano and Phi-4 Mini have different instruction-following strengths. DI allows model-specific system prompts, temperature, and pipeline tuning without branching the UI.          | MEDIUM                             | Already planned in PROJECT.md. Gemini Nano needs more explicit, shorter prompts. Phi-4 Mini tolerates longer system prompts and produces better structured output.   |
| Structured JSON output for pipeline stages     | Using `responseConstraint` JSON schema forces the model to output structured plan data, which is then fed to the code-generation pass. Reduces hallucination of partial/invalid code.   | MEDIUM                             | `responseConstraint` is in the Prompt API spec and working in Chrome 137+. Use for the planning pass only; the code pass should output raw HTML.                     |
| Viewport toggle (mobile / desktop)             | Generated pages should look good on mobile. A simple toggle between 375px and 1280px preview widths tells users "this works responsively."                                              | LOW                                | Pure CSS iframe width toggle. No JavaScript required.                                                                                                                |

### Anti-Features (Deliberately Not Building)

| Anti-Feature                                              | Why Requested                                              | Why Problematic                                                                                                                                                                                                                                                                        | Alternative                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Cloud API fallback when on-device fails                   | Users want generation to always work                       | Destroys the core value proposition (privacy, offline, zero cost). Also architecturally complex: two different inference paths.                                                                                                                                                        | Show a clear "model not available" error with instructions to enable the browser feature.                           |
| Conversation history / multi-turn editing                 | Users want to refine output iteratively (like v0.dev chat) | Gemini Nano's ~6 K context window means long conversation history consumes most of the available tokens, degrading generation quality rapidly. Phi-4 Mini has 9,216-token API limit. Multi-turn is architecturally feasible but must wait until context management strategy is proven. | Defer to v1.x. The multi-pass pipeline is the v1 answer: the model refines internally, not through user chat turns. |
| Self-repair loop (generate → lint → auto-fix)             | Users want working code without debugging                  | Requires running JS execution (to detect runtime errors), feeding errors back to the model, and looping. Each pass consumes tokens. Phi-4 Mini may not produce reliably different output on re-prompt without explicit error context. High complexity for uncertain payoff in v1.      | Defer to v1.x. Detect structural validity (well-formed HTML) but do not attempt semantic repair in v1.              |
| File persistence (File System API / localStorage)         | Users want to save and return to their work                | Adds state management complexity without validating the core loop. File System API has permission UX friction.                                                                                                                                                                         | Defer to v2+. In v1, download/copy are sufficient persistence mechanisms.                                           |
| Code editor in the UI                                     | Users want to tweak generated code before previewing       | Full code editor (Monaco/CodeMirror) is a heavy dependency. The target audience is non-technical — editing raw HTML is not their goal.                                                                                                                                                 | Show generated code in a read-only view with syntax highlighting. Download for editing in a real editor.            |
| Multiple simultaneous AI sessions (Workers + parallelism) | Faster pipeline via parallel agent passes                  | `session.destroy()` unloads the model on Windows/Chrome. Parallel sessions on the same profile trigger `ProcessSingleton` conflicts. Memory usage doubles.                                                                                                                             | Use sequential passes in a single Worker. Research Workers first (already in PROJECT.md backlog).                   |
| WebContainer / Node.js runtime (bolt.new style)           | Run full Node.js in-browser for React/Vue output           | WebContainer requires commercial license, significant WASM overhead, and cross-origin isolation headers (COOP/COEP). The target output is static HTML/CSS/JS — no build step needed.                                                                                                   | Generate single-file HTML with inline CSS/JS. This is sufficient for the target user and the model's capabilities.  |
| Image-to-code (screenshot/Figma input)                    | v0.dev's highest-rated feature                             | Prompt API supports image inputs (`"image"` message type) but Gemini Nano and Phi-4 Mini are not vision-tuned for code generation. Image understanding quality is unpredictable on these models.                                                                                       | Text-only prompts in v1. Add image input in v2 if/when vision quality improves.                                     |
| Deployment / hosting integration                          | Users want a live URL for their generated page             | Requires server infrastructure, user accounts, and persistent storage — all out of scope for an on-device tool.                                                                                                                                                                        | Download + deploy manually. Or share via the copy-code button.                                                      |

---

## Feature Dependencies

```
Natural-language prompt input
    └──requires──> LanguageModel API wrapper (already exists)
    └──requires──> Model download / status indicator (already exists)

Multi-pass pipeline
    └──requires──> Natural-language prompt input
    └──requires──> Structured JSON output (responseConstraint, planning pass)
    └──requires──> Per-model DI architecture
    └──enhances──> Code quality vs. single-pass

Live preview
    └──requires──> Multi-pass pipeline (needs final HTML output)
    └──requires──> Sandboxed iframe (security boundary)

Streaming token display
    └──requires──> promptStreaming() API
    └──enhances──> Live preview (can show streaming code before iframe render)

Viewport toggle
    └──requires──> Live preview

Prompt templates
    └──enhances──> Natural-language prompt input
    └──has no other dependencies

Copy to clipboard / Download
    └──requires──> Multi-pass pipeline (needs final HTML output)

Error feedback
    └──requires──> Multi-pass pipeline (catches generation failures)

Loading/progress indicator
    └──enhances──> Streaming token display (streaming IS the indicator)

Self-repair loop (deferred) ──requires──> Live preview + error detection

Conversation history (deferred) ──conflicts──> Token budget (Gemini Nano 6 K, Phi-4 Mini 9 K limits)

File persistence (deferred) ──requires──> Download/copy (simpler substitute in v1)
```

### Dependency Notes

- **Multi-pass pipeline requires structured JSON output:** The planning pass must produce machine-readable pseudo-code/structure that the code pass can consume. Without `responseConstraint`, Gemini Nano's unreliable instruction-following makes structured handoff fragile.
- **Streaming display conflicts with iframe-first rendering:** You cannot stream partially-formed HTML into a live iframe reliably. Choose one: (a) stream to a code display area, then render the final HTML in the iframe, or (b) render the iframe only after generation completes. Option (a) is better UX.
- **Per-model DI must exist before pipeline tuning:** Gemini Nano needs shorter, more explicit prompts; Phi-4 Mini tolerates longer system prompts. A single prompt strategy that works for both will be suboptimal for both.
- **Conversation history is deferred because of token limits, not complexity:** Gemini Nano has ~6,144 tokens total. A two-pass pipeline (system prompt + plan + code prompt) already consumes 1,500-2,500 tokens leaving only 3,500-4,500 for output. Multi-turn conversation would crowd out generation headroom.

---

## MVP Definition

### Launch With (v1)

Minimum viable product for this milestone — validates the core prompt-to-preview loop.

- [ ] **Split-pane UI** (prompt left, preview right) — the classic playground layout; users know immediately what to do
- [ ] **Natural-language prompt input** with submit button — the entry point for the entire product
- [ ] **Prompt templates** (5-8 examples: landing page, form, timer, quiz, dashboard card) — solves the blank-canvas problem for non-technical users
- [ ] **Multi-pass pipeline** (plan pass + code pass at minimum) — required for acceptable output quality from small models
- [ ] **Per-model DI** (Gemini Nano vs. Phi-4 Mini system prompts and temperature) — required to get usable output from both models
- [ ] **Streaming token display** in code area during generation — prevents blank-screen anxiety; `promptStreaming()` is already in the API
- [ ] **Sandboxed iframe preview** (`sandbox="allow-scripts"`, no `allow-same-origin`) — renders final HTML output safely
- [ ] **Loading/progress indicator** tied to generation state — simple spinner or token counter
- [ ] **Error feedback** for generation failures (`QuotaExceededError`, model not available, malformed output) — trust-critical
- [ ] **Copy to clipboard** — minimum viable export
- [ ] **Download as single HTML file** — minimum viable persistence

### Add After Validation (v1.x)

Add once the core loop is working and generating useful output.

- [ ] **Viewport toggle** (mobile / desktop) — adds immediately once preview exists; low effort
- [ ] **Self-repair loop** (detect structural errors, re-prompt with error context) — improves output quality; complex, only add if baseline quality is insufficient
- [ ] **Conversation history / iterative refinement** — add only after demonstrating that context management can handle Gemini Nano's 6 K limit without degrading output quality
- [ ] **Read-only code display with syntax highlighting** (Prism.js or highlight.js, ~50KB gzip) — nice for technical users who want to inspect output

### Future Consideration (v2+)

Defer until product-market fit is established.

- [ ] **File persistence** (File System API) — requires state management and UX design for project management
- [ ] **Code editor integration** (Monaco/CodeMirror) — large dependency; target audience is non-technical
- [ ] **Image-to-code** — requires vision-capable model version; wait for model improvements
- [ ] **Parallel agent sessions** (Web Workers) — research first; complex CI implications
- [ ] **Deployment integration** — requires server infrastructure

---

## Feature Prioritization Matrix

| Feature                                   | User Value | Implementation Cost | Priority |
| ----------------------------------------- | ---------- | ------------------- | -------- |
| Split-pane UI                             | HIGH       | LOW                 | P1       |
| Prompt input + submit                     | HIGH       | LOW                 | P1       |
| Prompt templates                          | HIGH       | LOW                 | P1       |
| Multi-pass pipeline                       | HIGH       | HIGH                | P1       |
| Per-model DI                              | HIGH       | MEDIUM              | P1       |
| Sandboxed iframe preview                  | HIGH       | MEDIUM              | P1       |
| Streaming token display                   | HIGH       | MEDIUM              | P1       |
| Error feedback                            | HIGH       | LOW                 | P1       |
| Loading/progress indicator                | MEDIUM     | LOW                 | P1       |
| Copy to clipboard                         | MEDIUM     | LOW                 | P1       |
| Download as HTML file                     | MEDIUM     | LOW                 | P1       |
| Viewport toggle                           | MEDIUM     | LOW                 | P2       |
| Read-only code display (syntax highlight) | LOW        | LOW                 | P2       |
| Self-repair loop                          | HIGH       | HIGH                | P2       |
| Conversation history / multi-turn         | HIGH       | HIGH                | P2       |
| File persistence                          | MEDIUM     | HIGH                | P3       |
| Code editor                               | LOW        | HIGH                | P3       |
| Image-to-code                             | MEDIUM     | HIGH                | P3       |
| Parallel agent sessions                   | LOW        | HIGH                | P3       |

**Priority key:**

- P1: Must have for this milestone
- P2: Add post-validation (v1.x)
- P3: Deferred to future milestone (v2+)

---

## Competitor Feature Analysis

| Feature                      | v0.dev                         | bolt.new                           | Lovable                        | Our Approach                                               |
| ---------------------------- | ------------------------------ | ---------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| Inference model              | GPT-4 class (cloud)            | Claude 3.5 Sonnet (cloud)          | Claude/GPT (cloud)             | Gemini Nano + Phi-4 Mini (on-device)                       |
| Output type                  | React + Tailwind components    | Full-stack Node.js app             | Full-stack app + DB            | Single HTML file (inline CSS/JS)                           |
| Live preview                 | Yes (component preview)        | Yes (full dev server)              | Yes (app preview)              | Yes (sandboxed iframe)                                     |
| Code editing                 | Visual + text chat             | Full IDE in browser                | Partial visual editor          | No (read-only in v1)                                       |
| Multi-turn conversation      | Yes (chat-based refinement)    | Yes                                | Yes                            | No in v1 (multi-pass internal pipeline instead)            |
| Template library             | Yes (component gallery)        | No                                 | Yes (templates on paid plan)   | Yes (5-8 curated prompt examples)                          |
| Download / export            | React code copy                | GitHub push                        | GitHub sync                    | Download as single HTML file                               |
| Backend / database           | None                           | Supabase only                      | Supabase only                  | None (static HTML only)                                    |
| Privacy                      | Cloud; prompts sent to servers | Cloud; prompts sent to servers     | Cloud; prompts sent to servers | 100% on-device; nothing leaves browser                     |
| Offline use                  | No                             | No                                 | No                             | Yes (after model download)                                 |
| Cost per generation          | Credits (depletes rapidly)     | Credits ($1,000+ for complex apps) | Credits                        | Zero (on-device)                                           |
| Image-to-code                | Yes (Figma/screenshot)         | No                                 | No                             | No in v1                                                   |
| Error recovery               | Basic (re-prompt manually)     | Runtime error detection            | Basic                          | Structural validation; self-repair deferred                |
| Context limit                | Large (GPT-4: 128K)            | Large (Claude: 200K)               | Large                          | Tight: 6K (Gemini Nano), 9K (Phi-4 Mini via API)           |
| Code quality (vs. reference) | 9/10                           | 6/10                               | 7/10                           | Estimated 4-6/10 for simple tasks; lower for complex tasks |

**Key insight:** This tool cannot match cloud tools on code quality for complex apps. The
differentiator is the privacy + offline + zero-cost story, not output quality. Feature choices
should reinforce that positioning. A user who needs a React app with a database should use
Lovable. A user who wants a quick HTML page without sending their idea to a cloud server should
use this.

---

## Model Capability Assessment

### What Small Models Can Do Reliably

Based on Phi-4 Mini HumanEval 74.4% and the constraint on context windows:

| Task                                 | Gemini Nano  | Phi-4 Mini   | Notes                                                              |
| ------------------------------------ | ------------ | ------------ | ------------------------------------------------------------------ |
| Simple landing page (hero, nav, CTA) | Marginal     | Good         | ~400-800 tokens of HTML output; fits in both windows               |
| Contact form with validation         | Poor         | Marginal     | JS validation logic pushes toward 1,000+ tokens                    |
| CSS-only animations                  | Marginal     | Good         | Pure CSS; no JS token budget needed                                |
| JavaScript countdown timer           | Poor         | Marginal     | Requires coherent JS logic; Gemini Nano instruction-following weak |
| Simple quiz (3-5 questions)          | Poor         | Marginal     | Significant JS state management; may exceed output budget          |
| Responsive layout (flexbox/grid)     | Marginal     | Good         | CSS-heavy; within token budget                                     |
| Dashboard card / stats widget        | Poor         | Marginal     | Requires realistic data and layout coherence                       |
| Multi-page app                       | Not feasible | Not feasible | Context window far too small for multi-page output                 |
| App with backend / database          | Not feasible | Not feasible | Architecturally excluded                                           |

**Marginal** = works some of the time with good prompt engineering and a planning pass.
**Poor** = unreliable even with multi-pass pipeline; expect frequent regeneration needed.

### Token Budget Reality

A two-pass pipeline on Gemini Nano (~6,144 tokens total) looks like:

```
Pass 1 (planning):
  System prompt:           ~200 tokens
  User prompt:             ~50-100 tokens
  Model output (plan):     ~200-400 tokens
  Subtotal:                ~500 tokens

Pass 2 (code generation):
  System prompt:           ~300 tokens
  Plan (from pass 1):      ~200-400 tokens
  User prompt (echo):      ~50 tokens
  Model output (HTML):     ~1,000-3,000 tokens
  Subtotal:                ~2,000-4,000 tokens

Total consumed:            ~2,500-4,500 tokens
Remaining headroom:        ~1,600-3,600 tokens
```

This means a two-pass pipeline is viable but leaves little room for long conversations or
large HTML outputs. Aim for single-file HTML outputs under 200 lines for Gemini Nano.

Phi-4 Mini has 9,216 tokens via the Edge API. The same pipeline leaves ~4,500-6,500 tokens of
headroom — enough for somewhat more complex single-file outputs.

### Multi-Pass Pipeline Recommendation

Based on research on CoT and multi-agent pipelines showing 15%+ Pass@1 improvements:

1. **Pass 1 — Planning (JSON schema output):** Produce a structured plan (sections, components,
   interaction behaviors) using `responseConstraint`. This forces coherent output even from
   Gemini Nano and makes the code pass more reliable.
2. **Pass 2 — Code generation:** Feed the plan as structured context + user prompt + system
   prompt specifying output format (single HTML file, inline CSS/JS, no external dependencies).
3. **Optional Pass 3 — Structural review:** Re-prompt with the generated HTML asking for a
   short list of structural issues. Feed fixes back. Only viable on Phi-4 Mini where token
   budget allows.

A third pass on Gemini Nano is not recommended in v1 due to context budget constraints.

---

## Sources

- [W3C Prompt API spec](https://webmachinelearning.github.io/prompt-api/) — streaming, structured output, tool calling (HIGH confidence)
- [Chrome Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api) — capabilities, image input, language support (HIGH confidence)
- [Gemini Nano in Chrome 137 — swyx.io](https://www.swyx.io/gemini-nano) — 6,144-token context window confirmed (HIGH confidence)
- [Phi-4 Mini API token restriction issue](https://github.com/MicrosoftEdge/MSEdgeExplainers/issues/1224) — 9,216-token Edge API ceiling (HIGH confidence)
- [Phi-4-Mini technical report](https://arxiv.org/html/2503.01743v1) — 74.4% HumanEval, architecture, capabilities (HIGH confidence)
- [v0.dev vs bolt.new vs Lovable comparison](https://www.nxcode.io/resources/news/v0-vs-bolt-vs-lovable-ai-app-builder-comparison-2025) — competitor feature set (MEDIUM confidence)
- [Multi-agent code generation pipeline research](https://arxiv.org/html/2505.02133v1) — 15%+ Pass@1 improvement with multi-agent + debugging (HIGH confidence)
- [Iframe sandbox security](https://medium.com/@muyiwamighty/building-a-secure-code-sandbox-what-i-learned-about-iframe-isolation-and-postmessage-a6e1c45966df) — sandboxed iframe patterns for code playgrounds (MEDIUM confidence)
- [AI UX patterns — prompt augmentation](https://jakobnielsenphd.substack.com/p/prompt-augmentation) — template and suggestion patterns for non-technical users (MEDIUM confidence)
- [Chrome AI demos](https://chrome.dev/web-ai-demos/) — reference for what the Prompt API showcases (HIGH confidence)
- [Bolt.diy architecture](https://deepwiki.com/stackblitz-labs/bolt.diy) — streaming code generation architecture patterns (MEDIUM confidence)

---

_Feature research for: in-browser AI coding agent — code generation milestone_
_Researched: 2026-03-23_
