# Architecture Research

**Domain:** In-browser AI coding agent -- multi-pass code generation pipeline, sandboxed preview, split-pane UI
**Researched:** 2026-03-23
**Confidence:** HIGH (API surface verified against `@types/dom-chromium-ai@0.0.15`, official Chrome/Edge docs, existing codebase)

---

## Standard Architecture

### System Overview

```
+------------------------------------------------------------------------------------+
|                            Angular 21 Application                                  |
+-------------------------------------+----------------------------------------------+
|           UI Layer                   |           Service Layer                      |
|                                      |                                             |
|  +-------------------------------+   |  +--------------------------------------+   |
|  |    CodingAgentComponent       |   |  |  CodeGenerationPipelineService      |   |
|  |    (split-pane layout)        |   |  |  (orchestrates multi-pass pipeline) |   |
|  |                               |   |  +------------------+-----------------+   |
|  |  +-------------------------+  |   |                     |                     |
|  |  | PromptInputPane        |  |   |  +------------------v-----------------+   |
|  |  | (left pane)            |  |<->|  |  ModelService (abstract DI token)  |   |
|  |  +-------------------------+  |   |  |  +-------------------------------+ |   |
|  |                               |   |  |  | GeminiNanoModelService       | |   |
|  |  +-------------------------+  |   |  |  | (Chrome Beta)               | |   |
|  |  | CodeViewPane           |  |   |  |  +-------------------------------+ |   |
|  |  | (center, toggle-able)  |  |   |  |  | Phi4MiniModelService         | |   |
|  |  +-------------------------+  |   |  |  | (Edge Dev)                  | |   |
|  |                               |   |  |  +-------------------------------+ |   |
|  |  +-------------------------+  |   |  +------------------------------------+   |
|  |  | PreviewPane            |  |   |                                           |
|  |  | (right pane)           |  |   |  +--------------------------------------+   |
|  |  |  +------------------+  |  |   |  |  CodeExtractorService              |   |
|  |  |  |  <iframe>        |  |  |   |  |  (parse markdown, validate HTML)   |   |
|  |  |  |  sandbox         |  |  |   |  +--------------------------------------+   |
|  |  |  |  blob: URL       |  |  |   |                                           |
|  |  |  +------------------+  |  |   |  +--------------------------------------+   |
|  |  +-------------------------+  |   |  |  LanguageModelService (existing)    |   |
|  +-------------------------------+   |  |  (availability + download)          |   |
|                                      |  +--------------------------------------+   |
|  +-------------------------------+   |                                             |
|  | PipelineProgressComponent     |   |                                             |
|  | (step indicator)              |   |                                             |
|  +-------------------------------+   |                                             |
|                                      |                                             |
|  +-------------------------------+   |                                             |
|  | ModelStatusComponent          |   |                                             |
|  | (existing, unchanged)         |   |                                             |
|  +-------------------------------+   |                                             |
+--------------------------------------+---------------------------------------------+
```

### Component Responsibilities

| Component                       | Responsibility                                                                                   | Status   |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | -------- |
| `CodingAgentComponent`          | 3-pane split layout, wires prompt input to pipeline, renders progress, error display             | New      |
| `PromptInputPaneComponent`      | Textarea, submit button, prompt template selector, disables during generation                    | New      |
| `CodeViewPaneComponent`         | Read-only display of streaming tokens during generation, final code after completion             | New      |
| `PreviewPaneComponent`          | Hosts sandboxed `<iframe>` loaded via blob URL, viewport toggle (mobile/desktop), error boundary | New      |
| `PipelineProgressComponent`     | Step indicators (Outlining / Generating / Rendering), visual feedback for current phase          | New      |
| `CodeGenerationPipelineService` | Orchestrates 2-pass inference, manages session lifecycle, emits state signals, abort support     | New      |
| `ModelService` (abstract class) | DI token for model abstraction; defines contract for session creation, prompting, streaming      | New      |
| `GeminiNanoModelService`        | Chrome/Gemini Nano implementation with model-specific system prompts and token budgets           | New      |
| `Phi4MiniModelService`          | Edge/Phi-4 Mini implementation with model-specific system prompts and N-shot examples            | New      |
| `CodeExtractorService`          | Parses markdown code fences, validates HTML structure, detects truncation                        | New      |
| `LanguageModelService`          | Existing API wrapper -- availability check, model download. Not modified.                        | Existing |
| `ModelStatusComponent`          | Existing model status display. Not modified.                                                     | Existing |

---

## Recommended Project Structure

```
apps/in-browser-ai-coding-agent/src/app/
|-- coding-agent/                          # Feature: code generation + preview
|   |-- coding-agent.component.ts          # 3-pane split layout, pipeline wiring
|   |-- coding-agent.component.html        # Layout template
|   |-- coding-agent.component.css         # Split-pane styles (CSS Grid)
|   |-- prompt-input-pane.component.ts     # Prompt form, template selector
|   |-- code-view-pane.component.ts        # Streaming token display, final code
|   |-- preview-pane.component.ts          # <iframe sandbox> host, viewport toggle
|   `-- pipeline-progress.component.ts     # Step indicator
|
|-- pipeline/                              # Code generation pipeline services
|   |-- code-generation-pipeline.service.ts  # Orchestrates passes, manages sessions
|   |-- code-extractor.service.ts            # Markdown parsing, code extraction
|   `-- pipeline.types.ts                    # PipelinePhase, GeneratedCode, OutlineSchema
|
|-- model/                                 # Model abstraction layer
|   |-- model.service.ts                   # Abstract class (DI token)
|   |-- gemini-nano-model.service.ts       # Chrome Beta implementation
|   |-- phi4-mini-model.service.ts         # Edge Dev implementation
|   `-- model.providers.ts                 # Factory: browser detection + provider
|
|-- language-model.service.ts              # Existing -- do not modify
|-- model-status.component.ts              # Existing -- do not modify
`-- app.routes.ts                          # Add lazy-loaded /agent route
```

### Structure Rationale

- **`coding-agent/`:** Feature folder isolates the new split-pane UI from existing model status. All 5 new components co-located because they are tightly coupled to the same pipeline state signals.
- **`pipeline/`:** Separates orchestration from UI. Pure TypeScript services testable without Angular component harness. State lives here as signals -- components are read-only consumers.
- **`model/`:** Most critical boundary. Pipeline and UI both inject the abstract `ModelService` token. No code outside `model/` knows which model it is talking to. `model.providers.ts` is the only place that reads `navigator.userAgent`.

---

## Architectural Patterns

### Pattern 1: Abstract Class as DI Token for Model Abstraction

**What:** Define `ModelService` as an abstract class (not an interface -- interfaces are erased at runtime and cannot be DI tokens). Provide browser-specific implementations via a factory in `app.config.ts`.

**When to use:** Any service or component that needs to issue prompts. Never access `LanguageModel` global directly from pipeline code.

**Trade-offs:** One-time factory setup. Enables complete model-specific prompt engineering without conditional logic in the pipeline. Abstract class adds one level of indirection.

**Example:**

```typescript
// model/model.service.ts
import { LanguageModelPromptOptions } from './model.types';

export abstract class ModelService {
  /** Context window size in tokens. Gemini Nano: ~6,144. Phi-4 Mini: 128K. */
  abstract readonly contextWindow: number;

  /** Model display name for UI. */
  abstract readonly displayName: string;

  /**
   * Create a session with the given system prompt.
   * Implementations configure model-specific initialPrompts, temperature, topK.
   */
  abstract createSession(systemPrompt: string): Promise<LanguageModel>;

  /**
   * Prompt a session with structured JSON output.
   * Passes responseConstraint to enforce JSON schema compliance.
   */
  abstract prompt(session: LanguageModel, input: string, options?: LanguageModelPromptOptions): Promise<string>;

  /**
   * Stream tokens from a session.
   * Returns a ReadableStream<string> where each chunk is a new token/fragment.
   */
  abstract promptStreaming(session: LanguageModel, input: string, signal?: AbortSignal): ReadableStream<string>;
}

// model/model.providers.ts
import { Provider } from '@angular/core';
import { ModelService } from './model.service';
import { GeminiNanoModelService } from './gemini-nano-model.service';
import { Phi4MiniModelService } from './phi4-mini-model.service';

export function provideModelService(): Provider {
  const isEdge = /\bEdg\//.test(navigator.userAgent);

  return {
    provide: ModelService,
    useClass: isEdge ? Phi4MiniModelService : GeminiNanoModelService,
  };
}

// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideRouter(appRoutes), provideModelService()],
};
```

### Pattern 2: Anchor Session to Prevent Model Unloading

**What:** Keep one long-lived session alive for the duration of the app to prevent the browser from unloading the model from memory. The W3C spec says "destroying the session allows the user agent to unload the language model from memory, if no other APIs or sessions are using it." Chromium currently unloads after ~1 minute with no living sessions.

**When to use:** Always. Model reload after unload costs 23-110 minutes on ARM64 CI (Phi-4 Mini) and several seconds even locally. Keeping one "anchor" session alive is cheap compared to a cold restart.

**Trade-offs:** The anchor session consumes memory for its conversation context, but with an empty conversation this is minimal. The anchor session must NEVER be destroyed until the app is unloaded.

**Implementation:**

```typescript
// model/gemini-nano-model.service.ts (same pattern for Phi4MiniModelService)
@Injectable()
export class GeminiNanoModelService extends ModelService {
  private anchorSession: LanguageModel | null = null;

  /** Called once during app initialization. */
  async initialize(): Promise<void> {
    this.anchorSession = await LanguageModel.create({
      initialPrompts: [{ role: 'system', content: 'You are a helpful assistant.' }],
    });
  }

  async createSession(systemPrompt: string): Promise<LanguageModel> {
    // Create fresh sessions for pipeline passes.
    // The anchor session keeps the model loaded.
    return LanguageModel.create({
      initialPrompts: [{ role: 'system', content: systemPrompt }],
    });
  }
}
```

**Source:** [Chrome Session Management Docs](https://developer.chrome.com/docs/ai/session-management) -- "The model is unloaded after a period of time if there are no living sessions."

### Pattern 3: Multi-Pass Pipeline with Session-per-Pass

**What:** Run two sequential inference passes. Pass 1 produces a structured JSON outline using `responseConstraint`. Pass 2 takes the outline and generates HTML/CSS/JS code using `promptStreaming()` for real-time token display. Each pass gets its own session, created fresh and destroyed after use.

**When to use:** Always for code generation. Small models (Gemini Nano at ~6K tokens, Phi-4 Mini at 128K but still 3.8B parameters) produce significantly better code when given a structured plan first.

**Trade-offs:** Two sessions = two creation overheads (~100ms each). Total token budget is split across passes. For Gemini Nano this is tight (~4K usable tokens total).

**Recommended pass structure:**

````
Pass 1 -- Outline (JSON-constrained)
  Input:  user natural-language description
  Output: JSON { title, sections: [{name, elements, description}], style }
  Method: session.prompt(input, { responseConstraint: OUTLINE_SCHEMA })
  Budget: ~400 tokens in, ~300 tokens out
  Why:    responseConstraint guarantees valid JSON at grammar-sampler level

Pass 2 -- Code Generation (streamed markdown)
  Input:  JSON outline from Pass 1 serialized as structured prompt
  Output: ```html ... ``` fenced code block (single HTML file, inline CSS/JS)
  Method: session.promptStreaming(input, { signal })
  Budget: ~600 tokens in, ~2000 tokens out (tight on Gemini Nano)
  Why:    Streaming keeps UI responsive during 10-60s generation
````

**Session lifecycle (verified against `@types/dom-chromium-ai`):**

```typescript
// pipeline/code-generation-pipeline.service.ts
async generate(userPrompt: string, signal: AbortSignal): Promise<void> {
  this.phase.set('outlining');
  this.streamingTokens.set('');
  this.generatedCode.set(null);
  this.error.set(null);

  try {
    // Pass 1: structured outline
    const outlineSession = await this.model.createSession(OUTLINE_SYSTEM_PROMPT);

    try {
      const outlineJson = await outlineSession.prompt(userPrompt, {
        responseConstraint: OUTLINE_JSON_SCHEMA,
        signal,
      });
      this.outline.set(JSON.parse(outlineJson));
    } finally {
      outlineSession.destroy();
    }

    // Pass 2: code generation with streaming
    this.phase.set('generating');
    const codeSession = await this.model.createSession(CODEGEN_SYSTEM_PROMPT);

    try {
      const stream = codeSession.promptStreaming(
        buildCodeGenPrompt(this.outline()!),
        { signal },
      );
      let accumulated = '';

      for await (const chunk of stream) {
        accumulated += chunk;
        this.streamingTokens.set(accumulated);
      }

      const extracted = this.codeExtractor.extract(accumulated);
      this.generatedCode.set(extracted);
      this.phase.set('rendering');
    } finally {
      codeSession.destroy();
    }
  } catch (e) {
    if (signal.aborted) {
      this.phase.set('idle');
    } else {
      this.error.set(e instanceof Error ? e.message : String(e));
      this.phase.set('error');
    }
  }
}
```

**Key API details from `@types/dom-chromium-ai`:**

- `promptStreaming()` returns `ReadableStream<string>` (not `AsyncIterable` directly, but `ReadableStream` supports `for await...of` via async iterable protocol in modern browsers)
- `responseConstraint` is typed as `Record<string, unknown>` in prompt options
- `clone()` returns `Promise<LanguageModel>` with optional `AbortSignal`
- `destroy()` returns `undefined` (synchronous, immediate)
- `contextUsage` and `contextWindow` are readonly number properties on the session

### Pattern 4: Signal-Based Pipeline State

**What:** Model all pipeline progress as Angular signals in `CodeGenerationPipelineService`. UI components consume these signals reactively with `computed()` for derived state. No RxJS needed.

**When to use:** The pipeline has discrete states (idle, outlining, generating, rendering, done, error) plus continuous state (streaming tokens). Signals handle both naturally.

**Trade-offs:** Streaming tokens update the signal on every chunk (~10-100ms intervals). OnPush change detection picks up signal changes automatically. No manual `ChangeDetectorRef.markForCheck()` needed.

**Critical Angular caveat:** Reactive context is lost after `await`. Signal reads after an `await` are NOT tracked as dependencies by `computed()` or `effect()`. This is fine for the pipeline service because signals are written (`.set()`) not read in the async pipeline flow. Components read signals synchronously in templates.

**Example:**

```typescript
// pipeline/pipeline.types.ts
export type PipelinePhase = 'idle' | 'outlining' | 'generating' | 'rendering' | 'done' | 'error';

export interface GeneratedCode {
  html: string;
  source: 'strict' | 'loose' | 'raw';
}

export interface PageOutline {
  title: string;
  sections: Array<{ name: string; elements: string[]; description: string }>;
  style: string;
}

// pipeline/code-generation-pipeline.service.ts
@Injectable({ providedIn: 'root' })
export class CodeGenerationPipelineService {
  private readonly model = inject(ModelService);
  private readonly codeExtractor = inject(CodeExtractorService);

  readonly phase = signal<PipelinePhase>('idle');
  readonly outline = signal<PageOutline | null>(null);
  readonly streamingTokens = signal('');
  readonly generatedCode = signal<GeneratedCode | null>(null);
  readonly error = signal<string | null>(null);

  /** Derived state for components */
  readonly isRunning = computed(() => {
    const p = this.phase();

    return p === 'outlining' || p === 'generating' || p === 'rendering';
  });
}
```

### Pattern 5: Sandboxed iframe with Blob URL for Preview Isolation

**What:** Render generated HTML in an `<iframe>` loaded via `blob:` URL. The iframe gets `sandbox="allow-scripts"` (no `allow-same-origin`), giving it an opaque null origin that cannot access the parent page. Blob URLs are not subject to the parent page's CSP, so inline `<script>` and `<style>` tags in generated HTML execute normally.

**When to use:** Always. This is a hard security requirement (PREV-01, PREV-03). The `srcdoc` alternative inherits parent CSP and would block inline scripts.

**Security model:**

```
iframe sandbox="allow-scripts":
  allow-scripts         -- generated JS must execute
  (NO allow-same-origin) -- iframe origin is opaque null, cannot access parent DOM
  (NO allow-forms)       -- forms in generated HTML are decorative for v1 (no submission target)
  (NO allow-top-navigation) -- generated code cannot navigate the host app
  (NO allow-popups)      -- no window.open() from generated code
```

**Why NOT `allow-same-origin`:** Blob URLs inherit the origin of their creator (the Angular app). If `allow-same-origin` is set AND the iframe can run scripts, the iframe's JavaScript can reach `window.parent` and programmatically remove its own sandbox attribute. This completely defeats sandboxing.

**Error capture via postMessage:**

```typescript
// preview-pane.component.ts
private wrapWithErrorCapture(html: string): string {
  const errorScript = `<script>
    window.addEventListener('error', function(e) {
      parent.postMessage({
        type: 'preview-error',
        message: e.message,
        filename: e.filename,
        lineno: e.lineno
      }, '*');
    });
    window.addEventListener('unhandledrejection', function(e) {
      parent.postMessage({
        type: 'preview-error',
        message: 'Unhandled promise rejection: ' + e.reason
      }, '*');
    });
  </script>`;

  // Inject before closing </body> if present, otherwise append
  if (html.includes('</body>')) {
    return html.replace('</body>', errorScript + '</body>');
  }

  return html + errorScript;
}

private renderPreview(html: string): void {
  const previous = this.blobUrl();

  if (previous) {
    URL.revokeObjectURL(previous);
  }

  const wrapped = this.wrapWithErrorCapture(html);
  const blob = new Blob([wrapped], { type: 'text/html' });
  this.blobUrl.set(URL.createObjectURL(blob));
}
```

**Angular template (blob URL requires DomSanitizer bypass):**

```typescript
// preview-pane.component.ts
private readonly sanitizer = inject(DomSanitizer);

protected readonly safeBlobUrl = computed(() => {
  const url = this.blobUrl();

  if (!url) {
    return null;
  }

  return this.sanitizer.bypassSecurityTrustResourceUrl(url);
});
```

```html
@if (safeBlobUrl()) {
<iframe [src]="safeBlobUrl()" sandbox="allow-scripts" title="Generated preview" [style.width.px]="viewportWidth()"></iframe>
}
```

**Source:** [Angular Security -- Resource URL Context](https://angular.dev/best-practices/security), [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)

### Pattern 6: Streaming Token Display via ReadableStream-to-Signal Bridge

**What:** `promptStreaming()` returns `ReadableStream<string>`. Each chunk is a new token or fragment. Accumulate chunks into a signal that the code view pane reads reactively. Angular's OnPush change detection picks up signal updates automatically.

**When to use:** Pass 2 (code generation) uses `promptStreaming()` instead of `prompt()` so the user sees tokens arriving in real time rather than a frozen screen for 10-60 seconds.

**API contract (verified from `@types/dom-chromium-ai`):**

```typescript
promptStreaming(
  input: LanguageModelPrompt,
  options?: LanguageModelPromptOptions
): ReadableStream<string>;
```

The `ReadableStream` supports async iteration (`for await...of`) in Chrome 124+ and Edge 124+. Since our minimum is Chrome Beta 138+ / Edge Dev 138+, this is safe.

**Bridge pattern:**

```typescript
// Inside CodeGenerationPipelineService.generate()
const stream = codeSession.promptStreaming(prompt, { signal });
let accumulated = '';

for await (const chunk of stream) {
  accumulated += chunk;
  this.streamingTokens.set(accumulated);
}
```

**Trade-offs:** Each chunk triggers a signal update, which triggers change detection in consuming components. At typical token rates (~50-200 tokens/sec on CPU), this is ~5-20 signal updates per second -- well within Angular's OnPush budget. No debouncing needed.

### Pattern 7: Code Extraction with Truncation Detection

**What:** Parse model output for HTML code blocks. Detect truncation (model ran out of context window) before rendering. Three-tier extraction: strict (`html), loose (any `), raw (starts with `<`).

**When to use:** Pass 2 output is markdown with a fenced code block. Small models often omit language tags, forget closing fences, or truncate mid-tag.

**Truncation detection (critical for Gemini Nano):**

```typescript
@Injectable({ providedIn: 'root' })
export class CodeExtractorService {
  extract(response: string): GeneratedCode {
    const html = this.extractCodeBlock(response);

    if (this.isTruncated(html)) {
      throw new Error('The generated code appears incomplete. ' + 'Try a simpler description or fewer features.');
    }

    return { html, source: this.determineSource(response) };
  }

  private isTruncated(html: string): boolean {
    // Check for unclosed tags that suggest mid-stream cutoff
    const openTags = (html.match(/<(?!\/|!|br|hr|img|input|meta|link)[a-z][^>]*>/gi) || []).length;
    const closeTags = (html.match(/<\/[a-z][^>]*>/gi) || []).length;

    // Significant imbalance suggests truncation
    if (openTags - closeTags > 3) {
      return true;
    }

    // Missing closing </html> or </body> in a document that has opening tags
    if (html.includes('<html') && !html.includes('</html>')) {
      return true;
    }

    if (html.includes('<body') && !html.includes('</body>')) {
      return true;
    }

    return false;
  }
}
```

---

## Data Flow

### Full Pipeline Flow

```
User types prompt and clicks Generate
        |
        v
CodingAgentComponent.onGenerate(prompt)
  |-- Creates AbortController
  |-- Calls pipeline.generate(prompt, signal)
        |
        v
CodeGenerationPipelineService.generate(prompt, signal)
        |
        +-- phase.set('outlining')
        |
        v
  ModelService.createSession(OUTLINE_SYSTEM_PROMPT)
        |   [model-specific: system prompt, temperature, topK]
        v
  outlineSession.prompt(userPrompt, {
    responseConstraint: OUTLINE_JSON_SCHEMA,
    signal
  })
        |   [~400 tokens in, ~300 tokens out, guaranteed valid JSON]
        v
  JSON.parse(outlineJson) --> PageOutline
        |
        +-- outline.set(parsedOutline)
        +-- outlineSession.destroy()
        +-- phase.set('generating')
        |
        v
  ModelService.createSession(CODEGEN_SYSTEM_PROMPT)
        |   [model-specific: N-shot examples for Phi-4 Mini, concise for Gemini Nano]
        v
  codeSession.promptStreaming(buildCodeGenPrompt(outline), { signal })
        |   [ReadableStream<string>]
        |   [each chunk: accumulated += chunk; streamingTokens.set(accumulated)]
        |   [CodeViewPaneComponent reads streamingTokens() reactively]
        v
  Full response accumulated (~10-60 seconds)
        |
        +-- codeSession.destroy()
        |
        v
  CodeExtractorService.extract(rawResponse)
        |   [extract code block, detect truncation, validate]
        v
  GeneratedCode { html, source }
        |
        +-- generatedCode.set(result)
        +-- phase.set('rendering')
        |
        v
PreviewPaneComponent reacts to generatedCode()
        |
        v
  wrapWithErrorCapture(html)
  new Blob([wrapped], { type: 'text/html' })
  URL.createObjectURL(blob) --> blobUrl
        |
        v
  <iframe [src]="safeBlobUrl()" sandbox="allow-scripts">
        |
        +-- phase.set('done')
        |
        v
Generated HTML rendered in isolated preview
```

### State Management (Signal Flow)

```
CodeGenerationPipelineService (signal owner)
  |
  |-- phase: signal<PipelinePhase>
  |-- outline: signal<PageOutline | null>
  |-- streamingTokens: signal<string>
  |-- generatedCode: signal<GeneratedCode | null>
  |-- error: signal<string | null>
  |-- isRunning: computed<boolean>
  |
  +-- read by (via inject + template binding):
        |
        |-- CodingAgentComponent
        |     reads: error(), isRunning()
        |     controls: abort button
        |
        |-- PromptInputPaneComponent
        |     reads: isRunning()
        |     disables: submit button during generation
        |
        |-- PipelineProgressComponent
        |     reads: phase(), outline()
        |     displays: step indicators, outline preview
        |
        |-- CodeViewPaneComponent
        |     reads: streamingTokens(), generatedCode()
        |     displays: tokens as they arrive, final code
        |
        +-- PreviewPaneComponent
              reads: generatedCode()
              creates: blob URL, renders iframe
```

### Key Data Flows

1. **Abort propagation:** `CodingAgentComponent` creates an `AbortController` on generate and passes `signal` to the pipeline. The signal threads through `session.prompt({ signal })` and `session.promptStreaming({ signal })`. On abort, the LanguageModel API aborts the inference and the `for await...of` loop throws. The pipeline catches it and sets `phase('idle')`.

2. **iframe error feedback:** The preview iframe's injected `<script>` reports runtime errors via `postMessage({ type: 'preview-error', message })`. `PreviewPaneComponent` listens on `window:message`, filters by event type, and surfaces errors in the UI. The opaque origin means the parent cannot inspect iframe content directly -- postMessage is the only communication channel.

3. **Model-specific prompt routing:** `CodeGenerationPipelineService` calls `this.model.createSession(systemPrompt)`. The concrete `ModelService` implementation wraps this with model-specific configuration: Gemini Nano gets minimal system prompts to save context; Phi-4 Mini gets N-shot HTML examples in `initialPrompts`. The pipeline never branches on model type.

---

## Model-Specific Constraints

### Context Window Budget

| Model       | Context Window | System Prompt Budget | Outline Input | Code Gen Input | Code Gen Output | Total                 |
| ----------- | -------------- | -------------------- | ------------- | -------------- | --------------- | --------------------- |
| Gemini Nano | ~6,144 tokens  | ~200 tokens          | ~400 tokens   | ~600 tokens    | ~2,000 tokens   | ~3,200 tokens (tight) |
| Phi-4 Mini  | 128,000 tokens | ~500 tokens          | ~400 tokens   | ~800 tokens    | ~5,000+ tokens  | ~6,700 tokens (ample) |

Gemini Nano's ~6K context is the binding constraint. Strategies for Gemini Nano:

- Minimal system prompts (no N-shot examples -- use `responseConstraint` instead)
- Short outline schema (max 5 sections)
- Concise code generation prompt template
- Accept that complex pages will truncate

Phi-4 Mini has 128K tokens but is 3.8B parameters. More context does not mean more reasoning. Still benefits from the two-pass structure for quality.

### responseConstraint Support

Both Chrome 137+ and Edge 138+ support `responseConstraint`. Verified from `@types/dom-chromium-ai`:

```typescript
interface LanguageModelPromptOptions {
  responseConstraint?: Record<string, unknown>;
  omitResponseConstraintInput?: boolean;
  signal?: AbortSignal;
}
```

`omitResponseConstraintInput` is available to save context tokens -- the JSON schema is not counted against the context window when set to `true`. Use this on Gemini Nano where every token counts.

### Known `responseConstraint` Issues (LOW confidence)

As of Jan 2026, users report that regex patterns in `responseConstraint` can cause `UnknownError` failures. Avoid complex regex patterns in the outline schema. Stick to basic types: `object`, `array`, `string`, `boolean`, `number`, `maxItems`, `required`, `additionalProperties`.

**Source:** [Chrome AI Dev Preview Discussion](https://groups.google.com/a/chromium.org/g/chrome-ai-dev-preview-discuss/c/iVq7IJG0C9I)

---

## Split-Pane UI Architecture

### Library Decision: CSS Grid, No Library

**Recommendation:** Build the 3-pane layout with CSS Grid, not `angular-split`.

**Rationale:**

- `angular-split` latest is v20.0.0 (July 2025). No Angular 21-compatible version published as of March 2026. Would require `--legacy-peer-deps` workaround.
- The 3-pane layout has a simple requirement: left (prompt), center (code, toggle-able), right (preview). No nested splits, no complex constraint propagation.
- CSS Grid with `grid-template-columns` handles this cleanly. A drag handle for resizing can be added with ~50 lines of directive code if needed later.
- Avoids a runtime dependency for a feature that CSS handles natively.

**Implementation:**

```css
/* coding-agent.component.css */
:host {
  display: grid;
  grid-template-columns: minmax(280px, 1fr) minmax(0, 1fr) minmax(320px, 2fr);
  grid-template-rows: auto 1fr;
  height: 100vh;
  gap: 1px;
}

:host(.code-hidden) {
  grid-template-columns: minmax(280px, 1fr) minmax(320px, 2fr);
}
```

**Viewport toggle for preview pane:**

```typescript
// preview-pane.component.ts
protected readonly viewportWidth = signal(1280); // default: desktop

toggleViewport(): void {
  this.viewportWidth.update(w => w === 1280 ? 375 : 1280);
}
```

---

## Integration with Existing Architecture

### Extending LanguageModelService: Don't

The existing `LanguageModelService` handles availability checking and model download. It creates/destroys sessions per-call in its `prompt()` method. The new `ModelService` abstraction handles session creation for the pipeline.

These two services coexist:

- `LanguageModelService`: availability, download, single-shot prompt (existing UI)
- `ModelService`: session management, streaming, multi-pass (new pipeline)

Do NOT merge them. They serve different concerns and evolve independently.

### Session Lifecycle: Create-per-Pass, Not Clone-per-Pass

**Revised from initial research:** While `clone()` preserves system prompts and avoids re-creation, each pipeline pass needs a DIFFERENT system prompt (outline architect vs. front-end developer). `clone()` carries the parent's system prompt and conversation history, which would contaminate the next pass.

**Correct pattern:** Create a fresh session per pass with the appropriate system prompt. Destroy after each pass.

The template-clone pattern IS useful within a single model implementation when the same system prompt is reused across multiple generations. A `GeminiNanoModelService` could keep a pre-created template session and clone it for each `generate()` call, avoiding session creation latency. But this is an optimization to defer.

### Component Hierarchy (Routing)

```
AppComponent
  RouterOutlet
    /             --> ModelStatusComponent (existing)
    /agent        --> CodingAgentComponent (new, lazy-loaded)
                      |-- PromptInputPaneComponent
                      |-- CodeViewPaneComponent
                      |-- PreviewPaneComponent
                      +-- PipelineProgressComponent
```

Lazy-loading `/agent` keeps the initial bundle small. Model readiness check on `/` ensures the model is available before the user navigates to generate.

### app.config.ts Changes

```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideModelService(), // NEW: registers ModelService with browser-specific impl
  ],
};
```

---

## Suggested Build Order

Dependencies must be built bottom-up. This order minimizes blocked work:

**1. `ModelService` abstract class + `model.providers.ts`**

- No dependencies on other new code
- Defines the contract that everything else programs against
- Factory function detects browser and provides correct implementation
- Phase 1 deliverable

**2. `GeminiNanoModelService` (Chrome first) + `Phi4MiniModelService` (Edge second)**

- Depends on: `ModelService` abstract class
- Chrome first: 20s warm-up vs 23+ min for Edge
- Each implementation holds model-specific system prompts and configuration
- Phase 1 deliverable

**3. `CodeExtractorService`**

- Zero Angular dependencies -- pure TypeScript
- Unit testable with Vitest without browser (string in, GeneratedCode out)
- Build before pipeline so extraction is independently validated
- Phase 2 deliverable

**4. `CodeGenerationPipelineService` + pipeline types**

- Depends on: `ModelService` (DI), `CodeExtractorService`
- Core orchestration: two-pass pipeline, signal state, abort handling, streaming bridge
- Testable with a mock `ModelService` that returns canned responses
- Phase 2 deliverable

**5. `PreviewPaneComponent`**

- Depends on: blob URL mechanism only (no service dependencies)
- Develop in isolation with hardcoded HTML before connecting to pipeline
- Validate sandbox security model independently
- Phase 2 deliverable

**6. `CodingAgentComponent` + all panes + progress + routing**

- Depends on: all of the above
- Wire pipeline signals to UI
- Add streaming token display, progress indicators
- Phase 3 deliverable

**7. Prompt engineering and quality tuning**

- Depends on: full pipeline wired end-to-end
- Chrome-fast feedback loop (~20s iteration)
- Edge verification after Chrome is satisfactory
- Phase 3 deliverable

---

## Anti-Patterns

### Anti-Pattern 1: Sharing Sessions Across generate() Calls

**What people do:** Keep one session alive across multiple user requests to avoid creation overhead.
**Why it's wrong:** Conversation history from the previous generation contaminates the next. The model picks up context from the prior exchange, producing outputs shaped by the previous user's prompt. Context window fills up, degrading output quality.
**Do this instead:** Destroy sessions at the end of each `generate()` call. The anchor session (Pattern 2) keeps the model loaded; pipeline sessions are ephemeral.

### Anti-Pattern 2: Using srcdoc for Preview Rendering

**What people do:** Set `iframe.srcdoc = generatedHTML` because it is simpler than blob URLs.
**Why it's wrong:** `srcdoc` iframes inherit the parent page's CSP. Angular's production build sets CSP headers that block inline scripts. Generated single-file HTML with `<script>` tags silently fails to execute any JavaScript. The preview looks partially rendered with no interactivity.
**Do this instead:** `new Blob([html], { type: 'text/html' })` + `URL.createObjectURL()`. Blob URLs get an opaque origin not subject to parent CSP. Remember to `revokeObjectURL()` the previous URL before creating a new one.

### Anti-Pattern 3: `allow-scripts` + `allow-same-origin` on sandbox

**What people do:** Add `allow-same-origin` to the sandbox so the iframe can access localStorage or other APIs.
**Why it's wrong:** Blob URLs inherit the Angular app's origin. With both `allow-scripts` and `allow-same-origin`, generated JavaScript can reach `window.parent` and programmatically remove its own sandbox attribute, defeating all isolation. The generated code could exfiltrate data, modify the parent DOM, or navigate the parent page.
**Do this instead:** Use `sandbox="allow-scripts"` only. If generated code needs to persist data, use `postMessage` to communicate with the parent, which validates and proxies the request.

**Source:** [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe), [Daniel Dusek -- Escaping Improperly Sandboxed iframes](https://danieldusek.com/escaping-improperly-sandboxed-iframes.html)

### Anti-Pattern 4: Single-Pass Generation

**What people do:** Prompt the model once with "Generate a complete landing page with..." and render the raw response.
**Why it's wrong:** Small on-device models hallucinate structure, produce malformed HTML, and truncate output mid-tag. Instruction following for a complex unconstrained task in one shot is unreliable, especially for Gemini Nano.
**Do this instead:** Two-pass pipeline. Pass 1 produces valid JSON (enforced by `responseConstraint`). Pass 2 generates code from a well-defined spec. Quality improves because the model has a structured target, and truncation in Pass 1 is caught before Pass 2 begins.

### Anti-Pattern 5: Worker Offloading for LanguageModel API

**What people do:** Move inference to a Web Worker to keep the main thread responsive.
**Why it's wrong:** The LanguageModel API is `[Exposed=Window]` only. It is NOT available in Web Workers, Service Workers, or Shared Workers. `LanguageModel.create()` in a worker context throws immediately.
**Do this instead:** Use `promptStreaming()` on the main thread. Token-by-token streaming keeps the UI responsive because Angular can process signal updates between chunks.

### Anti-Pattern 6: RxJS Observables for Pipeline State

**What people do:** Use `BehaviorSubject` or `ReplaySubject` for pipeline state and `async` pipe in templates.
**Why it's wrong:** Adds complexity without benefit. The pipeline state is synchronous signal reads in templates. RxJS adds subscription management, potential memory leaks, and `takeUntil`/`takeUntilDestroyed` boilerplate. Angular 21's signal model is designed for this exact use case.
**Do this instead:** Use `signal()` for writable state, `computed()` for derived state. Templates read signals directly. OnPush change detection handles updates automatically.

---

## Sources

- [W3C Prompt API Spec](https://webmachinelearning.github.io/prompt-api/) -- session lifecycle, responseConstraint, `[Exposed=Window]`, contextWindow (HIGH confidence)
- [Chrome Prompt API Docs](https://developer.chrome.com/docs/ai/prompt-api) -- API surface, structured output, streaming (HIGH confidence)
- [Chrome Session Management](https://developer.chrome.com/docs/ai/session-management) -- clone(), anchor pattern, model unloading, session lifecycle (HIGH confidence)
- [Chrome Structured Output for Prompt API](https://developer.chrome.com/docs/ai/structured-output-for-prompt-api) -- responseConstraint JSON schema, shipped in Chrome 137+ (HIGH confidence)
- [Edge Prompt API Docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) -- Phi-4 Mini, responseConstraint, N-shot (HIGH confidence)
- [`@types/dom-chromium-ai@0.0.15`](https://www.npmjs.com/package/@types/dom-chromium-ai) -- TypeScript type definitions, verified locally (HIGH confidence)
- [Angular Security Best Practices](https://angular.dev/best-practices/security) -- DomSanitizer, resource URL context, iframe (HIGH confidence)
- [MDN iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) -- sandbox attribute, allow-scripts, allow-same-origin (HIGH confidence)
- [Angular Signals Guide](https://angular.dev/guide/signals) -- signals, computed, effect, reactive context (HIGH confidence)
- [Angular Resource API](https://angular.dev/guide/signals/resource) -- async integration with signals (HIGH confidence)
- [angular-split GitHub](https://github.com/angular-split/angular-split) -- v20.0.0 latest, no Angular 21 version (MEDIUM confidence)
- [Daniel Dusek -- Escaping Improperly Sandboxed iframes](https://danieldusek.com/escaping-improperly-sandboxed-iframes.html) -- sandbox escape proof of concept (MEDIUM confidence)
- [webmachinelearning/prompt-api#130](https://github.com/webmachinelearning/prompt-api/issues/130) -- model unloading discussion, warmup proposal (MEDIUM confidence)
- Existing codebase: `language-model.service.ts`, `model-status.component.ts`, `docs/SUMMARY.md` -- empirical ground truth (HIGH confidence)

---

_Architecture research for: in-browser AI coding agent -- v1.0 prompt-to-preview milestone_
_Researched: 2026-03-23_
