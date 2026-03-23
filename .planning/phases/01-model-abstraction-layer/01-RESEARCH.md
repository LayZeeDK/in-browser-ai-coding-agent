# Phase 1: Model Abstraction Layer - Research

**Researched:** 2026-03-24
**Domain:** Angular DI architecture, W3C LanguageModel API session management, browser detection
**Confidence:** HIGH

## Summary

Phase 1 creates an Angular DI-based abstraction over the W3C LanguageModel API. The core pattern is an abstract `ModelService` class as a lightweight injection token, with `GeminiNanoModelService` and `Phi4MiniModelService` as concrete implementations resolved by a `provideModel()` factory. An anchor session (empty system prompt) keeps the model loaded in memory to prevent cold-starts between pipeline passes. Per-pass sessions are created with named presets (`'planning'` | `'codeGen'`) that map to model-specific system prompts via `initialPrompts`.

Key research findings that affect planning: (1) `ENVIRONMENT_INITIALIZER` is deprecated since Angular v19 -- use `provideEnvironmentInitializer()` instead; (2) Angular CDK `Platform` cannot distinguish Chrome from Chromium-based Edge (both report `BLINK: true`) -- userAgent parsing for `Edg/` token is required; (3) Vitest 4.1 browser mode provides `page.getByRole()` locators natively via `@vitest/browser-playwright` -- no `vitest-browser-angular` or Testing Library needed; (4) the W3C spec states `session.destroy()` signals the browser to unload the model if no other sessions reference it, which is exactly why the anchor session pattern works.

**Primary recommendation:** Build the `@layzeedk/model` Nx library with abstract `ModelService` + `provideModel()` factory, use `provideEnvironmentInitializer()` (not the deprecated `ENVIRONMENT_INITIALIZER`), detect Edge via `navigator.userAgent.includes('Edg/')` instead of CDK `Platform`, and use Vitest `page.getByRole()` locators for accessible test queries.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- Eager initialization at app startup via `ENVIRONMENT_INITIALIZER` (background, non-blocking)
- App renders immediately; Generate button disabled until anchor is ready
- Empty system prompt on anchor session (zero token cost -- preserves full context window)
- Measure `session.contextWindow` and `session.contextUsage` on anchor creation, store as public signals (avoid `window` as variable name -- shadows global)
- Per-pass sessions also update the `contextUsage` signal (UI reflects real-time token usage)
- On failure, degrade to 'unavailable' status (no retry)
- Abstract `ModelService` class as the lightweight injection token (per Angular's "Optimizing injection tokens" guide)
- `provideModel()` function returning `EnvironmentProviders` via `makeEnvironmentProviders()` -- follows Angular's `provideRouter()`/`provideHttpClient()` convention
- `ENVIRONMENT_INITIALIZER` bundled inside `provideModel()` (single registration point -- consumers can't forget)
- No config parameter on `provideModel()` -- keep it simple
- Browser detection: check `typeof LanguageModel !== 'undefined'` first, then CDK `Platform` to distinguish Edge vs Chrome
- Named session presets: `type SessionPreset = 'planning' | 'codeGen'`
- Full `ModelSession` interface from Phase 1: `prompt()`, `promptStreaming()`, `destroy()`
- `responseConstraint` deferred to Phase 2
- Public signals: `modelName`, `status`, `isReady`, `contextWindowSize`, `contextUsage`
- Abstract class includes download lifecycle: `checkAvailability()`, `downloadModel()`
- `UnsupportedModelService` (not "Noop" -- it actively rejects, not silently ignores)
- Separate prompt files: `prompts/gemini-nano.prompts.ts` and `prompts/phi4-mini.prompts.ts`
- `@layzeedk/model` as Nx library (`libs/shared/model/`)
- Secondary entrypoint `@layzeedk/model/testing` via Nx generator
- Delete `LanguageModelService` and `ModelStatusComponent` entirely (clean break)
- Delete existing specs and e2e specs
- Full test coverage for everything added in Phase 1
- Accessible markup -- no `data-testid` attributes; use `getByRole()`, `getByText()`, accessible queries
- Temp component shows: model name, status, context window size, context usage, prompt input, submit button, response display

### Claude's Discretion

- Browser detection implementation details (CDK `Platform` usage vs alternatives)
- Warm-up/fixture integration decision (raw `LanguageModel` API vs ModelService) -- based on real model loading/unloading behavior observed during implementation
- Accessible markup pattern for temp component (research-based decision)
- Exact `ModelStatus` type values and transitions

### Deferred Ideas (OUT OF SCOPE)

- Angular AI chatbot template reference -- relevant to Phase 3 (UI patterns for prompt input, streaming display)
- `responseConstraint` support on `ModelSession` -- Phase 2 (low confidence, needs research)
- Token count estimation (`countPromptTokens()`) -- Phase 3 (UI concern)
- Temperature per preset -- Phase 3 (prompt engineering)
- Prompt versioning for measuring improvement -- Phase 3/4
- `with*()` composability pattern on `provideModel()` -- add later if needed
- `GenericModelService` for unknown Chromium browsers -- add if GeminiNano fallback proves inadequate
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                                                                                                     | Research Support                                                                                                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PIPE-05 | Model service uses Angular DI with an abstract class token and browser-specific implementations (Gemini Nano for Chrome, Phi-4 Mini for Edge)                   | Abstract class as lightweight DI token pattern (Angular docs), `provideModel()` factory with `makeEnvironmentProviders()`, userAgent-based browser detection for Chrome vs Edge Chromium                                              |
| PIPE-06 | Each model implementation has its own system prompts, temperature settings, and token budget management tuned to that model's strengths                         | `LanguageModel.create({ initialPrompts })` for system prompts, `session.contextWindow` / `session.contextUsage` for token budget, separate prompt files per model                                                                     |
| PIPE-07 | Pipeline maintains an anchor session to prevent model unload, with fresh sessions created per pass (each with its own system prompt) and destroyed individually | W3C spec confirms `destroy()` signals model unload only when no other sessions reference it; anchor session with empty system prompt holds model in memory; per-pass sessions use `initialPrompts` with preset-specific system prompt |

</phase_requirements>

## Standard Stack

### Core

| Library                      | Version | Purpose                                                                  | Why Standard                                                                             |
| ---------------------------- | ------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `@angular/core`              | ~21.2.0 | DI, signals, `makeEnvironmentProviders`, `provideEnvironmentInitializer` | Already installed; provides all DI primitives needed                                     |
| `@types/dom-chromium-ai`     | ^0.0.15 | TypeScript types for W3C LanguageModel API                               | Already installed; provides `LanguageModel`, `LanguageModelCreateOptions`, session types |
| `vitest`                     | 4.1.0   | Unit test framework with browser mode                                    | Already installed; `page.getByRole()` locators for accessible queries                    |
| `@vitest/browser-playwright` | 4.1.0   | Browser provider for Vitest                                              | Already installed; persistent context support for real browser testing                   |
| `@playwright/test`           | ^1.36.0 | E2E testing framework                                                    | Already installed; worker-scoped fixtures pattern established                            |

### Supporting

| Library       | Version | Purpose                             | When to Use                                                                          |
| ------------- | ------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| `@nx/angular` | 22.6.0  | Nx generators for Angular libraries | Use `@nx/angular:library` and `@nx/angular:library-secondary-entry-point` generators |

### Alternatives Considered

| Instead of                            | Could Use                         | Tradeoff                                                                                                                                                                                                                                         |
| ------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UserAgent parsing for Edge detection  | Angular CDK `Platform`            | CDK `Platform.BLINK` is `true` for both Chrome and Edge Chromium -- cannot distinguish them. CDK `Platform.EDGE` only detects legacy EdgeHTML. UserAgent `Edg/` token is the reliable way. **Recommendation: Do NOT install CDK just for this.** |
| `vitest-browser-angular`              | Vitest built-in `page` locators   | `vitest-browser-angular` adds `render()` + `screen` from Testing Library convention. Not needed -- existing tests use `TestBed.createComponent()` directly, and Vitest 4.1 provides `page.getByRole()` natively. Avoid the extra dependency.     |
| `ENVIRONMENT_INITIALIZER` multi token | `provideEnvironmentInitializer()` | `ENVIRONMENT_INITIALIZER` is deprecated since Angular v19. `provideEnvironmentInitializer()` is the replacement -- simpler API, supports `inject()` in callback directly. **Use the non-deprecated version.**                                    |

**Installation:**

```bash
# No new production dependencies needed -- everything is already installed
# For the Nx library generator (already installed):
npm exec nx -- g @nx/angular:library model --directory=libs/shared/model --prefix=layzeedk --skipModule
npm exec nx -- g @nx/angular:library-secondary-entry-point --library=model --name=testing
```

## Architecture Patterns

### Recommended Project Structure

```
libs/shared/model/
  src/
    index.ts                           # Barrel: ModelService, provideModel(), types
    lib/
      model.service.ts                 # Abstract ModelService class (DI token)
      model.types.ts                   # SessionPreset, ModelStatus, ModelSession
      model.providers.ts               # provideModel() factory function
      gemini-nano-model.service.ts     # Chrome implementation (internal)
      phi4-mini-model.service.ts       # Edge implementation (internal)
      unsupported-model.service.ts     # Fallback for no LanguageModel API (internal)
      prompts/
        gemini-nano.prompts.ts         # Record<SessionPreset, string> for Gemini Nano
        phi4-mini.prompts.ts           # Record<SessionPreset, string> for Phi-4 Mini
  testing/
    src/
      index.ts                         # Barrel: MockModelService, provideModelTesting()
      lib/
        mock-model.service.ts          # Mock implementation for tests
        provide-model-testing.ts       # provideModelTesting() helper
  project.json
  tsconfig.json
  tsconfig.lib.json
```

### Pattern 1: Abstract Class as Lightweight DI Token

**What:** Use an abstract class as the injection token so consumers depend on the abstraction, not the concrete implementation. The abstract class is tree-shakable-safe (small footprint) and enforces the contract.
**When to use:** When multiple implementations exist for the same interface and the correct one is resolved at startup.
**Example:**

```typescript
// Source: https://angular.dev/guide/di/lightweight-injection-tokens
// model.service.ts
export abstract class ModelService {
  abstract readonly modelName: Signal<string>;
  abstract readonly status: Signal<ModelStatus>;
  abstract readonly isReady: Signal<boolean>;
  abstract readonly contextWindowSize: Signal<number>;
  abstract readonly contextUsage: Signal<number>;

  abstract checkAvailability(): Promise<ModelAvailability>;
  abstract downloadModel(onProgress?: (loaded: number, total: number) => void): Promise<void>;
  abstract createSession(preset: SessionPreset): Promise<ModelSession>;
}
```

### Pattern 2: provideModel() Factory with provideEnvironmentInitializer

**What:** A `provideModel()` function that resolves the correct `ModelService` implementation based on browser detection and registers an environment initializer for anchor session creation.
**When to use:** In `app.config.ts` alongside `provideRouter()`.
**Example:**

```typescript
// Source: https://angular.dev/api/core/makeEnvironmentProviders
// model.providers.ts
import { makeEnvironmentProviders, provideEnvironmentInitializer, inject } from '@angular/core';
import { ModelService } from './model.service';

function resolveModelService(): typeof ModelService {
  if (typeof LanguageModel === 'undefined') {
    return UnsupportedModelService;
  }

  // Edge Chromium includes 'Edg/' in userAgent; Chrome does not
  if (navigator.userAgent.includes('Edg/')) {
    return Phi4MiniModelService;
  }

  // Chrome, Opera, or unknown Chromium with LanguageModel API
  return GeminiNanoModelService;
}

export function provideModel(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: ModelService, useClass: resolveModelService() },
    provideEnvironmentInitializer(() => {
      // Runs in injection context -- inject() works here
      const model = inject(ModelService);
      model.initialize(); // Creates anchor session (non-blocking)
    }),
  ]);
}
```

### Pattern 3: Anchor Session for Cold-Start Prevention

**What:** A persistent session with empty `initialPrompts` (no system prompt) that holds the model in memory. The anchor is never destroyed while the app is open. Per-pass sessions are created and destroyed independently.
**When to use:** Always -- the anchor session is created at app startup.
**Example:**

```typescript
// Source: https://developer.chrome.com/docs/ai/session-management
// Inside concrete ModelService implementation
async initialize(): Promise<void> {
  try {
    this.#status.set('initializing');
    this.#anchorSession = await LanguageModel.create();
    // Empty initialPrompts = zero token cost for system prompt
    this.#contextWindowSize.set(this.#anchorSession.contextWindow);
    this.#contextUsage.set(this.#anchorSession.contextUsage);
    this.#status.set('ready');
  } catch {
    this.#status.set('unavailable');
  }
}
```

### Pattern 4: Per-Pass Sessions with Named Presets

**What:** Each pipeline pass creates a fresh session with its own system prompt via `initialPrompts`. The session is destroyed after the pass completes, but the anchor session keeps the model loaded.
**When to use:** In Phase 2 pipeline, but the infrastructure is built in Phase 1.
**Example:**

```typescript
// Source: https://github.com/webmachinelearning/prompt-api
async createSession(preset: SessionPreset): Promise<ModelSession> {
  const systemPrompt = this.prompts[preset];
  const session = await LanguageModel.create({
    initialPrompts: [{ role: 'system', content: systemPrompt }],
  });
  // Update contextUsage signal from new session
  this.#contextUsage.set(session.contextUsage);

  return {
    prompt: (input: string) => session.prompt(input),
    promptStreaming: (input: string) => session.promptStreaming(input),
    destroy: () => {
      session.destroy();
      // Re-read anchor session's contextUsage after pass session is destroyed
      if (this.#anchorSession) {
        this.#contextUsage.set(this.#anchorSession.contextUsage);
      }
    },
  };
}
```

### Pattern 5: Vitest page Locators for Accessible Testing

**What:** Use Vitest 4.1 built-in `page.getByRole()`, `page.getByText()` locators instead of `data-testid` attributes or manual DOM queries.
**When to use:** All new unit tests for the temp component (and all future component tests).
**Example:**

```typescript
// Source: https://vitest.dev/api/browser/locators
import { page, expect } from '@vitest/browser/context';

it('should display model name', async () => {
  // Uses accessible queries -- no data-testid
  await expect.element(page.getByRole('heading', { name: /model/i })).toBeVisible();
});

it('should disable submit when model not ready', async () => {
  await expect.element(page.getByRole('button', { name: /send|generate/i })).toBeDisabled();
});
```

### Anti-Patterns to Avoid

- **Injecting concrete implementations directly:** Always inject `ModelService` (abstract), never `GeminiNanoModelService` or `Phi4MiniModelService`. Concrete classes are internal to the library.
- **Using `providedIn: 'root'` on abstract ModelService:** The factory pattern via `provideModel()` replaces tree-shakable root registration. `providedIn: 'root'` would bypass the factory.
- **Destroying the anchor session prematurely:** Per the W3C spec, `session.destroy()` signals the browser to unload the model from memory if no other sessions reference it. Never call `destroy()` on the anchor.
- **Using `clone()` for per-pass sessions:** Cloning copies the session history, which is not desired -- each pass needs a fresh context with only its system prompt. Use `LanguageModel.create()` with `initialPrompts` instead.
- **Using `ENVIRONMENT_INITIALIZER` (deprecated):** Use `provideEnvironmentInitializer()` instead. The old multi-token pattern is deprecated since Angular v19.
- **Using Angular CDK `Platform` for browser detection:** `Platform.BLINK` is `true` for both Chrome and Edge Chromium. Use userAgent `Edg/` check instead.
- **Using `data-testid` attributes:** Use semantic queries (`getByRole`, `getByText`, `getByLabelText`) for accessible, user-centric tests.

## Don't Hand-Roll

| Problem                               | Don't Build                              | Use Instead                                                                    | Why                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser detection (Chrome vs Edge)    | Complex UA parser library                | `navigator.userAgent.includes('Edg/')`                                         | Simple, reliable -- Edge Chromium always includes `Edg/` token. No library needed for a two-branch check.                                            |
| DI factory with initialization        | Custom bootstrap logic                   | `makeEnvironmentProviders()` + `provideEnvironmentInitializer()`               | Angular's built-in pattern handles injection context, environment scoping, and initialization ordering correctly.                                    |
| Nx library structure                  | Manual folder + tsconfig setup           | `@nx/angular:library` + `@nx/angular:library-secondary-entry-point` generators | Generators create project.json, tsconfig references, path mappings in tsconfig.base.json, and ng-package.json (for secondary entrypoints) correctly. |
| Accessible component queries in tests | Custom `waitForElement()` with selectors | Vitest `page.getByRole()` / `expect.element()`                                 | Built-in retry logic, auto-waiting, accessible by default. The existing `waitForElement()` helper in specs is replaced.                              |

**Key insight:** This phase is primarily an architecture/DI exercise. The W3C LanguageModel API provides the session management primitives directly. The complexity is in Angular DI wiring, not in the AI/model layer.

## Common Pitfalls

### Pitfall 1: ENVIRONMENT_INITIALIZER is Deprecated

**What goes wrong:** Using the `ENVIRONMENT_INITIALIZER` multi-token pattern produces deprecation warnings and will break in future Angular versions.
**Why it happens:** The CONTEXT.md references `ENVIRONMENT_INITIALIZER` because it was the standard in Angular 14-18. Angular 19+ deprecated it in favor of `provideEnvironmentInitializer()`.
**How to avoid:** Use `provideEnvironmentInitializer(() => { ... })` inside `makeEnvironmentProviders()`. The callback has injection context, so `inject()` works directly.
**Warning signs:** TypeScript deprecation strikethrough on `ENVIRONMENT_INITIALIZER` import.

### Pitfall 2: CDK Platform Cannot Distinguish Chrome from Edge Chromium

**What goes wrong:** Both Chrome and Edge Chromium set `Platform.BLINK = true` and `Platform.EDGE = false` (EDGE only detects legacy EdgeHTML). Using CDK for browser detection always resolves to the same implementation.
**Why it happens:** CDK detects rendering engines, not specific browsers. Modern Edge uses Blink.
**How to avoid:** Check `navigator.userAgent.includes('Edg/')` -- Edge Chromium always includes the `Edg/` token (note: `Edg`, not `Edge`, to avoid legacy EdgeHTML confusion).
**Warning signs:** Both browsers getting `GeminiNanoModelService` when `Platform` is used for detection.

### Pitfall 3: Destroying Anchor Session Unloads the Model

**What goes wrong:** If the anchor session is accidentally destroyed (e.g., in a cleanup handler), and no other sessions exist, the browser unloads the model from memory. The next `LanguageModel.create()` triggers a cold-start (11+ minutes on ARM64 CI).
**Why it happens:** Per the W3C Prompt API spec: "destroying a session signals the browser to unload the model from memory if no other sessions reference it."
**How to avoid:** The anchor session is stored as a private field and never exposed. No `destroy()` is ever called on it. Only per-pass sessions are destroyed.
**Warning signs:** Cold-start delays between consecutive pipeline passes.

### Pitfall 4: System Prompt Must Be First in initialPrompts

**What goes wrong:** Placing a `{ role: 'system' }` message anywhere other than index 0 in `initialPrompts` rejects with a `TypeError`.
**Why it happens:** The W3C spec enforces system prompt position: "Placing the { role: 'system' } prompt anywhere besides at the 0th position in initialPrompts will reject with a TypeError."
**How to avoid:** Always structure `initialPrompts` as `[{ role: 'system', content: '...' }, ...otherMessages]` or omit system prompt entirely.
**Warning signs:** `TypeError` during `LanguageModel.create()`.

### Pitfall 5: provideModel() Resolution Happens at Import Time

**What goes wrong:** The `resolveModelService()` function runs when `provideModel()` is called (at module evaluation time / app bootstrap). If the browser detection logic is async or needs DOM-ready state, it fails.
**Why it happens:** `makeEnvironmentProviders()` is a synchronous call. The `useClass` value must be determined synchronously.
**How to avoid:** Browser detection via `typeof LanguageModel` and `navigator.userAgent.includes('Edg/')` are both synchronous and available immediately. No async needed.
**Warning signs:** `undefined` or incorrect service class selection.

### Pitfall 6: promptStreaming() Returns Cumulative Chunks

**What goes wrong:** Concatenating streaming chunks produces duplicated text (e.g., "HelloHello worldHello world!").
**Why it happens:** Per the STATE.md accumulated context: "promptStreaming() is cumulative -- assign directly to signal, never concatenate." Each chunk from the stream contains the full response so far, not just the delta.
**How to avoid:** Assign each chunk directly to the response signal: `response.set(chunk)`, not `response.update(prev => prev + chunk)`.
**Warning signs:** Doubled/tripled text in streaming responses.

### Pitfall 7: Test Warm-Up Must Bypass ModelService

**What goes wrong:** Attempting to use `ModelService` in the Vitest `browser-warmup.ts` setupFile fails because Angular has not bootstrapped yet.
**Why it happens:** `browser-warmup.ts` runs before Angular loads (it is a Vitest setupFile, not an Angular service). The existing warm-up uses raw `LanguageModel.create()` + `session.prompt('warmup')`.
**How to avoid:** Keep test warm-up using raw `LanguageModel` API. The warm-up is test infrastructure, not application code. ModelService is only used in Angular's runtime context.
**Warning signs:** Errors about missing Angular injector in setupFiles.

### Pitfall 8: Secondary Entrypoint Requires ng-package.json for Publishable Libraries

**What goes wrong:** The `@nx/angular:library-secondary-entry-point` generator may create `ng-package.json` files for publishable libraries. Since `@layzeedk/model` is a buildable/non-publishable library, the generator behavior depends on the library type.
**Why it happens:** The generator checks whether the parent library is publishable or buildable.
**How to avoid:** Check the library's `project.json` after generation. For non-publishable libraries, the secondary entrypoint is typically managed via `tsconfig.base.json` path mappings only (e.g., `@layzeedk/model/testing` -> `libs/shared/model/testing/src/index.ts`).
**Warning signs:** Build errors about missing `ng-package.json` or incorrect path resolution.

## Code Examples

Verified patterns from official sources:

### Browser Detection (Edge vs Chrome)

```typescript
// Source: https://learn.microsoft.com/en-us/microsoft-edge/web-platform/user-agent-guidance
function detectBrowser(): 'edge' | 'chrome' | 'unknown-chromium' {
  const ua = navigator.userAgent;

  if (ua.includes('Edg/')) {
    return 'edge';
  }

  if (ua.includes('Chrome/') && !ua.includes('OPR/')) {
    return 'chrome';
  }

  return 'unknown-chromium';
}
```

### provideModel() with provideEnvironmentInitializer

```typescript
// Source: https://angular.dev/api/core/makeEnvironmentProviders
// Source: https://angular.dev/api/core/provideEnvironmentInitializer
import { EnvironmentProviders, inject, makeEnvironmentProviders, provideEnvironmentInitializer } from '@angular/core';
import { ModelService } from './model.service';
import { GeminiNanoModelService } from './gemini-nano-model.service';
import { Phi4MiniModelService } from './phi4-mini-model.service';
import { UnsupportedModelService } from './unsupported-model.service';

export function provideModel(): EnvironmentProviders {
  const impl = resolveModelServiceImpl();

  return makeEnvironmentProviders([
    { provide: ModelService, useClass: impl },
    provideEnvironmentInitializer(() => {
      inject(ModelService).initialize();
    }),
  ]);
}

function resolveModelServiceImpl(): typeof GeminiNanoModelService | typeof Phi4MiniModelService | typeof UnsupportedModelService {
  if (typeof LanguageModel === 'undefined') {
    return UnsupportedModelService;
  }

  if (navigator.userAgent.includes('Edg/')) {
    return Phi4MiniModelService;
  }

  return GeminiNanoModelService;
}
```

### Session Creation with System Prompt

```typescript
// Source: https://github.com/webmachinelearning/prompt-api
const session = await LanguageModel.create({
  initialPrompts: [{ role: 'system', content: 'You are a code generation assistant. Output only valid HTML.' }],
});

// Read token budget info
const totalTokens = session.contextWindow; // e.g., 6144 for Gemini Nano
const usedTokens = session.contextUsage; // tokens consumed by system prompt + history
const remaining = totalTokens - usedTokens;
```

### MockModelService for Testing

```typescript
// libs/shared/model/testing/src/lib/mock-model.service.ts
import { signal } from '@angular/core';
import { ModelService } from '@layzeedk/model';
import type { ModelSession, ModelStatus, SessionPreset } from '@layzeedk/model';

export class MockModelService extends ModelService {
  readonly modelName = signal('mock');
  readonly status = signal<ModelStatus>('ready');
  readonly isReady = signal(true);
  readonly contextWindowSize = signal(4096);
  readonly contextUsage = signal(0);

  #lastPromptResponse = 'Mock response';

  /** Configure what prompt() returns in tests. */
  setPromptResponse(response: string): void {
    this.#lastPromptResponse = response;
  }

  async checkAvailability() {
    return 'available' as const;
  }

  async downloadModel() {
    // no-op
  }

  async initialize() {
    // no-op -- already "ready"
  }

  async createSession(_preset: SessionPreset): Promise<ModelSession> {
    const response = this.#lastPromptResponse;

    return {
      prompt: async () => response,
      promptStreaming: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(response);
            controller.close();
          },
        }),
      destroy: () => undefined,
    };
  }
}
```

### provideModelTesting() Helper

```typescript
// libs/shared/model/testing/src/lib/provide-model-testing.ts
import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { ModelService } from '@layzeedk/model';
import { MockModelService } from './mock-model.service';

export function provideModelTesting(): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: ModelService, useClass: MockModelService }]);
}
```

### Temp Component with Accessible Markup

```typescript
// Accessible markup pattern for temp component (Phase 1 only)
@Component({
  selector: 'app-model-info',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="AI Model Status">
      <h2>On-Device AI Model</h2>

      <dl>
        <dt>Model</dt>
        <dd>{{ model.modelName() }}</dd>
        <dt>Status</dt>
        <dd>{{ model.status() }}</dd>
        <dt>Context Window</dt>
        <dd>{{ model.contextWindowSize() }} tokens</dd>
        <dt>Context Used</dt>
        <dd>{{ model.contextUsage() }} tokens</dd>
      </dl>

      @if (model.status() === 'downloadable') {
        <button (click)="onDownload()">Download Model</button>
      }

      @if (model.isReady()) {
        <form (submit)="onSubmit($event)">
          <label for="prompt-input">Prompt</label>
          <textarea id="prompt-input" [value]="promptText()" (input)="promptText.set($any($event.target).value)" placeholder="Describe what you want..."></textarea>
          <button type="submit" [disabled]="!model.isReady() || prompting()">Send</button>
        </form>
      } @else if (model.status() === 'unsupported') {
        <p role="alert">This browser does not support on-device AI models. Please use Chrome Beta or Edge Dev.</p>
      }

      @if (prompting()) {
        <p aria-live="polite">Generating response...</p>
      }

      @if (response()) {
        <section aria-label="AI Response">
          <p>{{ response() }}</p>
        </section>
      }
    </section>
  `,
})
export class ModelInfoComponent {
  // inject(ModelService) -- abstract class token
}
```

### Vitest Test Using page Locators

```typescript
// Source: https://vitest.dev/api/browser/locators
import { page, expect as vitestExpect } from '@vitest/browser/context';
import { describe, it, beforeEach } from 'vitest';

describe('ModelInfoComponent', () => {
  beforeEach(async () => {
    // TestBed setup with provideModelTesting()
  });

  it('should show model name', async () => {
    // Create fixture, trigger change detection...
    await vitestExpect
      .element(
        page.getByRole('definition'), // <dd> elements
      )
      .toBeVisible();
  });

  it('should show send button when ready', async () => {
    await vitestExpect.element(page.getByRole('button', { name: /send/i })).toBeEnabled();
  });

  it('should show unsupported message', async () => {
    // Configure MockModelService status to 'unsupported'
    await vitestExpect.element(page.getByRole('alert')).toHaveTextContent(/does not support/i);
  });
});
```

## State of the Art

| Old Approach                                 | Current Approach                                     | When Changed                 | Impact                                                                  |
| -------------------------------------------- | ---------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `ENVIRONMENT_INITIALIZER` multi token        | `provideEnvironmentInitializer()`                    | Angular v19 (Nov 2024)       | Simpler API, `inject()` works in callback, no `multi: true` boilerplate |
| `inputQuota` / `inputUsage` on LanguageModel | `contextWindow` / `contextUsage`                     | W3C Prompt API rename (2025) | Old names deprecated in extensions, removed in web contexts             |
| `measureInputUsage()`                        | `measureContextUsage()`                              | W3C Prompt API rename (2025) | Same rename as above                                                    |
| `onquotaoverflow` event                      | `oncontextoverflow` event                            | W3C Prompt API rename (2025) | Same rename as above                                                    |
| `data-testid` attributes for test queries    | `page.getByRole()` / `page.getByText()` (Vitest 4.x) | Vitest 2.1+ (2024)           | Accessible queries, auto-retry, no DOM coupling                         |
| Testing Library `screen.getByRole()`         | Vitest `page.getByRole()`                            | Vitest 2.2+ (2025)           | Same API surface but integrated into Vitest, no extra dependency        |

**Deprecated/outdated:**

- `ENVIRONMENT_INITIALIZER`: Deprecated since Angular v19. Use `provideEnvironmentInitializer()`.
- `LanguageModel.params()`: Deprecated -- restricted to web extension contexts only.
- `session.topK` / `session.temperature`: Deprecated -- restricted to web extension contexts only.
- `inputQuota` / `inputUsage` / `measureInputUsage()` / `onquotaoverflow`: Deprecated -- use `contextWindow` / `contextUsage` / `measureContextUsage()` / `oncontextoverflow`.

## Open Questions

1. **Anchor session token cost on Gemini Nano**
   - What we know: Gemini Nano has a 6K token context window. An empty system prompt (no `initialPrompts`) should have near-zero token cost.
   - What's unclear: The exact `contextUsage` value reported for an anchor session with no `initialPrompts`. STATE.md flags this as a concern.
   - Recommendation: Measure `session.contextUsage` on anchor creation during development. If non-zero, document the baseline cost. This is an implementation-time measurement, not a blocking question.

2. **`provideEnvironmentInitializer` compatibility with user's CONTEXT.md decision**
   - What we know: CONTEXT.md locks "ENVIRONMENT_INITIALIZER bundled inside provideModel()". Research shows `ENVIRONMENT_INITIALIZER` is deprecated since Angular v19. The project uses Angular 21.
   - What's unclear: Whether the user explicitly wants the deprecated token or the pattern (environment initialization at startup).
   - Recommendation: Use `provideEnvironmentInitializer()` (the current API) to implement the same pattern. This fulfills the user's intent (eager non-blocking initialization inside `provideModel()`) with the non-deprecated API. Flag this upgrade in the plan.

3. **CDK `Platform` vs userAgent parsing -- user decision conflict**
   - What we know: CONTEXT.md says "CDK `Platform` to distinguish Edge vs Chrome." Research proves CDK cannot distinguish them. The user also listed "Browser detection implementation details" as Claude's Discretion.
   - What's unclear: Whether CDK should still be installed for other reasons (e.g., future phases).
   - Recommendation: Do NOT install CDK. Use `navigator.userAgent.includes('Edg/')` for detection. The user explicitly granted discretion on browser detection implementation details. This is the correct technical choice.

4. **Vitest `page` locators vs TestBed component creation**
   - What we know: Existing tests use `TestBed.createComponent()` + manual DOM queries. CONTEXT.md requires accessible queries (no `data-testid`). Vitest 4.1 provides `page.getByRole()` locators.
   - What's unclear: Whether `page` locators work seamlessly with `TestBed.createComponent()` or require a different rendering approach (e.g., `vitest-browser-angular` `render()`).
   - Recommendation: Test both approaches during implementation. `page` locators query `document.body`, so they should find elements rendered by `TestBed`. If not, fall back to `TestBed` fixture's `nativeElement.querySelector()` with ARIA role selectors like `[role="alert"]` or semantic elements (`button`, `heading`). The requirement is "no data-testid", not "must use page locators".

## Validation Architecture

### Test Framework

| Property           | Value                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Framework          | Vitest 4.1 (browser mode) + Playwright 1.36+ (E2E)                                                                  |
| Config file        | `apps/in-browser-ai-coding-agent/vitest.config.mts` (default), `vitest.config.chrome.mts`, `vitest.config.edge.mts` |
| Quick run command  | `npm exec nx -- test in-browser-ai-coding-agent`                                                                    |
| Full suite command | `npm exec nx -- run-many -t test lint typecheck && npm exec nx -- run-many -t e2e`                                  |

### Phase Requirements -> Test Map

| Req ID  | Behavior                                               | Test Type          | Automated Command                                       | File Exists? |
| ------- | ------------------------------------------------------ | ------------------ | ------------------------------------------------------- | ------------ |
| PIPE-05 | Factory resolves correct implementation per browser    | unit (integration) | `npm exec nx -- test in-browser-ai-coding-agent`        | No -- Wave 0 |
| PIPE-05 | Abstract ModelService injectable via DI                | unit               | `npm exec nx -- test in-browser-ai-coding-agent`        | No -- Wave 0 |
| PIPE-05 | MockModelService usable in downstream tests            | unit               | `npm exec nx -- test in-browser-ai-coding-agent`        | No -- Wave 0 |
| PIPE-06 | Each implementation has model-specific prompts         | unit               | `npm exec nx -- test in-browser-ai-coding-agent`        | No -- Wave 0 |
| PIPE-06 | contextWindow and contextUsage signals populated       | unit (real model)  | `npm exec nx -- test-chrome in-browser-ai-coding-agent` | No -- Wave 0 |
| PIPE-07 | Anchor session created at startup                      | unit (real model)  | `npm exec nx -- test-chrome in-browser-ai-coding-agent` | No -- Wave 0 |
| PIPE-07 | Per-pass sessions created/destroyed without cold-start | unit (real model)  | `npm exec nx -- test-chrome in-browser-ai-coding-agent` | No -- Wave 0 |
| PIPE-07 | Temp component displays model info and accepts prompt  | e2e                | `npm exec nx -- e2e in-browser-ai-coding-agent-e2e`     | No -- Wave 0 |

### Sampling Rate

- **Per task commit:** `npm exec nx -- test in-browser-ai-coding-agent` (mock tests, fast)
- **Per wave merge:** `npm exec nx -- run-many -t test lint typecheck`
- **Phase gate:** Full suite green including e2e before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `libs/shared/model/` -- entire library (Wave 0 creates the Nx library via generator)
- [ ] `libs/shared/model/testing/` -- secondary entrypoint with MockModelService
- [ ] Unit test files for ModelService implementations, factory, provider
- [ ] E2E test files `model-info.spec.ts` and `model-prompt.spec.ts` (replacing deleted specs)
- [ ] `tsconfig.base.json` path mappings for `@layzeedk/model` and `@layzeedk/model/testing` (generator adds these)

## Sources

### Primary (HIGH confidence)

- [@types/dom-chromium-ai v0.0.15](D:\projects\github\LayZeeDK\in-browser-ai-coding-agent\node_modules@types\dom-chromium-ai\index.d.ts) - Full LanguageModel API type surface verified locally: `contextWindow`, `contextUsage`, `initialPrompts`, `promptStreaming()`, `clone()`, `destroy()`
- [Angular makeEnvironmentProviders docs](https://angular.dev/api/core/makeEnvironmentProviders) - Factory pattern for EnvironmentProviders
- [Angular provideEnvironmentInitializer docs](https://angular.dev/api/core/provideEnvironmentInitializer) - Non-deprecated replacement for ENVIRONMENT_INITIALIZER
- [Angular Lightweight Injection Tokens guide](https://angular.dev/guide/di/lightweight-injection-tokens) - Abstract class as DI token pattern
- [W3C Prompt API spec (GitHub)](https://github.com/webmachinelearning/prompt-api) - Session creation, initialPrompts, contextWindow/contextUsage, destroy() behavior
- [Chrome Developers: Session Management](https://developer.chrome.com/docs/ai/session-management) - Anchor session pattern, model unload on destroy
- [Angular CDK Platform source (GitHub)](https://github.com/angular/components/blob/main/src/cdk/platform/platform.ts) - Verified BLINK detection cannot distinguish Chrome from Edge Chromium
- [Microsoft Edge UA guidance](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/user-agent-guidance) - `Edg/` token in userAgent for Edge Chromium detection
- [Vitest Locators docs](https://vitest.dev/api/browser/locators) - `page.getByRole()`, `page.getByText()` API
- [Nx library-secondary-entry-point generator](https://nx.dev/nx-api/angular/generators/library-secondary-entry-point) - Generator for `@layzeedk/model/testing`

### Secondary (MEDIUM confidence)

- [Angular Architects: Patterns for Custom Standalone APIs](https://www.angulararchitects.io/en/blog/patterns-for-custom-standalone-apis-in-angular/) - Verified provideModel() + makeEnvironmentProviders pattern
- [Ninja Squad: Angular tests with Vitest browser mode](https://blog.ninja-squad.com/2025/11/18/angular-tests-with-vitest-browser-mode) - Vitest 4.x + Angular 21 testing patterns
- [Marmicode: Migrate to Vitest Browser Mode](https://cookbook.marmicode.io/angular/testing/how-to-migrate-to-vitest-browser-mode) - Testing Library to Vitest page locator migration

### Tertiary (LOW confidence)

- None -- all findings verified with primary or secondary sources

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - all libraries already installed, versions verified from package.json
- Architecture: HIGH - DI patterns verified against Angular 21 docs, LanguageModel API verified against installed types
- Pitfalls: HIGH - CDK Platform limitation verified from source code, ENVIRONMENT_INITIALIZER deprecation verified from Angular docs, promptStreaming behavior documented in STATE.md accumulated context
- Browser detection: HIGH - Microsoft's own documentation confirms `Edg/` token, CDK source code confirms BLINK-only detection
- Testing: MEDIUM - Vitest page locators verified in docs, but integration with TestBed.createComponent() not yet tested in practice

**Research date:** 2026-03-24
**Valid until:** 2026-04-24 (30 days -- Angular 21 and Vitest 4.1 are stable releases)
