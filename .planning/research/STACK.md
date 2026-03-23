# Stack Research

**Domain:** In-browser AI coding agent — code generation, preview rendering, multi-pass pipeline
**Researched:** 2026-03-23
**Confidence:** MEDIUM-HIGH (API layer verified via official docs; model capability claims are MEDIUM due to limited Gemini Nano HTML/CSS benchmark data)

---

## Context: What Is Already In Place

Do not re-research or replace these. They are locked in.

| Technology               | Version | Role                                                                |
| ------------------------ | ------- | ------------------------------------------------------------------- |
| Angular                  | ~21.2.0 | App framework — standalone components, signals, OnPush              |
| Nx                       | 22.6.0  | Monorepo tooling                                                    |
| TypeScript               | ~5.9.2  | Language                                                            |
| Vitest (browser mode)    | 4.1     | Unit tests in real branded browsers                                 |
| Playwright               | ^1.36.0 | E2E tests                                                           |
| `@types/dom-chromium-ai` | ^0.0.15 | TypeScript types for LanguageModel API — already in devDependencies |
| `marked`                 | ^17.0.5 | Markdown parser — already in dependencies                           |
| zone.js                  | 0.16.0  | Change detection (used until app moves to zoneless)                 |

---

## Recommended Stack for Code Generation Milestone

### 1. Inference Pipeline — W3C LanguageModel (Prompt) API

**Confidence: HIGH** — verified via official Chrome and Edge docs (March 2026).

| Feature                                       | Status                                        | Notes                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LanguageModel.create()`                      | Available — Chrome 138+, Edge Dev 138+        | Already used in `language-model.service.ts`                                                                                                                         |
| `session.prompt()`                            | Available                                     | Synchronous, waits for full response                                                                                                                                |
| `session.promptStreaming()`                   | Available                                     | Returns `ReadableStream` — stream delivers full accumulated text per chunk, not deltas                                                                              |
| `responseConstraint` (JSON Schema)            | Available since Chrome 137 / Edge Dev 138     | Pass a JSON Schema object; response is guaranteed valid JSON parseable with `JSON.parse()`                                                                          |
| `responseConstraint` (RegExp)                 | Available                                     | Response is a string matching the regex                                                                                                                             |
| `responseConstraint` with `promptStreaming()` | Available                                     | Works with both `prompt()` and `promptStreaming()`                                                                                                                  |
| Tool calling (`tools` option)                 | Spec only — not yet shipped in Chrome or Edge | W3C spec defines `tools` array with `name`, `description`, `inputSchema`, `execute()`. Do NOT use in v1                                                             |
| Web Workers                                   | NOT available                                 | "The Prompt API isn't available in Web Workers for now, due to the complexity of establishing a responsible document." No timeline given. Plan for main-thread only |
| `initialPrompts` (N-shot prompting)           | Available                                     | Pass system prompt + example user/assistant pairs to `LanguageModel.create()`                                                                                       |
| `session.clone()`                             | Available                                     | Clones session with same options but no conversation history — useful for pipeline passes                                                                           |
| `append()`                                    | Available                                     | Pre-populate context before prompting; conserves context window                                                                                                     |
| `session.measureContextUsage()`               | Available                                     | Accepts `responseConstraint` to measure schema's token cost                                                                                                         |
| `topK` / `temperature`                        | Deprecated in web page contexts               | Only functional in extension contexts. Do not rely on them                                                                                                          |

**Structural implication:** Web Worker offloading is off the table. All inference runs on the main thread. Use `promptStreaming()` to keep the UI responsive — Angular's signal-based rendering can update incrementally as chunks arrive via `AsyncIterable`.

**Structural implication:** Tool calling is not yet shipped. Use `responseConstraint` with JSON Schema as the structured output mechanism for multi-pass pipelines.

---

### 2. TypeScript Types for LanguageModel API

**Confidence: HIGH** — already in devDependencies.

`@types/dom-chromium-ai@0.0.15` is already installed. It covers the `LanguageModel` global, `LanguageModelSession`, `LanguageModelAvailability`, `LanguageModelCreateOptions`, and `responseConstraint`. No additional type packages needed.

**Use `@types/dom-chromium-ai` for all LanguageModel type annotations.** Do not write local ambient declarations.

---

### 3. Multi-Pass Inference Pipeline Pattern

**Confidence: MEDIUM** — based on research literature and Prompt API capabilities. No single authoritative source for on-device small-model pipelines specifically.

Small on-device models (Gemini Nano, Phi-4 Mini 3.8B) produce significantly better code when reasoning is broken into sequential passes rather than attempting single-shot HTML/CSS/JS generation. Research from multi-stage guided code generation (ScienceDirect 2024) and multi-turn LLM studies demonstrates this consistently.

**Recommended pipeline structure (research-driven, subject to empirical tuning):**

```
Pass 1 — Structured planning (responseConstraint: JSON Schema)
  Input:  user natural language description
  Output: { sections: [...], interactions: [...], styleGuide: {...} }
  Why:    Forces model to reason about structure before syntax.
          JSON Schema constraint eliminates prose/markdown parsing.

Pass 2 — HTML skeleton (responseConstraint: regex or unconstrained)
  Input:  Pass 1 JSON + system prompt with examples
  Output: Semantic HTML with placeholder classes
  Why:    Separates structure from styling; smaller context per pass.

Pass 3 — CSS + interactivity (unconstrained or responseConstraint)
  Input:  Pass 1 JSON + Pass 2 HTML
  Output: Complete single-file HTML with inline <style> and <script>
  Why:    Phi-4 Mini is strong at reasoning; multi-pass leverages this.
          Gemini Nano may collapse passes 2+3 into one given its speed.
```

**Implementation approach:** Use separate `LanguageModel` sessions per pass (via `session.clone()` or fresh `LanguageModel.create()` with `initialPrompts`). Each pass has its own system prompt engineered for that model.

**Model differences to account for in DI architecture:**

| Model                     | Expected strengths                | Recommended adjustments                                                   |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| Gemini Nano (Chrome Beta) | Fast inference, good general HTML | May need tighter `responseConstraint` schemas; fewer passes may be viable |
| Phi-4 Mini (Edge Dev)     | Strong reasoning, 128K context    | Better at complex structured planning; can handle longer prompts          |

The existing `LanguageModelService` should be extended into a DI token with per-model implementations that encapsulate prompt templates and pipeline structure. The service interface should expose a `generateCode(description: string): Observable<string>` streaming method.

---

### 4. Markdown/Code Extraction

**Confidence: HIGH** — `marked` is already in production dependencies at v17.0.5.

`marked@17.0.5` is already installed. Use it for two purposes:

1. **Extracting code blocks from model responses** when not using `responseConstraint`. The `Lexer` class (synchronous, low-level) tokenizes markdown and lets you filter for `code` tokens without full rendering. This is lighter than full parsing for extraction-only use.

2. **Rendering assistant messages** in the UI (system prompts, pipeline status messages).

```typescript
import { Lexer } from 'marked';

function extractCodeBlock(markdown: string, lang?: string): string | null {
  const tokens = Lexer.lex(markdown);

  for (const token of tokens) {
    if (token.type === 'code') {
      if (!lang || token.lang === lang) {
        return token.text;
      }
    }
  }

  return null;
}
```

**Prefer `responseConstraint`** wherever the pipeline requires structured output — this eliminates markdown parsing entirely for those passes and is more reliable with small models. Use `marked` as a fallback for passes that return prose + code blocks.

**Do not add** `marked-highlight` — syntax highlighting of generated code is not needed for the preview use case. The preview renders the code as live HTML, not as highlighted source.

---

### 5. Sandboxed Preview Rendering

**Confidence: HIGH** — based on MDN, OWASP, and multiple implementation guides (verified March 2026).

**Use a sandboxed `<iframe>` with `srcdoc`**, not Shadow DOM. Shadow DOM does not isolate JavaScript — it is a scoping mechanism for DOM and CSS, not a security boundary. Generated JavaScript in Shadow DOM has full access to the host page.

**Recommended iframe attributes:**

```html
<iframe sandbox="allow-scripts" srcdoc="{{ generatedHtml }}" title="Generated preview"></iframe>
```

**Critical rule:** Never combine `sandbox="allow-scripts allow-same-origin"`. With both flags, the iframe can remove its own sandbox restrictions — it becomes equivalent to no sandbox. Use `allow-scripts` alone; the iframe will run in an opaque (null) origin, fully isolated from the host page.

**Angular integration:** `srcdoc` binding requires `DomSanitizer.bypassSecurityTrustHtml()` to bypass Angular's template sanitization.

```typescript
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { inject } from '@angular/core';

// In a component:
readonly #sanitizer = inject(DomSanitizer);

// Signal-based derived state:
readonly safePreviewHtml = computed(() =>
  this.#sanitizer.bypassSecurityTrustHtml(this.generatedHtml())
);
```

Bind to `[srcdoc]` with the sanitized value. Angular's `DomSanitizer` blocks potentially dangerous HTML by default — `bypassSecurityTrustHtml` is required to pass the full generated document through.

**For large HTML (>100 KB):** Use Blob URLs as an alternative to `srcdoc` to avoid attribute size limits. Create a `Blob` with `type: 'text/html'`, call `URL.createObjectURL()`, and set `src`. Revoke the URL after the iframe loads to avoid memory leaks. Use `allow-scripts` sandbox on the Blob URL iframe as well.

**`postMessage` for preview communication:** Use `window.postMessage` to receive `console.log` output, error events, or resize notifications from the sandboxed iframe. This is the only safe channel — do not rely on shared state.

**Do not use Shadow DOM** for preview isolation. Shadow DOM is appropriate for component style encapsulation but provides zero JavaScript security isolation.

---

### 6. CSS Strategy for Generated Code

**Confidence: MEDIUM** — based on LLM code generation research and Tailwind v4 documentation.

**Recommended: Tailwind CSS v4 via Play CDN**, injected as a `<script>` tag in the generated HTML.

```html
<!doctype html>
<html>
  <head>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  </head>
  <body>
    <!-- Generated content here -->
  </body>
</html>
```

**Why Tailwind over vanilla CSS for AI-generated code:**

- LLMs generate Tailwind utility classes reliably because class names are semantically meaningful (`text-3xl`, `bg-blue-500`, `flex justify-center`) and map directly to the model's training on web tutorials and documentation.
- Vanilla CSS requires the model to reason about property names, values, and specificity in a second mental context — error rate increases.
- Tailwind v4 Play CDN (`@tailwindcss/browser@4.2.2`) scans the page HTML at runtime for classes and generates only the used CSS — no build step, no unused styles.
- The Play CDN is explicitly designed for playground/demo use cases, which matches the preview pane exactly.

**Limitation to communicate to the model:** The Play CDN does not support `@apply` or JS-based plugins. Prompt engineering should constrain the model to utility classes only, not custom CSS layers.

**Include in system prompt:** Tell the model to use Tailwind classes exclusively, avoid `<style>` blocks, and target the `@tailwindcss/browser@4` CDN. Provide a few `<script>` tag examples as N-shot prompts.

**Tailwind v4 note:** v4 was released in January 2025. Gemini Nano's training cutoff predates v4 — prompt engineering must include explicit v4 class examples to prevent v3 syntax errors. Phi-4 Mini's training also has a cutoff but 128K context makes in-context examples highly effective.

---

### 7. In-Browser Code Linting for Generated Code

**Confidence: MEDIUM** — based on ESLint team statements and `eslint-linter-browserify` npm package status. This feature is deferred in v1 per PROJECT.md, but researched for future phases.

**Use the ESLint `Linter` class via `eslint-linter-browserify`** if in-browser linting is added.

| Option                            | Status                     | Notes                                                                                      |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `ESLint` class                    | Not browser-compatible     | Depends on Node.js `fs` module                                                             |
| `Linter` class (direct import)    | Requires webpack polyfills | Not straightforward in Vite/Angular context                                                |
| `eslint-linter-browserify@10.1.0` | Browser-ready              | Pre-bundled `Linter` class, CDN-loadable from jsDelivr. No rules plugins, just core parser |
| Biome                             | Not browser-native         | WASM build exists but adds ~8 MB; overkill for this use case                               |
| `quick-lint-js`                   | Browser-native WASM        | Lightest option for syntax errors only; no rule-based linting                              |

**For v1 (deferred):** Skip in-browser linting. The multi-pass pipeline with `responseConstraint` JSON Schema output should prevent malformed code at the structural level. Save linting for a future "self-repair" pass.

**When linting is added:** Use `eslint-linter-browserify@10.1.0` for JavaScript rule-based linting, loaded lazily (dynamic import or CDN injection) to avoid bloating the main bundle.

---

### 8. Supporting Libraries

| Library                    | Version | Purpose                                        | Notes                                                                                           |
| -------------------------- | ------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@types/dom-chromium-ai`   | 0.0.15  | LanguageModel API types                        | Already in devDependencies                                                                      |
| `marked`                   | 17.0.5  | Code block extraction, markdown rendering      | Already in dependencies                                                                         |
| `@tailwindcss/browser`     | 4.2.2   | Tailwind Play CDN injected into generated HTML | Not installed in Angular app — injected as CDN script in the generated HTML string, not bundled |
| `eslint-linter-browserify` | 10.1.0  | In-browser JS linting (future pass)            | Do not install in v1; add when self-repair pass is implemented                                  |

---

## What NOT to Use

| Avoid                                                     | Why                                                                                                                                                                      | Use Instead                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Web Workers for LanguageModel                             | API explicitly not available in Workers. Spec says "not available in Web Workers for now." No timeline.                                                                  | Run inference on main thread; use `promptStreaming()` + Angular signals for responsive UI |
| Tool calling (`tools` option in `LanguageModel.create()`) | Specified in W3C draft but not yet shipped in Chrome or Edge as of March 2026.                                                                                           | Use `responseConstraint` with JSON Schema for structured output                           |
| Shadow DOM for preview isolation                          | Scopes styles but provides zero JavaScript security isolation. Generated scripts can access host page.                                                                   | `<iframe sandbox="allow-scripts">` with `srcdoc`                                          |
| `sandbox="allow-scripts allow-same-origin"`               | Allows the iframe to remove its own sandbox. Equivalent to no sandbox. Security critical.                                                                                | `sandbox="allow-scripts"` only                                                            |
| `ESLint` class (not `Linter`)                             | Depends on Node.js `fs`; not browser-compatible without heavy polyfilling.                                                                                               | `eslint-linter-browserify` which exports only the `Linter` class                          |
| Single-pass code generation                               | Small models (Gemini Nano, Phi-4 Mini) produce better output with structured multi-pass approaches. Single-pass produces inconsistent formatting, missing interactivity. | Multi-pass pipeline with planning → skeleton → assembly                                   |
| Vanilla CSS as primary styling for generated code         | Models generate Tailwind utility classes more reliably due to semantic naming in training data. Vanilla CSS increases hallucination rate for property values.            | Tailwind CSS v4 Play CDN in generated HTML                                                |
| `topK` / `temperature` on `LanguageModel.create()`        | Deprecated in web page contexts as of Chrome/Edge 138+. Only functional in extension contexts.                                                                           | Omit sampling parameters; models use browser-controlled defaults                          |
| `marked-highlight`                                        | Not needed — preview renders code as live HTML, not as syntax-highlighted source. Adds bundle weight.                                                                    | Use `marked` alone for code extraction; preview iframe handles rendering                  |
| Data URIs (`data:text/html,...`) for iframe src           | Encoding overhead for large HTML; inconsistent behavior across browsers for large payloads.                                                                              | `srcdoc` for small/medium HTML; Blob URL for large HTML                                   |

---

## Alternatives Considered

| Recommended                            | Alternative                                 | When to Use Alternative                                                                                                                       |
| -------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `iframe srcdoc` + sandbox              | Blob URL `iframe src`                       | Use Blob URL when generated HTML exceeds ~50 KB; `srcdoc` attribute size limits vary by browser                                               |
| Tailwind v4 Play CDN in generated HTML | Vanilla CSS only                            | If model capability research reveals Tailwind classes increase hallucination rate for specific prompt types; measure empirically              |
| Multi-pass pipeline (3 passes)         | Single-pass with large system prompt        | Once model quality is measured, Gemini Nano may perform adequately in 2 passes; keep pipeline configurable per model                          |
| `responseConstraint` JSON Schema       | Markdown code block extraction via `marked` | Use `marked` extraction when the model must produce prose + code in the same response; prefer `responseConstraint` for pure structured passes |
| DI-based per-model service             | Single unified service                      | Per-model DI is necessary because Gemini Nano and Phi-4 Mini require different prompt templates and pipeline tuning                           |

---

## Stack Patterns by Model

**If generating with Gemini Nano (Chrome Beta):**

- Expect faster inference but weaker HTML/CSS quality than Phi-4 Mini.
- Use Chrome as the fast iteration loop — its ~38s CI warm-up makes rapid pipeline tuning viable.
- System prompts should be shorter and more prescriptive (Gemini Nano has smaller context).
- May achieve acceptable quality in 2 passes (planning + full HTML/CSS/JS); measure before assuming 3 passes are needed.
- `responseConstraint` is available since Chrome 137 — use it for the planning pass.

**If generating with Phi-4 Mini (Edge Dev):**

- Expect stronger reasoning, particularly for the planning pass, due to 3.8B parameters and 128K context window.
- Training data is Python-heavy; HTML/CSS quality is unverified — include explicit HTML/CSS/JS examples in N-shot `initialPrompts`.
- 128K context allows richer N-shot examples without token pressure.
- `responseConstraint` is available and Edge contributed the feature — full parity with Chrome.
- CI runs on `windows-11-arm` with 23-110 min cold-start; use Chrome/Gemini Nano for pipeline development iteration, validate on Edge/Phi-4 Mini before release.

---

## Version Compatibility

| Package                           | Compatible With                                           | Notes                                                                                              |
| --------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `marked@17.0.5`                   | Angular 21.2, TypeScript 5.9                              | ESM-first; import `{ Lexer }` for token extraction                                                 |
| `@types/dom-chromium-ai@0.0.15`   | TypeScript 5.9                                            | Covers `LanguageModel`, `responseConstraint`, streaming                                            |
| `@tailwindcss/browser@4.2.2`      | Modern browsers (Chrome 111+, Safari 16.4+, Firefox 128+) | Injected into generated HTML, not bundled with Angular app — no Vite/Angular compatibility concern |
| `eslint-linter-browserify@10.1.0` | Browser (CDN); Vite via dynamic import                    | Load lazily; do not include in main Angular bundle                                                 |

---

## No New Production Dependencies for v1

The core code generation milestone requires **zero new npm dependencies**:

- `@types/dom-chromium-ai` is already in devDependencies.
- `marked` is already in dependencies.
- `@tailwindcss/browser` is injected as a CDN URL string into the generated HTML — it is not an npm dependency of the Angular app.

```bash
# Nothing to install for v1

# If in-browser linting is added in a future pass:
npm install -D eslint-linter-browserify
```

---

## Sources

- [Chrome Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api) — Web Worker exclusion, streaming, `responseConstraint`, `append()`, `clone()`; verified March 2026
- [Chrome structured output docs](https://developer.chrome.com/docs/ai/structured-output-for-prompt-api) — `responseConstraint` JSON Schema support since Chrome 137, schema keyword support; verified March 2026
- [Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) — Phi-4 Mini, `responseConstraint` with JSON Schema and RegExp, `initialPrompts`, `clone()`; last updated 2026-02-04
- [W3C Prompt API Draft (19 March 2026)](https://webmachinelearning.github.io/prompt-api/) — tool calling spec, `responseConstraint` IDL, Web Worker exposure = `[Exposed=Window]` only
- [npm: @types/dom-chromium-ai](https://www.npmjs.com/package/@types/dom-chromium-ai) — version 0.0.15 confirmed March 2026
- [npm: marked](https://www.npmjs.com/package/marked) — version 17.0.5 confirmed March 2026
- [Tailwind CSS Play CDN docs](https://tailwindcss.com/docs/installation/play-cdn) — `@tailwindcss/browser@4` CDN setup, limitations (no `@apply`, no JS plugins); verified March 2026
- [npm: @tailwindcss/browser](https://www.npmjs.com/package/@tailwindcss/browser) — version 4.2.2 confirmed March 2026
- [npm: eslint-linter-browserify](https://www.npmjs.com/package/eslint-linter-browserify) — version 10.1.0 confirmed March 2026
- [ESLint browser discussion #15733](https://github.com/eslint/eslint/discussions/15733) — official ESLint team position on browser builds (LOW confidence for future roadmap)
- [Phi-4-Mini Technical Report (arXiv 2503.01743)](https://arxiv.org/abs/2503.01743) — 3.8B params, Python-heavy training, 128K context, strong code benchmarks; HTML/CSS not specifically benchmarked (MEDIUM confidence for web generation quality)
- [Multi-stage guided code generation (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S095219762401649X) — planning → pseudo-code → implementation pipeline; verified for general code generation (MEDIUM confidence for on-device small models specifically)
- [iframe srcdoc code preview guide](https://mionskowski.pl/posts/iframe-code-preview/) — `srcdoc` + `sandbox` pattern for playground preview; HIGH confidence for security model
- [Flowbite LLM + Tailwind docs](https://flowbite.com/docs/getting-started/llm/) — Tailwind utility class reliability for AI generation; MEDIUM confidence

---

_Stack research for: In-browser AI coding agent — code generation milestone_
_Researched: 2026-03-23_
