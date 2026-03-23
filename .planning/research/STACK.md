# Stack Research

**Domain:** In-browser AI coding agent -- multi-pass code generation pipeline, sandboxed preview, split-pane UI
**Researched:** 2026-03-23
**Confidence:** HIGH (core APIs verified against official docs; UI approach validated against existing codebase patterns)

## Guiding Principle: No New Dependencies Unless Justified

This is a fully client-side Angular 21 app. The existing stack is deliberately minimal. Every proposed addition must clear the bar: "Does this save more complexity than it introduces?" Every feature in this milestone is achievable with browser platform APIs and Angular primitives already in the project.

---

## Context: What Is Already In Place (Do Not Replace)

| Technology               | Version | Role                                                    |
| ------------------------ | ------- | ------------------------------------------------------- |
| Angular                  | ~21.2.0 | App framework -- standalone components, signals, OnPush |
| Nx                       | 22.6.0  | Monorepo tooling                                        |
| TypeScript               | ~5.9.2  | Language                                                |
| RxJS                     | ~7.8.0  | Async composition                                       |
| `@types/dom-chromium-ai` | ^0.0.15 | TypeScript types for LanguageModel API                  |
| `marked`                 | ^17.0.5 | Markdown parser (already in production dependencies)    |
| Vitest (browser mode)    | 4.1     | Unit tests in real branded browsers                     |
| Playwright               | ^1.36.0 | E2E tests                                               |
| zone.js                  | 0.16.0  | Change detection (until app moves to zoneless)          |

---

## Recommended Stack for v1.0 Milestone

### New npm Dependencies Required: Zero

Every v1.0 feature maps to existing dependencies or zero-dependency browser platform APIs:

| Feature                                | Implementation                                                                 | Dependencies Needed                              |
| -------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| Multi-pass pipeline                    | LanguageModel API (`prompt`, `promptStreaming`, `clone`, `responseConstraint`) | None (typed by `@types/dom-chromium-ai@^0.0.15`) |
| Model DI abstraction                   | Angular DI abstract class token + factory provider                             | None (Angular core)                              |
| Anchor session (keep model loaded)     | `LanguageModel.create()` + `session.clone()` pattern                           | None                                             |
| Structured JSON planning pass          | `responseConstraint` with JSON Schema                                          | None                                             |
| Streaming token display                | `session.promptStreaming()` + Angular signals                                  | None                                             |
| Sandboxed iframe preview               | `Blob` + `URL.createObjectURL` + `<iframe sandbox="allow-scripts">`            | None (browser platform APIs)                     |
| Split-pane UI layout                   | CSS Grid + `pointerdown`/`pointermove`/`pointerup` events                      | None (~60 lines custom component)                |
| Viewport toggle (mobile/desktop)       | CSS `width` binding on iframe container                                        | None                                             |
| Copy to clipboard                      | `navigator.clipboard.writeText()`                                              | None (Clipboard API)                             |
| Download as .html                      | `Blob` + anchor `download` attribute + `click()`                               | None                                             |
| HTML validation (programmatic pass)    | `DOMParser.parseFromString()`                                                  | None (browser built-in)                          |
| Truncation detection                   | String checks (regex for `</html>`, tag counting)                              | None                                             |
| Error messages for non-technical users | TypeScript error mapping function                                              | None                                             |
| Prompt templates                       | Static TypeScript data array                                                   | None                                             |
| Markdown extraction fallback           | `marked` Lexer for code block extraction                                       | None (already installed)                         |

---

## Feature-by-Feature Stack Details

### 1. Inference Pipeline -- W3C LanguageModel (Prompt) API

**Confidence: HIGH** -- verified via official Chrome and Edge docs (March 2026).

| API Surface                                 | Browser Support        | Purpose                                           | Notes                                                                            |
| ------------------------------------------- | ---------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `LanguageModel.create()`                    | Chrome 138+, Edge 138+ | Create inference session                          | Already used in `language-model.service.ts`                                      |
| `session.prompt()`                          | Chrome 138+, Edge 138+ | Single-shot inference (planning pass)             | Waits for full response                                                          |
| `session.promptStreaming()`                 | Chrome 138+, Edge 138+ | Streaming inference (code gen pass)               | Returns `ReadableStream`; yields **full accumulated text** per chunk, not deltas |
| `session.clone()`                           | Chrome 138+, Edge 138+ | Fork session preserving system prompt, no history | Use for per-pass sessions cloned from anchor                                     |
| `responseConstraint` (JSON Schema)          | Chrome 137+, Edge 138+ | Constrain output to JSON Schema                   | For planning pass structured output                                              |
| `responseConstraint` (RegExp)               | Chrome 137+, Edge 138+ | Constrain output to regex pattern                 | For passes requiring specific format                                             |
| `responseConstraint` + `promptStreaming()`  | Chrome 137+, Edge 138+ | Streaming with structured output                  | Works on both methods                                                            |
| `session.inputQuota` / `session.inputUsage` | Chrome 138+, Edge 138+ | Track token budget remaining                      | Monitor before each pass                                                         |
| `countPromptTokens()`                       | Chrome 138+, Edge 138+ | Pre-check token count without prompting           | Guard against exceeding budget                                                   |
| `initialPrompts`                            | Chrome 138+, Edge 138+ | System prompt + N-shot examples                   | Pass to `LanguageModel.create()`                                                 |
| `AbortController` / `signal`                | All modern browsers    | Cancel in-flight inference                        | Standard Web API, works with both `prompt()` and `promptStreaming()`             |

**Not available (do not use):**

| API Surface                   | Status                                                | Alternative                                                 |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| Web Workers                   | "Not available in Web Workers for now" -- no timeline | Run on main thread; `promptStreaming()` keeps UI responsive |
| Tool calling (`tools` option) | In W3C spec draft, not shipped in Chrome or Edge      | Use `responseConstraint` with JSON Schema                   |
| `topK` / `temperature`        | Deprecated in web page contexts                       | Omit; use browser defaults                                  |

**Sources:**

- [Chrome Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api)
- [Chrome session management best practices](https://developer.chrome.com/docs/ai/session-management)
- [Chrome structured output](https://developer.chrome.com/docs/ai/structured-output-for-prompt-api)
- [Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api)
- [W3C Prompt API spec](https://github.com/webmachinelearning/prompt-api)

### 2. Anchor Session Pattern (Model Keep-Alive)

**Confidence: HIGH** -- documented in [Chrome session management best practices](https://developer.chrome.com/docs/ai/session-management).

Per Chrome's official guidance: "Keep one empty session alive at a time, as it uses limited memory and keeps the model ready to use." The W3C spec states: "Destroying the session allows the user agent to unload the language model from memory, if no other APIs or sessions are using it."

**Pattern for pipeline:**

```
App startup:
  anchorSession = await LanguageModel.create({ initialPrompts: [...] })

Per generation request:
  planSession = await anchorSession.clone()    // inherits system prompt
  plan = await planSession.prompt(userInput, { responseConstraint: schema })
  planSession.destroy()

  codeSession = await anchorSession.clone()
  stream = codeSession.promptStreaming(planPrompt)
  for await (const chunk of stream) { ... }
  codeSession.destroy()

  // anchorSession stays alive -- model remains loaded

App teardown:
  anchorSession.destroy()   // allows model unload
```

**Key detail:** `clone()` copies system prompt and options but NOT conversation history. Each pipeline pass starts fresh. The anchor session's only purpose is to keep the model resident in memory.

### 3. Token Budget Reality

**Confidence: MEDIUM-HIGH** -- Gemini Nano 6,144 verified via [Chromium discussion](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/WO2NIK_9Ue4); Phi-4 Mini estimate from REQUIREMENTS.md.

| Model       | Context Window | System Prompt | User Input  | Available Output    |
| ----------- | -------------- | ------------- | ----------- | ------------------- |
| Gemini Nano | 6,144 tokens   | ~500 tokens   | ~500 tokens | ~3,000-4,000 tokens |
| Phi-4 Mini  | ~9,000 tokens  | ~800 tokens   | ~500 tokens | ~5,000-6,000 tokens |

Planning pass JSON output consumes ~200-500 tokens. Code gen pass must fit output within remaining budget after system prompt + plan injection. This is the primary architectural constraint driving single-file HTML output.

### 4. Structured JSON Output (Planning Pass)

**Confidence: HIGH** -- `responseConstraint` verified for both Chrome and Edge.

Both Chrome (since v137) and Edge (since v138) support `responseConstraint` with JSON Schema. The browser's inference engine enforces the schema -- output is guaranteed to be valid JSON parseable with `JSON.parse()`.

```typescript
const planSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    sections: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          elements: { type: 'array', items: { type: 'string' } },
          interactions: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'elements'],
      },
    },
  },
  required: ['title', 'sections'],
};

const plan = await session.prompt(userPrompt, { responseConstraint: planSchema });
const parsed = JSON.parse(plan); // guaranteed valid by inference engine
```

**Do NOT add JSON repair libraries** (`jsonrepair`, etc.). The constraint is enforced at the inference engine level. If it fails, the model itself could not produce valid JSON -- no amount of post-hoc repair will help. Catch the error and surface it to the user.

### 5. Streaming Token Display

**Confidence: HIGH** -- verified in Chrome and Edge docs.

`promptStreaming()` returns a `ReadableStream` that yields the full accumulated response string (not deltas). This is different from most LLM APIs.

```typescript
const stream = session.promptStreaming(prompt);
for await (const chunk of stream) {
  // chunk is the FULL response so far, not a delta
  this.generatedCode.set(chunk);
}
```

Wire to an Angular signal. The code pane template binds to the signal. On each chunk, the signal updates and Angular re-renders the code pane. No additional streaming/observable library needed.

### 6. Sandboxed iframe Preview

**Confidence: HIGH** -- based on [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe/sandbox) and security best practices.

**Use blob URLs (not `srcdoc`)** per requirement PREV-01. Blob URLs provide stronger origin isolation and avoid HTML entity encoding issues.

```typescript
private updatePreview(html: string): void {
  if (this.currentBlobUrl) {
    URL.revokeObjectURL(this.currentBlobUrl);
  }
  const blob = new Blob([html], { type: 'text/html' });
  this.currentBlobUrl = URL.createObjectURL(blob);
  this.previewUrl.set(this.currentBlobUrl);
}
```

**Critical security rules:**

- Use `sandbox="allow-scripts"` WITHOUT `allow-same-origin`
- Never combine both flags -- the iframe could remove its own sandbox restrictions
- The iframe runs in an opaque (null) origin, fully isolated from the host page
- No access to parent DOM, cookies, or localStorage

**Why blob URLs over `srcdoc`:**

- PREV-01 explicitly requires blob URLs
- Blob URLs avoid attribute size limits for large HTML
- Blob URLs create a distinct origin (extra isolation)
- No HTML entity encoding needed (raw HTML goes into the Blob)

**Why iframe over Shadow DOM:**

- Shadow DOM is a scoping mechanism for DOM/CSS, not a security boundary
- Generated JavaScript in Shadow DOM has full access to the host page
- Iframes are the standard for code playground sandboxing (CodePen, JSFiddle, StackBlitz)

### 7. Split-Pane UI Layout

**Confidence: HIGH** -- standard CSS Grid pattern; Angular DevTools itself uses a [custom split pane](https://github.com/angular/angular/commit/78b3d39810c5f84a3759360e93bc1564486601db).

**Use a custom CSS Grid component (~60 lines), not `angular-split`.**

**Why not `angular-split@20.0.0`:**

- Has peer dependency `>=19.0.0` -- technically works with Angular 21 but no v21-aligned release exists (last release: July 2025)
- Adds ~15 KB for something achievable in 60 lines
- The project values minimal runtime dependencies (only `marked` beyond Angular/RxJS)
- Angular DevTools uses a custom split pane -- this is the idiomatic approach

**Implementation approach:**

```typescript
@Component({
  selector: 'app-split-pane',
  template: `
    <div class="split-container" [style.grid-template-columns]="gridTemplate()">
      <ng-content select="[leftPane]" />
      <div class="gutter" (pointerdown)="onPointerDown($event)" />
      <ng-content select="[centerPane]" />
      @if (showCenter()) {
        <div class="gutter" (pointerdown)="onPointerDown($event)" />
      }
      <ng-content select="[rightPane]" />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
```

**Key implementation details:**

- Use `pointerdown`/`pointermove`/`pointerup` (not mouse events) for touch support
- Run `pointermove` outside `NgZone` to avoid change detection on every pixel
- Set `user-select: none` on body during drag to prevent text selection
- Support hiding center pane (code) via signal toggle (UI-02)
- Minimum pane width ~150px to prevent collapse

### 8. Copy to Clipboard

**Confidence: HIGH** -- [Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API) is Baseline Available since March 2025.

```typescript
async copyToClipboard(html: string): Promise<void> {
  await navigator.clipboard.writeText(html);
}
```

Requires secure context (HTTPS or localhost -- satisfied by `ng serve`) and transient user activation (button click). No fallback needed -- Chrome Beta 138+ and Edge Dev 138+ fully support it.

### 9. Download as .html File

**Confidence: HIGH** -- standard Blob + anchor download pattern.

```typescript
downloadHtml(html: string, filename = 'generated.html'): void {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

### 10. HTML Validation (Programmatic Pass)

**Confidence: HIGH** -- [DOMParser](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString) is available in all browsers since 2015.

Per PIPE-04: deterministic validation is offloaded to JavaScript, not the model.

```typescript
function validateHtml(html: string): { valid: boolean; errors: string[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const errors: string[] = [];

  // DOMParser with text/html is lenient (auto-closes tags) -- desirable
  // We detect gross malformation, not strict W3C validity
  if (!doc.body || doc.body.children.length === 0) {
    errors.push('Generated HTML has no visible content');
  }

  return { valid: errors.length === 0, errors };
}
```

**Note:** `DOMParser` with `text/html` auto-closes tags and fixes structure. This is actually desirable -- we want to detect gross malformation (truncated output, empty body) while tolerating minor issues browsers handle gracefully.

### 11. Truncation Detection

**Confidence: HIGH** -- simple string checks, no library.

```typescript
function isTruncated(html: string): boolean {
  const trimmed = html.trim();
  const hasClosingHtml = /<\/html>\s*$/i.test(trimmed);
  const openScripts = (trimmed.match(/<script/gi) ?? []).length;
  const closeScripts = (trimmed.match(/<\/script>/gi) ?? []).length;
  return !hasClosingHtml || openScripts !== closeScripts;
}
```

### 12. Error Messages for Non-Technical Users

**Confidence: HIGH** -- maps known DOMException names to plain English.

```typescript
function userFriendlyError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'QuotaExceededError':
        return 'The response was too long for the AI model. Try a simpler request.';
      case 'NotSupportedError':
        return 'Your browser does not support this AI feature. Try Chrome Beta or Edge Dev.';
      case 'InvalidStateError':
        return 'The AI model is not ready yet. Please wait for it to finish loading.';
      case 'AbortError':
        return 'Generation was cancelled.';
      default:
        return 'Something went wrong with the AI model. Please try again.';
    }
  }
  return 'An unexpected error occurred. Please try again.';
}
```

### 13. Angular DI Pattern for Model Abstraction

**Confidence: HIGH** -- standard Angular DI with abstract class token.

```typescript
// Abstract token -- all pipeline code injects this
export abstract class ModelService {
  abstract createSession(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
  abstract readonly contextWindowSize: number;
  abstract readonly systemPrompts: {
    planning: string;
    codeGeneration: string;
  };
}

// Chrome Beta implementation
@Injectable()
export class GeminiNanoModelService extends ModelService {
  readonly contextWindowSize = 6144;
  readonly systemPrompts = {
    planning: '...Gemini Nano-optimized planning prompt...',
    codeGeneration: '...Gemini Nano-optimized code gen prompt...',
  };
  // ...
}

// Edge Dev implementation
@Injectable()
export class Phi4MiniModelService extends ModelService {
  readonly contextWindowSize = 9000;
  readonly systemPrompts = {
    planning: '...Phi-4 Mini-optimized planning prompt...',
    codeGeneration: '...Phi-4 Mini-optimized code gen prompt...',
  };
  // ...
}

// Factory provider in app.config.ts
{
  provide: ModelService,
  useFactory: () => {
    // Detect browser at startup via user agent or feature detection
    // Return appropriate implementation
  }
}
```

### 14. CSS Strategy for Generated Code

**Confidence: MEDIUM** -- based on LLM code generation patterns and Tailwind v4 CDN docs.

**Recommended: Tailwind CSS v4 Play CDN**, injected as a `<script>` tag in the generated HTML string. This is NOT an npm dependency of the Angular app.

```html
<!-- Injected into the generated HTML string by the code gen system prompt -->
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
```

**Why Tailwind over vanilla CSS for AI-generated code:**

- LLMs generate Tailwind utility classes reliably because class names are semantically meaningful (`text-3xl`, `bg-blue-500`, `flex justify-center`)
- Vanilla CSS requires the model to reason about property names, values, and specificity separately -- increases error rate
- Tailwind v4 Play CDN scans the HTML at runtime and generates only used CSS -- no build step
- The Play CDN is designed for playground/demo use cases -- matches the preview pane exactly

**Limitation:** The Play CDN does not support `@apply` or JS-based plugins. System prompts should constrain the model to utility classes only.

**Offline consideration:** The Play CDN requires internet access. If the preview must work offline, fall back to vanilla CSS in the system prompt. Make this configurable per model service.

---

## What NOT to Use

| Avoid                                       | Why                                                                                                 | Use Instead                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `angular-split`                             | 15 KB for a 60-line CSS Grid component; no Angular 21 release; adds peer dep risk                   | Custom CSS Grid split pane with pointer events |
| Prism.js / highlight.js                     | Syntax highlighting explicitly deferred to v2; adds 2-300 KB                                        | Plain `<pre><code>` with monospace font        |
| Monaco Editor / CodeMirror                  | Listed in v3+ requirements; 2+ MB bundle; target audience is non-technical                          | Plain `<pre><code>` or readonly textarea       |
| DOMPurify / sanitize-html                   | Generated code runs in sandboxed iframe (opaque origin, no `allow-same-origin`) -- already isolated | `<iframe sandbox="allow-scripts">`             |
| web-llm / transformers.js                   | Alternative inference runtimes; project uses browser built-in LanguageModel API                     | W3C LanguageModel API                          |
| JSON repair libraries                       | `responseConstraint` enforces schema at inference engine level; post-hoc repair is futile           | Catch errors, surface to user                  |
| WebContainers                               | Commercial license, COOP/COEP headers, target output is static HTML                                 | iframe sandbox                                 |
| Shadow DOM for preview                      | Scopes styles but zero JS security isolation; scripts access host page                              | iframe sandbox                                 |
| `sandbox="allow-scripts allow-same-origin"` | Iframe can remove its own sandbox. SECURITY CRITICAL.                                               | `sandbox="allow-scripts"` only                 |
| Web Workers for inference                   | LanguageModel API not available in Workers; no timeline                                             | Main thread + `promptStreaming()`              |
| `topK` / `temperature`                      | Deprecated in web page contexts (Chrome/Edge 138+)                                                  | Omit; use browser defaults                     |
| `srcdoc` attribute                          | PREV-01 requires blob URLs; `srcdoc` has attribute size limits and weaker origin isolation          | Blob URL via `URL.createObjectURL()`           |

---

## Alternatives Considered

| Recommended                         | Alternative                          | When to Use Alternative                                                                          |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Custom CSS Grid split pane          | `angular-split@20.0.0`               | If split pane grows beyond 3 panes, needs persistence, or needs nested splits -- unlikely for v1 |
| `<pre><code>` for code display      | Prism.js (~2 KB gzipped core)        | When syntax highlighting is added in v2                                                          |
| Blob URL + iframe sandbox           | `srcdoc` attribute                   | Only if blob URL causes issues (none expected); `srcdoc` is simpler but weaker isolation         |
| `DOMParser` for validation          | `html-validate` npm package          | If W3C spec-level validation with error codes is needed -- overkill for v1                       |
| `navigator.clipboard.writeText`     | `document.execCommand('copy')`       | Only for browsers below Chrome 66 -- not our case                                                |
| Tailwind Play CDN in generated HTML | Vanilla CSS only                     | If Tailwind classes increase hallucination rate (measure empirically); or for offline mode       |
| Multi-pass pipeline (2-3 passes)    | Single-pass with large system prompt | Measure per model; Gemini Nano may work in 2 passes given its speed                              |

---

## Stack Patterns by Phase

**Phase 1 (Model Abstraction Layer):**

- Angular DI: abstract class token + factory provider
- `LanguageModel.create()`, `session.clone()`, `session.destroy()`
- Anchor session pattern for model keep-alive
- Per-model system prompts and token budget constants
- Zero new dependencies

**Phase 2 (Generation Pipeline + Sandboxed Preview):**

- `session.prompt()` with `responseConstraint` (planning pass)
- `session.promptStreaming()` (code gen pass)
- `DOMParser` for HTML validation (programmatic pass)
- Truncation detection (string checks)
- `Blob` + `URL.createObjectURL()` for iframe preview
- `<iframe sandbox="allow-scripts">` for security
- Zero new dependencies

**Phase 3 (Split-Pane UI + Prompt Engineering):**

- Custom CSS Grid split-pane component (~60 lines)
- Pointer events for drag-to-resize
- `navigator.clipboard.writeText()` for copy
- `Blob` + anchor `download` for .html export
- Angular signals for streaming code display
- Static TypeScript prompt template data
- Zero new dependencies

**Phase 4 (Quality Hardening):**

- `DOMParser` for structural assertions in tests
- Synthetic prompt corpus as TypeScript data files
- Token budget monitoring via `inputQuota`/`inputUsage`
- Zero new dependencies

---

## Stack Patterns by Model

**Gemini Nano (Chrome Beta):**

- Context window: 6,144 tokens -- shorter system prompts, tighter schemas
- Fast inference (~38s CI warm-up) -- use as the rapid iteration loop
- May achieve acceptable quality in 2 passes (planning + code gen)
- `responseConstraint` available since Chrome 137

**Phi-4 Mini (Edge Dev):**

- Context window: ~9,000 tokens -- richer N-shot examples viable
- Stronger reasoning (3.8B params) -- better at complex planning passes
- Training is Python-heavy; include explicit HTML/CSS/JS examples in `initialPrompts`
- 23-110 min cold-start on CI -- validate on Edge after iterating with Chrome

---

## Version Compatibility

| Package                          | Compatible With                    | Notes                                                                                                                           |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@types/dom-chromium-ai@^0.0.15` | TypeScript ~5.9.2                  | Already installed; covers `promptStreaming`, `clone()`, `responseConstraint`, `inputQuota`, `inputUsage`, `countPromptTokens()` |
| Angular ~21.2.0                  | Nx 22.6.0                          | Existing compatibility confirmed                                                                                                |
| `marked@^17.0.5`                 | Angular ~21.2.0, TypeScript ~5.9.2 | ESM-first; use `Lexer` class for code block extraction                                                                          |
| `@tailwindcss/browser@4`         | Chrome 111+, Edge 111+             | Not an npm dep -- CDN URL injected into generated HTML string                                                                   |

---

## Installation

```bash
# No new packages to install for v1.0.
# All features use existing dependencies + browser platform APIs.
```

When syntax highlighting is added in v2:

```bash
npm install prismjs
npm install -D @types/prismjs
```

---

## Sources

- [Chrome Prompt API docs](https://developer.chrome.com/docs/ai/prompt-api) -- HIGH confidence; streaming, `responseConstraint`, `clone()`, Web Worker exclusion
- [Chrome session management best practices](https://developer.chrome.com/docs/ai/session-management) -- HIGH confidence; anchor session pattern, keep-alive, destroy lifecycle
- [Chrome structured output for Prompt API](https://developer.chrome.com/docs/ai/structured-output-for-prompt-api) -- HIGH confidence; `responseConstraint` JSON Schema since Chrome 137
- [Edge Prompt API docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) -- HIGH confidence; Phi-4 Mini, `responseConstraint`, `initialPrompts`, `clone()`
- [W3C Prompt API spec (GitHub)](https://github.com/webmachinelearning/prompt-api) -- HIGH confidence; `[Exposed=Window]` only (no Workers), session lifecycle
- [Domenic Denicola on Built-in AI API design](https://domenic.me/builtin-ai-api-design/) -- HIGH confidence; session-based design rationale, model unload semantics
- [Gemini Nano token limits discussion](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/WO2NIK_9Ue4) -- MEDIUM confidence; 6,144 token context window, corroborated by API properties
- [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe/sandbox) -- HIGH confidence; sandbox attribute semantics
- [MDN Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API) -- HIGH confidence; Baseline Available March 2025
- [MDN DOMParser](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString) -- HIGH confidence; HTML parsing, error detection
- [angular-split npm](https://www.npmjs.com/package/angular-split) -- HIGH confidence; v20.0.0, peer dep `>=19.0.0`, no v21 release
- [Angular DevTools split pane commit](https://github.com/angular/angular/commit/78b3d39810c5f84a3759360e93bc1564486601db) -- HIGH confidence; Angular team uses custom split pane
- [@types/dom-chromium-ai npm](https://www.npmjs.com/package/@types/dom-chromium-ai) -- HIGH confidence; v0.0.15 latest, covers full Prompt API surface
- [Tailwind CSS Play CDN](https://tailwindcss.com/docs/installation/play-cdn) -- MEDIUM confidence; `@tailwindcss/browser@4`, no `@apply`, no plugins

---

_Stack research for: In-browser AI coding agent v1.0 milestone_
_Researched: 2026-03-23_
