# Phase 1: Model Abstraction Layer - Context

**Gathered:** 2026-03-24
**Status:** Ready for planning

<domain>
## Phase Boundary

A stable Angular DI interface (abstract `ModelService` class + factory provider) with per-model implementations for Chrome (Gemini Nano) and Edge (Phi-4 Mini), an anchor session for cold-start prevention, per-pass session management with named presets, and an `UnsupportedModelService` for browsers without the LanguageModel API. The existing `LanguageModelService` and `ModelStatusComponent` are completely replaced. A minimal temp component verifies the service works visually. Full test coverage across unit (mock + real model) and e2e (both browsers).

</domain>

<decisions>
## Implementation Decisions

### Anchor session timing

- Eager initialization at app startup via `ENVIRONMENT_INITIALIZER` (background, non-blocking)
  - _Note: Research confirmed `ENVIRONMENT_INITIALIZER` is deprecated since Angular v19. Plans use `provideEnvironmentInitializer()` (the Angular 21 replacement) to fulfill the same intent._
- App renders immediately; Generate button disabled until anchor is ready
- Empty system prompt on anchor session (zero token cost — preserves full context window)
- Measure `session.contextWindow` and `session.contextUsage` on anchor creation, store as public signals (avoid `window` as variable name — shadows global)
- Per-pass sessions also update the `contextUsage` signal (UI reflects real-time token usage)
- On failure, degrade to 'unavailable' status (no retry)

### DI architecture

- Abstract `ModelService` class as the lightweight injection token (per Angular's "Optimizing injection tokens" guide)
- `provideModel()` function returning `EnvironmentProviders` via `makeEnvironmentProviders()` — follows Angular's `provideRouter()`/`provideHttpClient()` convention
- `ENVIRONMENT_INITIALIZER` bundled inside `provideModel()` (single registration point -- consumers can't forget)
  - _Note: Implemented as `provideEnvironmentInitializer()` -- the non-deprecated Angular 21 API._
- No config parameter on `provideModel()` — keep it simple
- Browser detection: check `typeof LanguageModel !== 'undefined'` first, then CDK `Platform` to distinguish Edge vs Chrome
  - Edge + API: `Phi4MiniModelService`
  - Chrome + API: `GeminiNanoModelService`
  - Unknown Chromium + API: falls back to `GeminiNanoModelService` (simplest implementation)
  - No API: `UnsupportedModelService`
- Chrome Stable and Edge Stable are supported if they have the LanguageModel API — detection is API-first, not channel-specific

### Service API surface

- Named session presets: `type SessionPreset = 'planning' | 'codeGen'` (string union, no enums — general preference)
- Presets defined per model implementation in separate prompt files — callers use `createSession('planning')`, not raw system prompt strings
- Full `ModelSession` interface from Phase 1: `prompt()`, `promptStreaming()`, `destroy()`
- `responseConstraint` deferred to Phase 2 (LOW confidence per STATE.md — schema reliability for small models uncertain)
- Public signals: `modelName`, `status`, `isReady`, `contextWindowSize`, `contextUsage`
- Abstract class includes download lifecycle: `checkAvailability()`, `downloadModel()`

### Unsupported browser UX

- `UnsupportedModelService` (not "Noop" — it actively rejects, not silently ignores)
- `createSession()` throws with a non-technical error message — safety net for programming errors
- UI prevents the action proactively: prompt form hidden/disabled when `status === 'unsupported'`, replaced with browser guidance message
- Two-layer pattern: UI guards are the primary communication; throw is defensive

### Model download UX

- Manual download button for 'downloadable' state — respects metered connections for multi-GB downloads
- Test warm-up is unaffected — uses raw `LanguageModel.create()` before Angular loads, bypasses ModelService entirely
- Auto-start for 'downloading' state (already in progress — show progress)

### System prompt organization

- Separate prompt files: `prompts/gemini-nano.prompts.ts` and `prompts/phi4-mini.prompts.ts`
- Internal only — not exported from barrel
- `Record<SessionPreset, string>` mapping preset to system prompt text
- Phase 1: minimal placeholder prompts (just enough to verify plumbing)
- Phase 2: functional prompts for the pipeline
- Phase 3: tuned per model for output quality

### Token budget visibility

- Public signals: `contextWindowSize` (from anchor), `contextUsage` (updated per active session)
- Displayed in Phase 1 temp component for debugging
- Token count estimation deferred to Phase 3

### Nx library structure

- `@layzeedk/model` as Nx library (`libs/shared/model/`)
- Secondary entrypoint `@layzeedk/model/testing` via Nx generator — exports `MockModelService` and `provideModelTesting()`
- Barrel exports (production): `ModelService` (abstract), `provideModel()`, types
- Barrel exports (testing): `MockModelService`, `provideModelTesting()`
- Concrete implementations NOT exported — internal to the library

### Migration from existing code

- Delete `LanguageModelService` and `ModelStatusComponent` entirely (clean break, not incremental refactor)
- Delete existing specs (`language-model.service.spec.ts`, `model-status.component.spec.ts`)
- Delete existing e2e specs (`example.spec.ts`, `prompt.spec.ts`)

### Testing strategy

- Full test coverage for everything added in Phase 1
- `MockModelService` contract tests (runs in both browsers, no real model)
- Factory/provider integration tests (verify correct implementation per browser)
- Real model integration tests per browser (with `test.skipIf`/`test.runIf` guards)
- Temp component tests (mock for fast tests + one real-API test per browser)
- E2E: replace existing specs with `model-info.spec.ts` (boot + model info) and `model-prompt.spec.ts` (prompt-to-response through UI)
- E2E prompt test goes through the UI (type prompt, click send, assert response)
- Preserve per-browser Vitest configs and Nx targets (`test-chrome`, `test-edge`)
- Accessible markup — no `data-testid` attributes; use `getByRole()`, `getByText()`, accessible queries

### Temp component (Phase 1 only)

- Minimal status indicator + prompt form in one component
- Shows: model name, status, context window size, context usage
- Includes: prompt input, submit button, response display
- Replaced entirely by Phase 3's split-pane UI

### Claude's Discretion

- Browser detection implementation details (CDK `Platform` usage vs alternatives)
- Warm-up/fixture integration decision (raw `LanguageModel` API vs ModelService) — based on real model loading/unloading behavior observed during implementation; current CI observations may not be fully reliable
- Accessible markup pattern for temp component (research-based decision)
- Exact `ModelStatus` type values and transitions

</decisions>

<code_context>

## Existing Code Insights

### Reusable Assets

- `browser-profiles.ts` (`@layzeedk/browser-profiles`): Already distinguishes Chrome Beta from Edge Dev with profile definitions, `seedLocalState()`, `getLaunchOptions()`. Used by test infrastructure only — app code has no browser-specific branching today
- `browser-warmup.ts`: Vitest setupFile that warms model via raw `LanguageModel.create()` + `session.prompt('warmup')`. Runs in the same browser process as tests
- E2E fixtures (`fixtures.ts`): Worker-scoped persistent context with model warm-up. Uses raw `LanguageModel` API

### Established Patterns

- Signal-based reactivity: `ModelStatusComponent` uses `signal()` and `computed()` extensively — new service follows same pattern
- `providedIn: 'root'` for services: Current `LanguageModelService` uses this. New architecture replaces with `provideModel()` factory pattern
- Per-browser Vitest configs: `vitest.config.chrome.mts`, `vitest.config.edge.mts` with separate Nx targets. New tests follow same structure
- `test.skipIf` for Edge Dev: Existing pattern `it.skipIf(inject('CI') && isEdge)` — extend with `test.runIf` for Chrome-only guards
- `@angular/core` `inject()` function for DI (not constructor injection)

### Integration Points

- `app.config.ts`: Add `provideModel()` to providers array alongside `provideRouter()`
- `app.ts` (root component): Replace `ModelStatusComponent` with Phase 1 temp component
- `app.routes.ts`: No changes expected
- `vitest.config.*.mts`: Test configs may need path updates for new lib
- `tsconfig.base.json`: Nx generator adds `@layzeedk/model` path mapping

</code_context>

<specifics>
## Specific Ideas

- Use `ENVIRONMENT_INITIALIZER` for anchor session (not `APP_INITIALIZER` -- `platformInitializer` doesn't work with `bootstrapApplication()`)
  - _Note: Research confirmed `ENVIRONMENT_INITIALIZER` is deprecated since Angular v19. Plans use `provideEnvironmentInitializer()` (the Angular 21 replacement)._
- Angular CDK `Platform` for browser detection (user referenced `https://material.angular.dev/cdk/platform/overview`)
- Angular DI docs "Optimizing injection tokens" pattern for abstract class as DI token (user referenced `https://angular.dev/guide/di/lightweight-injection-tokens`)
- Angular DI docs "Library author provide pattern" for `provideModel()` (from `https://angular.dev/guide/di/defining-dependency-providers#the-provide-pattern`)
- Angular AI chatbot template at `https://github.com/firebase/apphosting-adapters/tree/main/starters/angular/ai-chatbot` — relevant to Phase 3 UI patterns, not Phase 1

</specifics>

<deferred>
## Deferred Ideas

- Angular AI chatbot template reference — relevant to Phase 3 (UI patterns for prompt input, streaming display)
- `responseConstraint` support on `ModelSession` — Phase 2 (low confidence, needs research)
- Token count estimation (`countPromptTokens()`) — Phase 3 (UI concern)
- Temperature per preset — Phase 3 (prompt engineering)
- Prompt versioning for measuring improvement — Phase 3/4
- `with*()` composability pattern on `provideModel()` — add later if needed
- `GenericModelService` for unknown Chromium browsers — add if GeminiNano fallback proves inadequate

</deferred>

---

_Phase: 01-model-abstraction-layer_
_Context gathered: 2026-03-24_
