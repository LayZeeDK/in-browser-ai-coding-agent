# Technology Stack

**Analysis Date:** 2026-03-23

## Languages

**Primary:**

- TypeScript 5.9.2 - Application logic, type-safe development throughout

**Secondary:**

- JavaScript - Test configuration files and build scripts

## Runtime

**Environment:**

- Node.js ^20.19.0 || ^22.12.0 || >=24.0.0

**Package Manager:**

- npm - Referenced in package-lock.json (committed)

## Frameworks

**Core:**

- Angular 21.2.0 - Frontend web framework
- RxJS 7.8.0 - Reactive programming library

**Testing:**

- Vitest 4.1 - Unit test runner
- @vitest/browser-playwright 4.1 - Browser-based test environment
- Playwright 1.36.0 - Browser automation and E2E testing
- @vitest/coverage-v8 4.1 - Code coverage reporting
- @vitest/ui 4.1 - Vitest UI dashboard

**Build/Dev:**

- Vite 7.0.0 - Build tool and dev server
- @angular/build 21.2.0 - Angular build compiler
- @angular/cli 21.2.0 - CLI tooling

## Key Dependencies

**Critical:**

- @types/dom-chromium-ai 0.0.15 - W3C LanguageModel API type definitions
- marked 17.0.5 - Markdown parsing and rendering

**Infrastructure:**

- @nx/angular 22.6.0 - Nx Angular plugin
- @nx/vitest 22.6.0 - Nx Vitest plugin
- @nx/playwright 22.6.0 - Nx Playwright plugin
- @nx/vite 22.6.0 - Nx Vite plugin
- @nx/eslint 22.6.0 - Nx ESLint plugin
- nx 22.6.0 - Monorepo orchestration

**Code Quality:**

- ESLint 9.8.0 - JavaScript linting
- angular-eslint 21.3.1 - Angular-specific ESLint rules
- @typescript-eslint/utils 8.40.0 - TypeScript linting utilities
- eslint-plugin-playwright 1.6.2 - Playwright test linting
- Prettier 3.6.2 - Code formatter
- eslint-config-prettier 10.0.0 - ESLint + Prettier integration

**Browser/DOM:**

- Zone.js 0.16.0 - Angular change detection
- @angular/platform-browser 21.2.0 - Browser platform module
- JSDOM 29.0.0 - DOM implementation for Node.js

**Compilation:**

- @swc/core 1.15.8 - Fast JavaScript/TypeScript compiler
- @swc-node/register 1.11.1 - SWC Node.js register hook
- @swc/helpers 0.5.18 - SWC runtime helpers
- TypeScript 5.9.2 - Static type checker

## Configuration

**Environment:**

- No cloud service configuration required
- All AI inference runs on-device in browser (W3C LanguageModel API)
- Optional environment variables: `E2E_PORT`, `BASE_URL`, `CI`, `GITHUB_STEP_SUMMARY`

**Build:**

- `tsconfig.base.json` - Shared TypeScript configuration with path aliases
- `.prettierrc` - Prettier config: single quotes enabled
- `eslint.config.mjs` - Flat ESLint configuration (Nx base + TypeScript + JavaScript)
- `nx.json` - Nx workspace configuration with plugin registrations

**Test Configuration Files:**

- `apps/in-browser-ai-coding-agent/vitest.config.mts` - Main Vitest config (both browsers)
- `apps/in-browser-ai-coding-agent/vitest.config.chrome.mts` - Chrome Beta only
- `apps/in-browser-ai-coding-agent/vitest.config.edge.mts` - Edge Dev only
- `apps/in-browser-ai-coding-agent/vitest.shared.mts` - Shared Vitest config factory
- `apps/in-browser-ai-coding-agent-e2e/playwright.config.ts` - Playwright E2E config

## Platform Requirements

**Development:**

- Chrome Beta or Edge Dev (branded browsers required for W3C LanguageModel API)
- Node.js 24+ recommended (aligned with `.node-version`)
- Windows 10/11 or Linux with xvfb display server
- Not supported: macOS (ONNX Runtime CoreML GPU fallback issue)

**Production:**

- Modern browsers supporting W3C LanguageModel API:
  - Chrome 137+ with Gemini Nano (flag: `OptimizationGuideOnDeviceModel`)
  - Edge 134+ with Phi-4 Mini (flag: `AIPromptAPI`)
- No server-side runtime required — SPA runs entirely in browser

**Build Output:**

- Angular builds to `dist/apps/in-browser-ai-coding-agent/`
- Static HTML, CSS, JavaScript bundle ready for CDN or file server

---

_Stack analysis: 2026-03-23_
