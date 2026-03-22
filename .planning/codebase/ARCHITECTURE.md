# Architecture

**Analysis Date:** 2026-03-22

## Pattern Overview

**Overall:** Angular Single Page Application (SPA) with persistent browser contexts for real on-device AI model inference

**Key Characteristics:**

- Standalone Angular 21 components (no modules)
- W3C LanguageModel API for in-browser AI inference
- Dual-browser testing: Chrome Beta (Gemini Nano) and Edge Dev (Phi-4 Mini)
- Persistent browser profiles for multi-gigabyte model caching
- Monorepo with Nx orchestration

## Layers

**Presentation (UI):**

- Purpose: User interface for model status and prompt interaction
- Location: `apps/in-browser-ai-coding-agent/src/app/`
- Contains: Angular components with standalone decorator, templates, and styles
- Depends on: LanguageModelService, Angular core modules
- Used by: HTML template in `index.html`, e2e tests

**Service (Domain Logic):**

- Purpose: Wrapper around W3C LanguageModel API, handles model availability and inference
- Location: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`
- Contains: `LanguageModelService` singleton injectable providing type-safe API access
- Depends on: W3C LanguageModel global API (browser-provided)
- Used by: `ModelStatusComponent`

**Test Infrastructure:**

- Purpose: E2E tests with persistent contexts, unit tests in-browser, warm-up fixtures
- Location: `apps/in-browser-ai-coding-agent-e2e/` (e2e) and `apps/in-browser-ai-coding-agent/` (unit)
- Contains: Playwright tests, Vitest configuration, global setup, fixtures
- Depends on: Playwright, Vitest, custom fixture helpers
- Used by: CI pipeline, developers running tests locally

## Data Flow

**Model Availability Check:**

1. Component initializes (`ngOnInit`)
2. Calls `service.checkAvailability()`
3. Service checks if `LanguageModel` global is defined
4. Calls `await LanguageModel.availability()` (browser API)
5. Returns status: `'available' | 'downloading' | 'downloadable' | 'unavailable'`
6. Component updates signal state and polls while status is `'downloading'`

**Model Download:**

1. User clicks "Download Model" button
2. Component calls `service.downloadModel(onProgress)`
3. Service calls `await LanguageModel.create({ monitor: ... })`
4. Monitor callback triggered on `downloadprogress` events
5. Callback updates component signal with percentage
6. Session destroyed after download completes

**Prompt Inference:**

1. User enters prompt text and clicks "Send"
2. Component calls `service.prompt(text)`
3. Service launches new session: `const session = await LanguageModel.create()`
4. Service calls `await session.prompt(text)` (real inference)
5. Response returned and displayed (parsed as Markdown)
6. Session destroyed in finally block

**State Management:**

- Signals used for reactive state: `loading`, `availability`, `downloading`, `downloadProgress`, `prompting`, `response`, `error`
- Computed signal for HTML rendering: `responseHtml` (Markdown → HTML via `marked` library)
- No global state store; component-local signals only

## Key Abstractions

**LanguageModelService:**

- Purpose: Single point of API abstraction for W3C LanguageModel
- Examples: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`
- Pattern: Singleton injectable with methods `checkAvailability()`, `downloadModel()`, `prompt()`
- Type Safety: Exported `ModelAvailability` type union

**ModelStatusComponent:**

- Purpose: Complete UI for model interaction (status display, download, prompt/response)
- Examples: `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts`
- Pattern: Standalone component with template, styles, and child component composition
- Signals: `loading`, `availability`, `downloading`, `downloadProgress`, `promptText`, `prompting`, `response`, `error`

**Persistent Browser Context:**

- Purpose: Single long-lived browser process for model warm-up and testing
- Examples: `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (worker-scoped)
- Pattern: Playwright test fixture, worker-scoped, launches once and reused by all tests in worker

## Entry Points

**Bootstrap (Browser):**

- Location: `apps/in-browser-ai-coding-agent/src/main.ts`
- Triggers: Browser page load
- Responsibilities: Calls `bootstrapApplication(App, appConfig)` to start the Angular app

**Application Root:**

- Location: `apps/in-browser-ai-coding-agent/src/app/app.ts`
- Triggers: Angular bootstrap
- Responsibilities: Renders root component with `ModelStatusComponent` as child

**E2E Test Suite:**

- Location: `apps/in-browser-ai-coding-agent-e2e/src/*.spec.ts`
- Triggers: `npm exec nx -- e2e in-browser-ai-coding-agent-e2e` or CI e2e step
- Responsibilities: Browser automation tests using Playwright fixture

**Unit Test Suite:**

- Location: `apps/in-browser-ai-coding-agent/src/app/*.spec.ts`
- Triggers: `npm exec nx -- test in-browser-ai-coding-agent` or CI unit test step
- Responsibilities: Component and service tests via Vitest in-browser

**Global Setup (Unit Tests):**

- Location: `apps/in-browser-ai-coding-agent/global-setup.ts`
- Triggers: Before Vitest browser mode launches (runs in Node.js)
- Responsibilities: Warm-up model by navigating to on-device-internals, calling `LanguageModel.create()`, running warmup prompt, waiting for "Ready" state

## Error Handling

**Strategy:** Try-finally pattern with explicit error catch and relay to UI

**Patterns:**

- Service methods check `isApiSupported` before using LanguageModel API; throw descriptive error if not
- Service `prompt()` catches errors in try-finally block; error message relayed to component signal
- Component catches service errors in try-finally; updates error signal with `e instanceof Error ? e.message : String(e)`
- Test fixtures catch exceptions and log diagnostics; some errors are non-fatal (e.g., Model Status tab not found in container)

**No throw-to-caller:** Errors are caught locally and exposed via signals/console logs. No unhandled rejections.

## Cross-Cutting Concerns

**Logging:**

- Approach: `console.log()` and `console.warn()` for diagnostics
- Patterns in E2E: Logs prefixed with `[fixtures]` for fixture operations, `[global-setup]` for setup
- Patterns in Component: Uses standard `console.log()` for prompt responses (for CI summary capture)

**Validation:**

- Approach: Type-based (TypeScript) and runtime guards (`isApiSupported` check)
- No explicit schema validation; LanguageModel API returns typed values
- Component validation: Trim and check prompt text not empty before submission

**Browser Compatibility:**

- Approach: Feature detection via `typeof LanguageModel !== 'undefined'`
- Graceful degradation: Returns `'unavailable'` status instead of throwing
- Tests skip on unsupported browsers: Model availability guard test (`should have a model...`) fails with diagnostic message

**Performance Considerations:**

- Model warm-up front-loaded: First inference takes 11+ minutes on ARM; subsequent inferences cached
- Persistent profiles: Model weights and ONNX Runtime artifacts cached across CI runs
- No re-renders during inference: Async operations use signals, not observables
- Test isolation: Each prompt test creates and destroys a session; no shared session state

---

_Architecture analysis: 2026-03-22_
