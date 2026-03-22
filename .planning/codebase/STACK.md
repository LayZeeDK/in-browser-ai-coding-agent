# Technology Stack

**Analysis Date:** 2026-03-22

## Languages

**Primary:**

- **TypeScript** 5.9.2 - All application code, configuration, and test files
- **HTML/CSS** - Component templates and styling in Angular app
- **JavaScript** - Node.js scripts for CI automation

**Secondary:**

- **Bash** - CI workflow scripts and shell commands in GitHub Actions

## Runtime

**Environment:**

- **Node.js** ^20.19.0 || ^22.12.0 || >=24.0.0 (specified in `package.json` engines)
- **Browsers (application runtime):**
  - Chrome Beta 147+ - Primary test target with Gemini Nano
  - Edge Dev - Secondary test target with Phi-4 Mini

**Package Manager:**

- **npm** - Lockfile: `package-lock.json` present
- **pnpm** compatible (monorepo uses Node.js 24 ARM64 builds via pnpm scripts in CI)

## Frameworks

**Core:**

- **Angular** 21.2.0 - Frontend application framework
  - `@angular/core` 21.2.0 - Core framework
  - `@angular/compiler` 21.2.0 - Template compilation
  - `@angular/platform-browser` 21.2.0 - Browser platform
  - `@angular/router` 21.2.0 - Routing
  - `@angular/forms` 21.2.0 - Form handling
  - `@angular/common` 21.2.0 - Common utilities

**Build & Development:**

- **Nx** 22.6.0 - Monorepo orchestration and task management
  - `@nx/angular` 22.6.0 - Angular integration for Nx
  - `@nx/vite` 22.6.0 - Vite build tool integration
  - `@nx/vitest` 22.6.0 - Vitest test runner integration
  - `@nx/playwright` 22.6.0 - Playwright e2e integration
  - `@nx/eslint` 22.6.0 - ESLint integration
  - `@nx/js` 22.6.0 - JavaScript/TypeScript compilation
  - `@nx/web` 22.6.0 - Web application utilities
  - `@nx/devkit` 22.6.0 - Nx plugin development utilities

**Testing:**

- **Vitest** 4.1 - Unit test runner with browser mode support
  - `@vitest/browser-playwright` 4.1 - Browser context provider for Vitest
  - `@vitest/coverage-v8` 4.1 - Code coverage reporting
  - `@vitest/ui` 4.1 - Test UI dashboard
- **Playwright** 1.36.0 - E2E testing and browser automation
  - `@playwright/test` 1.36.0 - Test harness and assertions
  - `eslint-plugin-playwright` 1.6.2 - ESLint rules for Playwright code

**Build:**

- **Vite** 7.0.0 - Fast build tool and dev server
- **Angular Build** ~21.2.0 - Angular-specific build tooling
  - `@angular-devkit/build-angular` ~21.2.0
  - `@angular-devkit/core` ~21.2.0
  - `@angular-devkit/schematics` ~21.2.0
  - `@angular/build` ~21.2.0
  - `@angular/cli` ~21.2.0
  - `@angular/compiler-cli` ~21.2.0
  - `@angular/language-service` ~21.2.0

## Key Dependencies

**Critical:**

- **@types/dom-chromium-ai** ^0.0.15 - TypeScript type definitions for W3C LanguageModel API
  - Why it matters: Enables typed access to Chrome's on-device AI runtime (global `LanguageModel` object)

**Utilities:**

- **RxJS** ~7.8.0 - Reactive programming for Angular
- **zone.js** 0.16.0 - Angular zone patching
- **tslib** ^2.3.0 - TypeScript runtime helpers
- **marked** ^17.0.5 - Markdown parsing for docs/content

**Build & Compilation:**

- **TypeScript** ~5.9.2 - Language and type system
- **@swc/core** 1.15.8 - Fast JavaScript compiler
  - `@swc-node/register` 1.11.1 - Node.js TypeScript support
  - `@swc/helpers` 0.5.18 - Runtime helpers
- **Esbuild** (via @nx/js) - JavaScript bundler

**Code Quality:**

- **ESLint** ^9.8.0 - Linting and code analysis
  - `@eslint/js` ^9.8.0 - Base configuration
  - `@nx/eslint-plugin` 22.6.0 - Nx-specific rules
  - `eslint-config-prettier` ^10.0.0 - Prettier conflict resolution
  - `typescript-eslint` ^8.40.0 - TypeScript support
  - `@typescript-eslint/utils` ^8.40.0 - TypeScript utilities
  - `angular-eslint` 21.3.1 - Angular linting rules
- **Prettier** ~3.6.2 - Code formatter with `singleQuote: true` config
- **JITI** 2.4.2 - Just-in-time module import for configuration files

**Testing Utilities:**

- **JSDOM** ~29.0.0 - DOM implementation for Node.js (fallback for non-browser tests)
- **Playwright** 1.36.0 - Browser automation

## Configuration

**Environment:**

- Configuration via `package.json` engine constraints and `.node-version` file
- No `.env` files used (application is browser-only, no backend)
- Browser behavior configured via Playwright launch options and chrome://flags (seeded in Local State)

**Build:**

- `nx.json` - Nx workspace configuration
- Root `eslint.config.mjs` - ESLint setup with Nx plugins
- `.prettierrc` - Prettier formatting: `singleQuote: true`
- Project-level configs:
  - `apps/in-browser-ai-coding-agent/tsconfig.json` - Application TypeScript
  - `apps/in-browser-ai-coding-agent/vitest.config.mts` - Unit test browser mode
  - `apps/in-browser-ai-coding-agent-e2e/playwright.config.ts` - E2E test configuration
  - `apps/in-browser-ai-coding-agent-e2e/eslint.config.mjs` - E2E test linting

**Dockerfile Configuration:**

- Base image: `ubuntu:24.04`
- Node.js 24 via NodeSource repository
- Playwright system dependencies (shared Chromium libs)
- Non-root user (UID 1001 for GitHub Actions compatibility)
- Multi-stage build: `base` → `chrome-beta` and `msedge-dev` final images

## Platform Requirements

**Development:**

- Node.js 20.19+, 22.12+, or 24+
- Chrome Beta or Edge Dev (installed via `npx playwright install`)
- 16 GB RAM minimum for Phi-4 Mini inference testing
- 4+ CPU cores for model inference
- ~5-6 GB free disk for model profiles

**Production (CI):**

- **Chrome Beta testing:** `ubuntu-latest` (4 vCPU, 16 GB RAM, no GPU)
  - Containerized via Docker (`ghcr.io/layzeedk/in-browser-ai-coding-agent/playwright-chrome-beta:latest`)
  - Model: Gemini Nano (~4 GB, XNNPACK CPU inference)
  - Inference time: ~5 minutes per prompt (CPU-based)

- **Edge Dev testing:** `windows-11-arm` (4 vCPU ARM64, 16 GB RAM, no GPU)
  - Bare runner (no Docker available on Windows ARM)
  - Model: Phi-4 Mini (~4.93 GB, ONNX Runtime CPU inference)
  - Inference time: 11+ minutes cold-start, faster with cached profiles

**Unsupported Platforms:**

- Windows Server 2025 (`windows-latest`) - Server SKU incompatible with on-device models
- macOS runners - Insufficient GPU VRAM or total RAM (no CPU fallback in ONNX Runtime CoreML)
- Linux ARM64 - No Chrome Beta ARM64 .deb available

## Dependencies at Risk

**Optional Native Modules (ARM64-specific):**
These packages have ARM64-native builds for `windows-11-arm` runner:

- `@swc/core` → `@swc/core-win32-arm64-msvc`
- `esbuild` → `@esbuild/win32-arm64`
- `@nx/nx` → `@nx/nx-win32-arm64-msvc`
- `@parcel/watcher` → `@parcel/watcher-win32-arm64`
- `lmdb` → `@lmdb/lmdb-win32-arm64`
- `@rollup/rollup` → `@rollup/rollup-win32-arm64-msvc`

These ensure native code runs efficiently on ARM64 without QEMU emulation during CI. Absent these, the build would fall back to x86_64 binaries under QEMU, significantly slower.

---

_Stack analysis: 2026-03-22_
