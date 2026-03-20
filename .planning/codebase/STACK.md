# Technology Stack

**Analysis Date:** 2026-03-20

## Languages

**Primary:**

- TypeScript 5.9.2 - Application logic, tests, configuration
- HTML - UI templates

**Secondary:**

- CSS - Component and global styling
- JavaScript/Node.js - Build scripts

## Runtime

**Environment:**

- Node.js 24.x (specified via `.node-version`: 24)
- Supported versions: ^20.19.0 || ^22.12.0 || >=24.0.0

**Package Manager:**

- npm 10.x (inferred from package-lock.json)
- Lockfile: Present (`package-lock.json`)

## Frameworks

**Core:**

- Angular 21.2.0 - Frontend framework, component architecture
  - @angular/core - Core framework
  - @angular/common - Common directives and pipes
  - @angular/router - Client-side routing
  - @angular/forms - Reactive forms
  - @angular/platform-browser - Browser DOM rendering
  - @angular-devkit/build-angular - Application builder

**Testing:**

- Vitest 4.0.9 - Unit test runner (configured via `vitest.workspace.ts`)
- @vitest/ui 4.0.9 - Test UI dashboard
- @vitest/coverage-v8 4.0.9 - Code coverage reporting
- @vitest/browser-playwright 4.0.9 - Browser-based test execution
- @angular/build:unit-test - Angular test executor (uses Vitest)
- Playwright 1.36.0+ - E2E test framework via @playwright/test
- JSDOM 29.0.0 - DOM implementation for tests

**Build/Dev:**

- Vite 7.0.0 - Module bundler and dev server
- @nx/vite 22.6.0 - Nx Vite plugin
- @angular/cli 21.2.0 - Angular development CLI
- Nx 22.6.0 - Monorepo build orchestrator
  - @nx/angular 22.6.0 - Nx Angular plugin
  - @nx/js 22.6.0 - Nx JavaScript plugin
  - @nx/web 22.6.0 - Nx web plugin
  - @nx/vitest 22.6.0 - Nx Vitest integration
  - @nx/playwright 22.6.0 - Nx Playwright integration
  - @nx/eslint 22.6.0 - Nx ESLint integration
  - @nx/devkit 22.6.0 - Nx development toolkit

**Code Quality:**

- ESLint 9.8.0 - JavaScript/TypeScript linting
- @nx/eslint-plugin 22.6.0 - Nx-specific ESLint rules
- Prettier 3.6.2 - Code formatting
- TypeScript ESLint 8.40.0 - TypeScript-aware ESLint rules

## Key Dependencies

**Critical:**

- rxjs 7.8.0 - Reactive programming library for Angular
- zone.js 0.16.0 - Angular's zone management library
- @types/dom-chromium-ai 0.0.15 - TypeScript types for Chrome's on-device AI APIs (LanguageModel API)

**Infrastructure:**

- tslib 2.3.0 - TypeScript runtime helper library
- @swc/core 1.15.8 - Fast JavaScript/TypeScript compiler
- @swc-node/register 1.11.1 - SWC Node.js register hook
- jiti 2.4.2 - CommonJS compatibility loader

## Configuration

**Environment:**

- Configuration via `nx.json` for Nx build system
- Environment variables: BASE_URL for E2E test server (defaults to `http://localhost:4200`)
- Browser flags configured in `playwright.config.ts` and `vitest.config.mts`:
  - Chrome Beta: Enables Gemini Nano model via `--enable-features=OptimizationGuideOnDeviceModel,PromptAPIForGeminiNano`
  - Edge Dev: Enables Phi-4 Mini model via `--enable-features=PromptAPIForPhiMini`

**Build:**

- `angular.json`-style configuration via `project.json` in `apps/in-browser-ai-coding-agent/`
- Vite configuration: `apps/in-browser-ai-coding-agent/vitest.config.mts`
- ESLint: `eslint.config.mjs` (flat config format)
- Prettier: `.prettierrc` with `singleQuote: true`
- TypeScript: `tsconfig.base.json`, `apps/in-browser-ai-coding-agent/tsconfig.app.json`

## Platform Requirements

**Development:**

- Node.js 24+ (see `.node-version`)
- npm 10+ (implied by lockfile)
- Chrome Beta or Edge Dev browser with on-device AI support (for running model tests)
- Optional: Playwright profile directories (`.playwright-profiles/`) for persistent browser state

**Production:**

- Browser deployment target: Chromium-based browsers (Chrome, Edge)
- Browser feature requirements:
  - LanguageModel API support (Chrome Beta or Edge Dev channels)
  - OptimizationGuideOnDeviceModel or PromptAPI features enabled
- Minimum configuration: Base browser can run without on-device AI, graceful degradation to "unavailable" status
- Output path: `dist/apps/in-browser-ai-coding-agent/browser/`

---

_Stack analysis: 2026-03-20_
