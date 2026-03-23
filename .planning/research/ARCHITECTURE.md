# Architecture Research

**Domain:** In-browser AI coding agent — code generation pipeline, preview rendering, model abstraction
**Researched:** 2026-03-23
**Confidence:** HIGH (API capabilities from official docs + existing codebase analysis) / MEDIUM (pipeline structure from research literature)

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              Angular 21 Application                               │
├───────────────────────────────────┬──────────────────────────────────────────────┤
│           UI Layer                │            Service Layer                      │
│  ┌────────────────────────┐       │  ┌─────────────────────────────────────┐     │
│  │  CodingAgentComponent  │       │  │     CodeGenerationPipelineService   │     │
│  │  (split-pane layout)   │       │  │  (orchestrates multi-pass pipeline) │     │
│  │                        │       │  └────────────────┬────────────────────┘     │
│  │  ┌──────────────────┐  │       │                   │                          │
│  │  │ PromptInputPane  │  │       │  ┌────────────────▼────────────────────┐     │
│  │  │ (left side)      │  │ ◄───► │  │        ModelService (abstract)      │     │
│  │  └──────────────────┘  │       │  │  ┌────────────────────────────────┐ │     │
│  │                        │       │  │  │  GeminiNanoModelService        │ │     │
│  │  ┌──────────────────┐  │       │  │  │  (Chrome Beta implementation)  │ │     │
│  │  │  PreviewPane     │  │       │  │  ├────────────────────────────────┤ │     │
│  │  │  (right side)    │  │       │  │  │  Phi4MiniModelService          │ │     │
│  │  │  ┌────────────┐  │  │       │  │  │  (Edge Dev implementation)     │ │     │
│  │  │  │  <iframe>  │  │  │       │  │  └────────────────────────────────┘ │     │
│  │  │  │  sandbox   │  │  │       │  └─────────────────────────────────────┘     │
│  │  │  └────────────┘  │  │       │                                              │
│  │  └──────────────────┘  │       │  ┌─────────────────────────────────────┐     │
│  └────────────────────────┘       │  │       CodeExtractorService          │     │
│                                   │  │  (parse markdown, validate output)  │     │
│  ┌────────────────────────┐       │  └─────────────────────────────────────┘     │
│  │  PipelineProgressComp  │       │                                              │
│  │  (steps indicator)     │       │  ┌─────────────────────────────────────┐     │
│  └────────────────────────┘       │  │       LanguageModelService          │     │
│                                   │  │  (existing -- availability + DL)    │     │
│  ┌────────────────────────┐       │  └─────────────────────────────────────┘     │
│  │  ModelStatusComponent  │       │                                              │
│  │  (existing)            │       └──────────────────────────────────────────────┤
│  └────────────────────────┘                                                      │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component                       | Responsibility                                                            | Notes                                                         |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `CodingAgentComponent`          | Split-pane layout, wires prompt input to pipeline, renders progress       | New. Replaces or wraps `ModelStatusComponent` for the main UX |
| `PromptInputPaneComponent`      | User input form, submit button, displays pipeline progress                | New. Reuses prompt input patterns from `ModelStatusComponent` |
| `PreviewPaneComponent`          | Hosts sandboxed `<iframe>`, posts generated HTML to it, error boundary    | New                                                           |
| `PipelineProgressComponent`     | Step indicators (Thinking / Writing / Rendering), streaming token preview | New                                                           |
| `ModelStatusComponent`          | Existing model availability, download progress — unchanged                | Existing                                                      |
| `CodeGenerationPipelineService` | Orchestrates multi-pass inference, tracks state signals                   | New. Core service                                             |
| `ModelService` (abstract class) | DI token for swappable model implementations                              | New                                                           |
| `GeminiNanoModelService`        | Chrome/Gemini Nano implementation with tuned prompts                      | New. Implements `ModelService`                                |
| `Phi4MiniModelService`          | Edge/Phi-4 Mini implementation with tuned prompts                         | New. Implements `ModelService`                                |
| `CodeExtractorService`          | Parses markdown code fences from model responses, validates HTML          | New                                                           |
| `LanguageModelService`          | Existing API wrapper (availability, download, single prompt)              | Existing — to be extended                                     |

---

## Recommended Project Structure

```
apps/in-browser-ai-coding-agent/src/app/
├── coding-agent/                       # Feature: code generation + preview
│   ├── coding-agent.component.ts       # Split-pane root, pipeline orchestration trigger
│   ├── coding-agent.component.html     # Layout: left prompt / right preview
│   ├── coding-agent.component.css      # Split-pane CSS (CSS Grid or flex)
│   ├── prompt-input-pane.component.ts  # Prompt form, submit, pass count selector
│   ├── preview-pane.component.ts       # <iframe sandbox> host, postMessage bridge
│   └── pipeline-progress.component.ts # Step indicators, streaming token display
│
├── pipeline/                           # Code generation pipeline services
│   ├── code-generation-pipeline.service.ts  # Orchestrates passes, manages sessions
│   ├── code-extractor.service.ts            # Markdown parsing, code block extraction
│   └── pipeline.types.ts                    # PipelineState, PipelineStep, GeneratedCode
│
├── model/                              # Model abstraction layer
│   ├── model.service.ts                # Abstract class (DI token + contract)
│   ├── gemini-nano-model.service.ts    # Chrome Beta implementation
│   ├── phi4-mini-model.service.ts      # Edge Dev implementation
│   └── model.providers.ts             # Factory: provides correct impl based on browser
│
├── language-model.service.ts           # Existing — extend, do not replace
├── model-status.component.ts           # Existing — unchanged
└── app.routes.ts                       # Add /agent route
```

### Structure Rationale

- **`coding-agent/`:** Feature-scoped folder keeps the new split-pane UI isolated from the existing model status UI. Avoids polluting the root app directory.
- **`pipeline/`:** Separates orchestration logic (which sessions, which prompts, which passes) from UI. Testable in unit tests without Angular. State lives here as signals.
- **`model/`:** The DI abstraction is the most critical boundary. Putting it in its own folder prevents `pipeline/` from reaching into `coding-agent/` and vice versa.
- **`model.providers.ts`:** A factory function that detects the browser and provides the correct implementation. Registered in `app.config.ts`. Components and pipeline services only inject the abstract `ModelService` token.

---

## Architectural Patterns

### Pattern 1: Abstract Class as DI Token for Model Abstraction

**What:** Define `ModelService` as an abstract class (not an interface — interfaces have no runtime artifact). Provide `GeminiNanoModelService` or `Phi4MiniModelService` via `{ provide: ModelService, useClass: ... }` in a factory registered in `app.config.ts`.

**When to use:** Any service or component that needs to issue prompts. Never inject `LanguageModelService` directly from pipeline code — always go through `ModelService`.

**Trade-offs:** Requires one-time factory setup. Enables complete model-specific prompt engineering, token limit handling, and system prompt tuning without any conditional logic in the pipeline.

**Example:**

```typescript
// model/model.service.ts
export abstract class ModelService {
  abstract readonly contextWindow: number;
  abstract readonly supportsResponseConstraint: boolean;
  abstract createSession(systemPrompt: string): Promise<LanguageModelSession>;
  abstract prompt(session: LanguageModelSession, text: string, options?: LanguageModelPromptOptions): Promise<string>;
  abstract promptStreaming(session: LanguageModelSession, text: string, signal?: AbortSignal): ReadableStream<string>;
}

// model/model.providers.ts
export function provideModelService(): Provider {
  const isEdge = navigator.userAgent.includes('Edg/');

  return {
    provide: ModelService,
    useClass: isEdge ? Phi4MiniModelService : GeminiNanoModelService,
  };
}

// app.config.ts  (add to providers array)
provideModelService();
```

### Pattern 2: Multi-Pass Inference with Session Clone Strategy

**What:** Create a "template session" with the system prompt, then clone it for each pipeline pass. Cloning is cheaper than creating from scratch and preserves system prompt without re-issuing N-shot examples. Each pass gets a fresh conversation history.

**When to use:** Any time a pipeline has 2+ passes where each pass needs a clean slate but the same system prompt and sampling parameters.

**Trade-offs:** Cloned sessions share system prompt tokens against the context window. For Gemini Nano (~6,144 tokens) this is tight. For Phi-4 Mini (128K context) this is ample.

**Recommended pass structure for v1:**

````
Pass 1 — Outline (JSON-constrained)
  Input:  user natural language description
  Output: JSON { title, sections: [{name, elements}], colorScheme, layout }
  Session: new session with "HTML architect" system prompt
  Constraint: responseConstraint JSON schema (both Chrome 137+ and Edge)
  Token budget: ~400 tokens in, ~300 tokens out

Pass 2 — Code Generation (markdown output)
  Input:  JSON outline from Pass 1
  Output: ```html ... ``` fenced code block containing full single-file HTML
  Session: cloned from a "senior front-end developer" template session
  Constraint: none (markdown expected, extract with CodeExtractorService)
  Token budget: ~600 tokens in, ~2000 tokens out (tight on Gemini Nano)
````

**Example session lifecycle:**

```typescript
// pipeline/code-generation-pipeline.service.ts
async generate(userPrompt: string, signal: AbortSignal): Promise<GeneratedCode> {
  // Pass 1: structured outline
  const outlineSession = await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: OUTLINE_SYSTEM_PROMPT }],
  });

  const outlineJson = await outlineSession.prompt(userPrompt, {
    responseConstraint: OUTLINE_JSON_SCHEMA,
    signal,
  });

  outlineSession.destroy();

  const outline = JSON.parse(outlineJson);

  // Pass 2: code generation (clone template for fresh history)
  const codeSession = await this.codeSessionTemplate.clone();

  const rawResponse = await codeSession.prompt(
    buildCodeGenPrompt(outline),
    { signal },
  );

  codeSession.destroy();

  return this.codeExtractor.extract(rawResponse);
}
```

### Pattern 3: Sandboxed iframe with blob URL for Preview Isolation

**What:** Render generated HTML in a `<iframe>` loaded from a `blob:` URL (not `srcdoc`). Blob URL iframes get their own opaque origin — they do NOT inherit the parent page's CSP. The `sandbox` attribute further restricts capabilities. Use `postMessage` for error reporting from iframe to host.

**When to use:** Always. `srcdoc` iframes inherit the parent's CSP, which would block inline scripts in generated HTML. Blob URLs avoid this at the cost of needing `URL.revokeObjectURL()` cleanup.

**Security model:**

```
iframe sandbox attributes:
  allow-scripts         — generated JS must run
  allow-forms           — forms in generated HTML should work
  (NO allow-same-origin) — keeps iframe origin as null/opaque
  (NO allow-top-navigation) — prevents generated code from navigating the host app
  (NO allow-popups)     — no window.open from generated code

CSP on the parent page:
  frame-src blob:       — allow blob: origin iframes
```

**Error capture pattern:**

```typescript
// preview-pane.component.ts
private loadPreview(html: string): void {
  const previous = this.blobUrl();

  if (previous) {
    URL.revokeObjectURL(previous);
  }

  const blob = new Blob([this.wrapInErrorCapture(html)], {
    type: 'text/html',
  });
  const url = URL.createObjectURL(blob);
  this.blobUrl.set(url);
}

private wrapInErrorCapture(html: string): string {
  // Inject error handler that postMessages to parent before </body>
  const errorScript = `
    <script>
      window.addEventListener('error', (e) => {
        parent.postMessage({ type: 'preview-error', message: e.message }, '*');
      });
    </script>
  `;

  return html.replace('</body>', `${errorScript}</body>`);
}
```

**Template:**

```html
<!-- preview-pane.component.html -->
<iframe #previewFrame [src]="safeBlobUrl()" sandbox="allow-scripts allow-forms" title="Generated preview"></iframe>
```

### Pattern 4: Signal-Based Pipeline State

**What:** Model pipeline progress as a set of signals in `CodeGenerationPipelineService`. UI components consume these signals reactively. No Subjects, no BehaviorSubject — pure Angular signals.

**When to use:** The pipeline has discrete states that components need to react to independently (progress bar, disable button, show streaming tokens). Signals are simpler than RxJS for this use case.

**Trade-offs:** Streaming token display needs `promptStreaming()` which returns a `ReadableStream`. Bridge the stream to a signal using an async function that updates the signal on each chunk. This is slightly awkward but avoids pulling in RxJS.

**Example:**

```typescript
// pipeline/pipeline.types.ts
export type PipelinePhase = 'idle' | 'outlining' | 'generating' | 'rendering' | 'done' | 'error';

// pipeline/code-generation-pipeline.service.ts
@Injectable({ providedIn: 'root' })
export class CodeGenerationPipelineService {
  readonly phase = signal<PipelinePhase>('idle');
  readonly streamingTokens = signal('');
  readonly generatedCode = signal<GeneratedCode | null>(null);
  readonly error = signal<string | null>(null);

  // Components use computed() to derive what they need:
  // readonly isRunning = computed(() => this.phase() !== 'idle' && this.phase() !== 'done' && this.phase() !== 'error');
}
```

### Pattern 5: Code Extraction from Markdown Responses

**What:** When `responseConstraint` is not used (Pass 2 code generation), parse the model response for fenced code blocks using regex. Extract the first `html` or bare code fence. Fall back gracefully if extraction fails.

**When to use:** Any pass where the model output is markdown prose with embedded code.

**Trade-offs:** Regex is fragile. Small on-device models frequently omit the language tag or forget closing fences. The extractor must handle these cases. Two-pass strategy (try strict extract, fall back to loose extract, fail gracefully) is more robust than a single pattern.

**Example:**

````typescript
// pipeline/code-extractor.service.ts
@Injectable({ providedIn: 'root' })
export class CodeExtractorService {
  extract(response: string): GeneratedCode {
    // Strict: ```html ... ``` or ```HTML ... ```
    const strict = /```(?:html|HTML)\s*\n([\s\S]*?)\n```/;
    // Loose: any ``` ... ``` block
    const loose = /```(?:\w*)\s*\n([\s\S]*?)\n```/;
    // Desperate: entire response if it looks like HTML
    const looksLikeHtml = response.trimStart().startsWith('<');

    const strictMatch = response.match(strict);

    if (strictMatch) {
      return { html: strictMatch[1], source: 'strict' };
    }

    const looseMatch = response.match(loose);

    if (looseMatch) {
      return { html: looseMatch[1], source: 'loose' };
    }

    if (looksLikeHtml) {
      return { html: response, source: 'raw' };
    }

    throw new Error('No extractable code in model response');
  }
}
````

---

## Data Flow

### Request Flow (Full Pipeline)

```
User submits prompt
        |
        v
CodingAgentComponent.onSubmit(prompt)
        |
        v
CodeGenerationPipelineService.generate(prompt, abortSignal)
        |
        +-- phase.set('outlining')
        |
        v
  ModelService.createSession(OUTLINE_SYSTEM_PROMPT)
        |
        v
  session.prompt(userPrompt, { responseConstraint: OUTLINE_SCHEMA })
        |                [~400 tokens in, ~300 out, JSON]
        v
  JSON.parse(outlineJson) → StructuredOutline
        |
        +-- outlineSession.destroy()
        +-- phase.set('generating')
        |
        v
  codeSessionTemplate.clone()
        |
        v
  session.promptStreaming(buildCodeGenPrompt(outline))
        |                [streaming — each chunk → streamingTokens.set()]
        v
  Full response accumulated
        |
        +-- codeSession.destroy()
        |
        v
  CodeExtractorService.extract(rawResponse)
        |
        v
  GeneratedCode { html: string, source: 'strict'|'loose'|'raw' }
        |
        +-- generatedCode.set(result)
        +-- phase.set('rendering')
        |
        v
PreviewPaneComponent reacts to generatedCode()
        |
        v
  new Blob([html], { type: 'text/html' })
  URL.createObjectURL(blob) → blobUrl.set(url)
        |
        v
  <iframe [src]="safeBlobUrl()" sandbox="allow-scripts allow-forms">
        |
        +-- phase.set('done')
        |
        v
Generated HTML rendered in isolated preview
```

### State Management

```
CodeGenerationPipelineService (signals)
  phase: signal<PipelinePhase>
  streamingTokens: signal<string>
  generatedCode: signal<GeneratedCode | null>
  error: signal<string | null>
        |
        | (read-only consumption)
        v
  PipelineProgressComponent  -- reads phase()
  PromptInputPaneComponent   -- reads phase() to disable submit
  PreviewPaneComponent       -- reads generatedCode()
  CodingAgentComponent       -- reads error()
```

### Key Data Flows

1. **System prompt differentiation:** `ModelService` implementations hold their own system prompts as private constants. `CodeGenerationPipelineService` calls `createSession(systemPrompt)` on the abstract token — the concrete implementation decides on temperature, topK, and any model-specific preamble before passing through to `LanguageModel.create()`.

2. **Abort propagation:** `CodingAgentComponent` creates an `AbortController` when the user submits and cancels it on component destroy or when the user clicks Cancel. The abort signal is threaded through `generate(prompt, signal)` down to `session.prompt()` / `session.promptStreaming()`.

3. **iframe error feedback:** The preview iframe's injected `<script>` posts runtime errors via `postMessage({ type: 'preview-error', message })`. `PreviewPaneComponent` listens with `@HostListener('window:message', ['$event'])`, filters by type, and sets an error signal.

---

## Model-Specific Constraints

### Context Window Reality

| Model                | Context Window | Practical Code Gen Budget                                                                |
| -------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| Gemini Nano (Chrome) | ~6,144 tokens  | ~4,000 tokens after system prompt; single-file HTML must stay under ~2,000 tokens output |
| Phi-4 Mini (Edge)    | 128K tokens    | Effectively unlimited for this use case                                                  |

Gemini Nano's 6,144-token context window is the binding constraint. A full HTML page with inline CSS and JS can easily reach 2,000-3,000 tokens. The two-pass pipeline must keep Pass 1 (outline) output small so Pass 2 has enough context budget.

Pass 1 JSON outline should be constrained via `responseConstraint` to stay under 300 tokens. Pass 2 system prompt + outline + code output must fit within ~4,000 tokens total. For complex prompts, Gemini Nano may truncate or produce incomplete HTML.

### Instruction Following Reality

Gemini Nano has known limitations with instruction following for structured output. `responseConstraint` (shipped in Chrome 137+) forces JSON schema compliance at the grammar-sampler level, bypassing instruction-following unreliability. Use it for all structured output passes. Do not rely on "output JSON" instructions alone.

Phi-4 Mini instruction following is stronger but its primary training is in Python, not HTML/CSS/JS. Web-specific prompt engineering (showing a complete example in `initialPrompts` as N-shot) significantly improves output quality for front-end code.

---

## Integration with Existing Architecture

### Extending LanguageModelService

The existing `LanguageModelService` handles availability checking and model download. Do not replace it. The new `ModelService` abstraction handles session creation and prompting. Both coexist.

`ModelService` implementations inject `LanguageModelService` (or access `LanguageModel` global directly) for the `isApiSupported` check. Availability and download remain in `LanguageModelService`. Session management is the responsibility of pipeline services.

### Session Lifecycle Policy

The existing `LanguageModelService.prompt()` creates and destroys a session per call. This is correct for single-shot prompts. For the pipeline, sessions are created and destroyed within `CodeGenerationPipelineService.generate()`. Do not reuse sessions across multiple `generate()` calls — stale conversation history corrupts subsequent generations.

One optimization is keeping a long-lived "template session" with the code generation system prompt, then cloning it for each generation. This avoids the session creation overhead on subsequent calls. Implement this only after the basic pipeline works.

### Component Hierarchy

The split-pane UI routes through `/agent` (lazy-loaded). `ModelStatusComponent` remains on the default/home route. This separates the model readiness flow (existing) from the generation flow (new).

```
AppComponent
  RouterOutlet
    /             → ModelStatusComponent (existing)
    /agent        → CodingAgentComponent (new, lazy-loaded)
                    ├── PromptInputPaneComponent
                    ├── PipelineProgressComponent
                    └── PreviewPaneComponent
```

---

## Suggested Build Order

Dependencies must be built bottom-up:

1. **`ModelService` abstract class + `model.providers.ts`**
   - No dependencies on other new code
   - Enables concrete implementations to be developed in parallel

2. **`GeminiNanoModelService` + `Phi4MiniModelService`**
   - Depends on: `ModelService` abstract class
   - Fastest iteration: Chrome Beta / Gemini Nano (20s warm-up vs 23+ min)
   - Develop and test all prompt engineering on Chrome first

3. **`CodeExtractorService`**
   - No Angular dependencies — pure TypeScript, easily unit-tested with Vitest
   - Build before pipeline so extraction logic is testable independently

4. **`CodeGenerationPipelineService`**
   - Depends on: `ModelService` token, `CodeExtractorService`
   - Testable with mock `ModelService` implementation
   - Implement two-pass pipeline, signal state, abort handling

5. **`PreviewPaneComponent`**
   - Depends on: blob URL mechanism (no service dependencies)
   - Develop in isolation with hardcoded HTML before pipeline is wired
   - Validate sandbox security before connecting to live model output

6. **`CodingAgentComponent` + panes + progress**
   - Depends on: all of the above
   - Wire `CodeGenerationPipelineService` to UI
   - Add streaming token display to `PipelineProgressComponent`

7. **Prompt engineering and quality tuning**
   - Depends on: full pipeline wired end-to-end
   - Chrome-fast feedback loop for iteration
   - Edge verification after Chrome is satisfactory

---

## Anti-Patterns

### Anti-Pattern 1: Sharing Sessions Across Generate() Calls

**What people do:** Keep one session alive across multiple user requests to avoid creation overhead.
**Why it's wrong:** Conversation history from the previous generation contaminates the next. The model picks up context from the prior exchange, producing outputs shaped by the previous user's prompt.
**Do this instead:** Destroy sessions at the end of each `generate()` call. If creation latency is unacceptable, use a cloned template session — cloning is fast and produces a clean conversation history while preserving system prompt.

### Anti-Pattern 2: Using srcdoc for Preview Rendering

**What people do:** Set `iframe.srcdoc = generatedHTML` because it's simpler than creating blob URLs.
**Why it's wrong:** `srcdoc` iframes inherit the parent page's CSP. The parent's CSP blocks inline scripts, which are ubiquitous in generated single-file HTML. The preview silently fails to execute any JavaScript.
**Do this instead:** Create a `Blob` with `type: 'text/html'` and use `URL.createObjectURL()`. Blob URLs get an opaque `blob:` origin that is not subject to the parent's CSP. Remember to revoke the previous blob URL before creating a new one to avoid memory leaks.

### Anti-Pattern 3: Injecting LanguageModelService Directly in Pipeline Code

**What people do:** Reach for `LanguageModelService` (the existing low-level wrapper) inside `CodeGenerationPipelineService`.
**Why it's wrong:** Bypasses the model abstraction layer. Pipeline code accumulates Gemini/Phi conditional branches. Unit testing requires mocking at the `LanguageModel` global level.
**Do this instead:** Always inject the abstract `ModelService` token. The concrete implementation (resolved by the DI provider factory) handles all model-specific concerns. Pipeline code stays model-agnostic.

### Anti-Pattern 4: Single-Pass Generation for Complex Prompts

**What people do:** Prompt the model once with "Generate a complete landing page with..." and pass the raw response directly to the preview.
**Why it's wrong:** Small on-device models (especially Gemini Nano at 6K tokens) hallucinate structure, produce malformed HTML, and truncate output mid-tag. Instruction following for a complex, unconstrained task in one shot is poor.
**Do this instead:** Use a two-pass pipeline. Pass 1 uses `responseConstraint` to produce a valid JSON outline (small, guaranteed valid JSON). Pass 2 uses the outline as a structured spec, giving the model a well-defined target. Token budget is controlled at each pass. Quality improves measurably (per research literature on multi-stage LLM code generation).

### Anti-Pattern 5: Worker Offloading for LanguageModel API

**What people do:** Try to move inference to a Web Worker to keep the main thread responsive during long generations.
**Why it's wrong:** The LanguageModel API is `[Exposed=Window]` only. It is not available in Web Workers, Service Workers, or Shared Workers. Attempting to call `LanguageModel.create()` from a worker throws immediately.
**Do this instead:** Use `promptStreaming()` instead of `prompt()` on the main thread. Streaming returns tokens as they arrive, allowing Angular's change detection to update the UI continuously rather than blocking until the full response arrives. For main-thread responsiveness, prioritize streaming over worker offloading.

### Anti-Pattern 6: Skipping Error Boundaries on Preview

**What people do:** Render generated HTML directly with no error capture, assuming model output is always valid.
**Why it's wrong:** Small models produce broken HTML, unclosed tags, invalid JS, and runtime errors. Without error capture, the iframe silently fails or crashes without any user feedback.
**Do this instead:** Inject a `window.onerror` handler into the generated HTML before rendering. Use `postMessage` to report errors to the host app. Display a friendly error state in `PreviewPaneComponent` when errors are received.

---

## Scaling Considerations

This is a single-user, in-browser application. Traditional scaling concerns (users, servers, databases) do not apply. The relevant "scaling" is prompt complexity vs. model capability.

| Prompt Complexity                              | Gemini Nano                        | Phi-4 Mini                  |
| ---------------------------------------------- | ---------------------------------- | --------------------------- |
| Simple landing page (1 section, minimal JS)    | Viable with 2-pass pipeline        | Good output                 |
| Medium dashboard (2-3 components, moderate JS) | May truncate output; context tight | Good output                 |
| Complex app (game, multi-component, heavy JS)  | Likely incomplete or malformed     | Possible but quality varies |

For Gemini Nano, the practical limit is single-purpose pages with minimal JavaScript. For Phi-4 Mini, medium complexity is achievable. Neither model produces production-quality code for complex applications — set user expectations accordingly in the UI.

---

## Integration Points

### Internal Boundaries

| Boundary                                                  | Communication                                     | Notes                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `CodingAgentComponent` to `CodeGenerationPipelineService` | Direct service injection, reads signals           | Component triggers `generate()`, reads `phase()`, `streamingTokens()`, `generatedCode()`, `error()`  |
| `CodeGenerationPipelineService` to `ModelService`         | Abstract DI token, method calls                   | Pipeline never knows which model it is using                                                         |
| `PreviewPaneComponent` to generated iframe                | `src` binding (blob URL) + `window.message` event | One-way data push; error feedback via postMessage                                                    |
| `ModelService` to `LanguageModel` global                  | Direct browser API calls                          | Both `GeminiNanoModelService` and `Phi4MiniModelService` call `LanguageModel.create()`               |
| New pipeline to existing `LanguageModelService`           | Coexist, separate concerns                        | `LanguageModelService` still owns availability + download. Pipeline services own session management. |

### Feature Flag Constraints

Both model implementations must check `LanguageModel` availability before creating sessions. The existing `LanguageModelService.isApiSupported` and `checkAvailability()` handle this. The abstract `ModelService.createSession()` should throw a meaningful error if `LanguageModel` is not available, rather than producing a cryptic browser error.

---

## Sources

- [W3C Prompt API Specification](https://webmachinelearning.github.io/prompt-api/) — session lifecycle, responseConstraint, contextWindow, `[Exposed=Window]` constraint (HIGH confidence)
- [Chrome Prompt API Docs](https://developer.chrome.com/docs/ai/prompt-api) — session management, system prompts, structured output, streaming (HIGH confidence)
- [Chrome Structured Output for Prompt API](https://developer.chrome.com/docs/ai/structured-output-for-prompt-api) — responseConstraint shipped in Chrome 137+, JSON Schema + RegExp support (HIGH confidence)
- [Edge Prompt API Docs](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api) — Phi-4 Mini context, responseConstraint support, N-shot prompting (HIGH confidence)
- [Gemini Nano in Chrome 137 notes](https://www.swyx.io/gemini-nano) — ~6,144 token context window empirical measurement (MEDIUM confidence)
- [Multi-Stage Guided Code Generation (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S095219762401649X) — three-stage pipeline: plan, design (pseudocode), implement (MEDIUM confidence)
- [Phi-4 Mini Instruct on Hugging Face](https://huggingface.co/microsoft/Phi-4-mini-instruct) — 3.8B parameters, 128K context, strong reasoning, weaker on non-Python languages (HIGH confidence)
- [Building a Secure Code Sandbox — iframe + postMessage](https://medium.com/@muyiwamighty/building-a-secure-code-sandbox-what-i-learned-about-iframe-isolation-and-postmessage-a6e1c45966df) — srcdoc CSP inheritance vs blob URL isolation (MEDIUM confidence)
- [Angular DI with Abstract Classes](https://www.bennadel.com/blog/3836-using-abstract-classes-as-dependency-injection-tokens-with-providedin-semantics-in-angular-9-1-9.htm) — abstract class as DI token pattern (HIGH confidence)
- Existing codebase: `language-model.service.ts`, `model-status.component.ts`, `docs/SUMMARY.md` — empirical ground truth (HIGH confidence)

---

_Architecture research for: in-browser AI coding agent — code generation milestone_
_Researched: 2026-03-23_
