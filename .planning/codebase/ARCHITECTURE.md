# Architecture

**Analysis Date:** 2026-03-23

## Pattern Overview

**Overall:** Single-page application (SPA) with layered service-driven architecture using Angular 21.

**Key Characteristics:**

- Standalone Angular components with signal-based reactivity
- W3C LanguageModel API wrapper service for on-device AI inference
- Browser-agnostic API abstraction supporting Chrome Beta (Gemini Nano) and Edge Dev (Phi-4 Mini)
- Multi-platform testing with persistent browser contexts and model warm-up

## Layers

**Presentation Layer:**

- Purpose: Render UI and handle user interactions
- Location: `apps/in-browser-ai-coding-agent/src/app/`
- Contains: Angular components (standalone), templates, and styles
- Depends on: Services (LanguageModelService), DomSanitizer
- Used by: Root component bootstrap

**Service Layer:**

- Purpose: Encapsulate business logic and API interactions
- Location: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`
- Contains: LanguageModelService with model availability checks, downloads, and inference
- Depends on: W3C LanguageModel API (global)
- Used by: Components (ModelStatusComponent)

**Configuration & Bootstrap Layer:**

- Purpose: Initialize application state and routing
- Location: `apps/in-browser-ai-coding-agent/src/app/app.config.ts`, `apps/in-browser-ai-coding-agent/src/app/app.routes.ts`
- Contains: ApplicationConfig with providers, empty route definitions
- Depends on: Angular core providers
- Used by: Root bootstrap in `main.ts`

**Shared Infrastructure Layer:**

- Purpose: Provide cross-cutting browser configuration
- Location: `libs/shared/browser-profiles/src/lib/browser-profiles.ts`
- Contains: Profile definitions (Chrome, Edge), flag seeding, launch options
- Depends on: Node.js fs, @nx/devkit workspaceRoot
- Used by: E2E fixtures, Vitest global setup, unit test configuration

**Testing Support Layer:**

- Purpose: Warm up models and provide test fixtures
- Location: `apps/in-browser-ai-coding-agent/browser-warmup.ts`, `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts`, `apps/in-browser-ai-coding-agent/global-setup.shared.ts`
- Contains: Model warm-up routines, persistent context fixtures, profile seeding
- Depends on: W3C LanguageModel API, Playwright, browser-profiles lib
- Used by: Vitest (setupFiles), Playwright E2E tests

## Data Flow

**Model Availability Check:**

1. Component initialization (ngOnInit) calls `LanguageModelService.checkAvailability()`
2. Service checks if `LanguageModel` API is globally defined
3. Service calls `LanguageModel.availability()` which returns status: available | downloading | downloadable | unavailable
4. Component receives status and displays appropriate UI
5. If downloading, component polls every 2 seconds until available
6. User downloads model via `onDownload()` which calls `downloadModel()` with progress callback

**Inference Flow:**

1. User submits prompt in `ModelStatusComponent.onSubmit()`
2. Component calls `LanguageModelService.prompt(text)`
3. Service creates a new LanguageModel session via `LanguageModel.create()`
4. Service calls `session.prompt(text)` to get response
5. Service destroys session in finally block
6. Component receives response, parses as markdown via `marked.parse()`, sanitizes HTML, displays

**State Management:**

- Local component state using Angular signals (`signal()`)
- Derived state using `computed()` for formatted HTML output
- No global state management — all state is component-scoped
- Signal updates via `set()` and `update()` methods

## Key Abstractions

**LanguageModelService:**

- Purpose: Abstract W3C LanguageModel API specifics from components
- Examples: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`
- Pattern: Dependency-injectable singleton (providedIn: 'root') with async methods returning Promise<string> or Promise<ModelAvailability>
- Public methods: `checkAvailability()`, `downloadModel(onProgress?)`, `prompt(text)`
- API detection: `isApiSupported` getter checks typeof LanguageModel !== 'undefined'

**ModelStatusComponent:**

- Purpose: Display model availability and provide inference UI
- Examples: `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts`
- Pattern: Standalone component with template/style inline, signal-driven reactivity
- Signals: loading, availability, downloading, downloadProgress, promptText, prompting, response, error, responseHtml (computed)
- Key feature: Polling loop during download (2s interval until available)

**BrowserProfile:**

- Purpose: Centralize browser configuration across unit tests, E2E tests, and CI
- Examples: `libs/shared/browser-profiles/src/lib/browser-profiles.ts`
- Pattern: Shared interface and configuration objects (Chrome Beta, Edge Dev)
- Key methods: `getLaunchOptions()` (returns launch config), `seedLocalState()` (writes chrome://flags to Local State)
- Uses: Playwright ignore-default-args, feature flags, profile directory management

## Entry Points

**Application Entry:**

- Location: `apps/in-browser-ai-coding-agent/src/main.ts`
- Triggers: Browser page load
- Responsibilities: Bootstrap Angular application with `bootstrapApplication()`, pass app config and root component

**Root Component:**

- Location: `apps/in-browser-ai-coding-agent/src/app/app.ts`
- Triggers: Bootstrap completion
- Responsibilities: Render title, import ModelStatusComponent, render router outlet

**Unit Test Entry (Vitest):**

- Location: `apps/in-browser-ai-coding-agent/browser-warmup.ts` (setupFile)
- Triggers: Before any test file runs
- Responsibilities: Detect LanguageModel API availability, create and destroy session with warmup prompt, log duration

**E2E Test Entry (Playwright):**

- Location: `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` (worker fixture)
- Triggers: Worker startup
- Responsibilities: Seed profile, retry persistent context launch, warm up model, provide shared context for all tests

**Global Setup (Pre-test):**

- Location: `apps/in-browser-ai-coding-agent/global-setup.ts` (Vitest globalSetup)
- Triggers: Before Vitest starts
- Responsibilities: Iterate profiles, seed Local State with flags

## Error Handling

**Strategy:** Async try-finally with explicit error capture.

**Patterns:**

- **Service Layer:** Throw descriptive errors when API unavailable (`throw new Error('LanguageModel API is not available')`). Session destroy in finally block to prevent resource leaks.
- **Component Layer:** Catch errors in try-catch, set error signal for display, reset prompting state in finally block.
- **Warm-up (setupFile):** Log warnings if warm-up fails, do not throw (tests should run even if warm-up fails). Catch and report duration.
- **Test Fixtures:** Retry browser launch up to 5 times (2s delay between attempts) for ProcessSingleton conflicts on Windows. Throw on final attempt. Log all retry attempts.

## Cross-Cutting Concerns

**Logging:**

- Approach: Console.log for diagnostics, tagged with [source-name] (e.g., [browser-warmup], [fixtures], [global-setup])
- Unit test responses logged with test-specific prefix: [unit-response] for test assertion verification

**Validation:**

- Model API check: `typeof LanguageModel !== 'undefined'` (API presence)
- Status validation: Check returned status against known values (available, downloading, downloadable, unavailable)
- Prompt input: Trim and check length > 0 before submit

**Authentication:**

- Approach: None. On-device API requires no authentication. Browser flags enable feature access.

**Browser Feature Detection:**

- Profile-based: Two pre-configured profiles (Chrome Beta, Edge Dev) with distinct feature flags
- Runtime check: `isApiSupported` property detects API presence at runtime
- Graceful degradation: Functions check API support and throw explicit errors if unavailable

---

_Architecture analysis: 2026-03-23_
