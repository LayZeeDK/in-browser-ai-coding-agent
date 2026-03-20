# Architecture

**Analysis Date:** 2026-03-20

## Pattern Overview

**Overall:** Component-driven Single Page Application (SPA)

**Key Characteristics:**

- Angular 21 with standalone components (no NgModules)
- Zoneless change detection (Angular 21+)
- Reactive state management using Angular signals
- Browser API wrapper pattern for LanguageModel API
- No external data layer — all state localized to components

## Layers

**Presentation Layer:**

- Purpose: Render UI and respond to user interactions
- Location: `apps/in-browser-ai-coding-agent/src/app/`
- Contains: Angular standalone components with templates, styles
- Depends on: Service layer (dependency injection)
- Used by: Angular router, browser DOM

**Service Layer:**

- Purpose: Encapsulate business logic and browser API integration
- Location: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`
- Contains: Injectable services with `providedIn: 'root'` (singleton scope)
- Depends on: Browser APIs (LanguageModel global)
- Used by: Components via Angular DI

**Bootstrap Layer:**

- Purpose: Initialize application and configure providers
- Location: `apps/in-browser-ai-coding-agent/src/main.ts`, `src/app/app.config.ts`
- Contains: `bootstrapApplication()`, `ApplicationConfig`, route definitions
- Depends on: Root component, services
- Used by: Browser entry point

## Data Flow

**Model Availability Check Flow:**

1. App bootstrap in `main.ts` → initializes `bootstrapApplication(App, appConfig)`
2. App component mounted → renders `app.html` template
3. Template renders `<app-model-status></app-model-status>`
4. ModelStatusComponent.ngOnInit() → calls `LanguageModelService.checkAvailability()`
5. Service checks `LanguageModel.availability()` global API
6. Returns status ('available' | 'downloadable' | 'unavailable')
7. Component updates signal `availability` with result
8. Template re-renders with status in data attribute

**State Management:**

- Component-local state via Angular signals: `signal()` for reactive state
- No global state — each component owns its state
- Parent-to-child data binding via component inputs/template syntax
- No state persistence (ephemeral per session)

## Key Abstractions

**LanguageModelService:**

- Purpose: Wrap browser's LanguageModel API and normalize responses
- Examples: `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`
- Pattern: Injectable service with API detection and availability checks
- Exports:
  - `isApiSupported: boolean` — detects presence of LanguageModel global
  - `checkAvailability(): Promise<ModelAvailability>` — returns status
  - Type: `ModelAvailability = 'available' | 'downloadable' | 'unavailable'`

**ModelStatusComponent:**

- Purpose: Display on-device model availability status
- Examples: `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts`
- Pattern: Standalone component with inline template and styles
- State:
  - `loading: Signal<boolean>` — tracks async operation state
  - `availability: Signal<ModelAvailability>` — stores API response

**App Root Component:**

- Purpose: Layout and routing
- Examples: `apps/in-browser-ai-coding-agent/src/app/app.ts`
- Pattern: Standalone component that imports RouterModule for <router-outlet>
- Contains: Title binding, child component composition

## Entry Points

**Browser Entry Point:**

- Location: `apps/in-browser-ai-coding-agent/src/main.ts`
- Triggers: Page load
- Responsibilities: Bootstrap Angular application with root component

**HTML Root:**

- Location: `apps/in-browser-ai-coding-agent/src/index.html`
- Triggers: Browser initial request
- Responsibilities: Provide document structure, load scripts, define <app-root> target

**Application Bootstrap:**

- Location: `apps/in-browser-ai-coding-agent/src/app/app.config.ts`
- Triggers: Called from main.ts during bootstrapApplication()
- Responsibilities: Provide Angular configuration, register services, configure router

**Route Initialization:**

- Location: `apps/in-browser-ai-coding-agent/src/app/app.routes.ts`
- Triggers: Router initialization from appConfig
- Responsibilities: Define application routes (currently empty)

## Error Handling

**Strategy:** Browser error handling with optional console logging

**Patterns:**

- `bootstrapApplication()` in `main.ts` catches and logs errors to console
- Components handle async operations without explicit error boundaries
- LanguageModelService treats unavailable API as valid state (no errors)
- No error UI components — status component displays "unavailable" gracefully

## Cross-Cutting Concerns

**Logging:** Not implemented — relies on browser console for debugging

**Validation:** Type-based via TypeScript:

- `ModelAvailability` type constrains status values
- `@types/dom-chromium-ai` provides types for LanguageModel API
- Compiler-level validation only (no runtime schemas)

**Authentication:** Not applicable — all operations run client-side in browser

**Browser Compatibility:** Handled via feature detection:

- `LanguageModelService.isApiSupported` checks for LanguageModel global
- Falls back gracefully to 'unavailable' on unsupported browsers

---

_Architecture analysis: 2026-03-20_
