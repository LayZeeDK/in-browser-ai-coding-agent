# In-Browser AI Coding Agent

An Angular 21 application that uses the [LanguageModel browser API](https://developer.chrome.com/docs/ai/prompt-api) to run on-device AI models directly in the browser -- no cloud APIs, no server-side inference.

Two browsers implement the LanguageModel API with different on-device models:

| Browser                 | Model               | Parameters | Context |
| ----------------------- | ------------------- | ---------- | ------- |
| Google Chrome Beta 138+ | Gemini Nano         | --         | --      |
| Microsoft Edge Dev 138+ | Phi-4-mini-instruct | 3.8B       | 128K    |

Both expose the **same `LanguageModel` API** and use the same TypeScript types (`@types/dom-chromium-ai`).

## Prerequisites

- [Node.js](https://nodejs.org/) (see `.node-version` for the required version)
- Google Chrome Beta and/or Microsoft Edge Dev installed locally
- On-device models downloaded (see [Browser Setup](#browser-setup))

## Getting Started

```bash
npm install
npm run build
npx nx serve in-browser-ai-coding-agent
```

Open `http://localhost:4200` in Chrome Beta or Edge Dev.

## Scripts

| Script                 | Description                                   |
| ---------------------- | --------------------------------------------- |
| `npm run build`        | Build all projects                            |
| `npm run lint`         | Lint all projects                             |
| `npm test`             | Run unit tests (Vitest Browser Mode)          |
| `npm run typecheck`    | TypeScript type checking                      |
| `npm run e2e`          | Run e2e tests (Playwright)                    |
| `npm run format`       | Format code with Prettier                     |
| `npm run format:check` | Check formatting                              |
| `npm run ci`           | Full CI pipeline (format check + all targets) |

## Browser Setup

### Google Chrome Beta

1. Install via `winget install Google.Chrome.Beta` or [download](https://www.google.com/chrome/beta/)
2. Open `chrome://flags/#optimization-guide-on-device-model` -- select **Enabled BypassPerfRequirement**
3. Open `chrome://flags/#prompt-api-for-gemini-nano` -- select **Enabled**
4. Restart Chrome Beta
5. Open `chrome://on-device-internals` to monitor model download
6. Verify in DevTools: `await LanguageModel.availability()` should return `"available"`

If it returns `"downloadable"`, trigger the download:

```js
await LanguageModel.create({ expectedInputLanguages: ['en'], expectedOutputLanguages: ['en'] });
```

### Microsoft Edge Dev

1. Install via `winget install Microsoft.Edge.Dev` or [download](https://www.microsoft.com/edge/download/insider)
2. Open `edge://flags/` and search "Prompt API for Phi mini" -- select **Enabled**
3. Restart Edge Dev
4. Open `edge://on-device-internals` to check model status
5. Verify in DevTools: `await LanguageModel.availability()` should return `"available"`

## Architecture

This is an [Nx](https://nx.dev) monorepo with Angular 21:

```
apps/
  in-browser-ai-coding-agent/          # Angular application
    src/app/
      language-model.service.ts         # LanguageModel API wrapper
      model-status.component.ts         # Model availability display
      app.ts                            # Root component
    vitest.config.mts                   # Vitest Browser Mode config
    project.json                        # Nx project config
  in-browser-ai-coding-agent-e2e/      # Playwright e2e tests
    playwright.config.ts                # Chrome Beta + Edge Dev projects
scripts/
  bootstrap-ai-model.mjs               # CI model download bootstrap
.planning/research/                     # CI research documents
```

### Key Technical Decisions

- **Angular 21** with zoneless change detection (no zone.js overhead)
- **`@angular/build:unit-test`** -- Angular's native Vitest integration (not AnalogJS)
- **Vitest Browser Mode** -- unit tests run in real Chrome Beta and Edge Dev, not jsdom
- **Playwright e2e** -- branded browser channels with LanguageModel API feature flags
- **No mocks in local tests** -- tests exercise the real LanguageModel API

## Testing with Real Browser APIs

Both unit tests and e2e tests launch real branded browsers with Playwright. Four Playwright default flags must be overridden for the LanguageModel API to work:

1. `--disable-features=...OptimizationHints` -- replaced without OptimizationHints
2. `--disable-field-trial-config` -- removed for model eligibility checks
3. `--disable-background-networking` -- removed for model registration
4. `--disable-component-update` -- removed for model component loading

Additionally, the `LanguageModel` global only exists on navigated pages (HTTPS, `chrome://`), not on `about:blank`.

See [.planning/research/languagemodel-playwright-automation.md](.planning/research/languagemodel-playwright-automation.md) for the full investigation.

## CI

GitHub Actions workflow with four parallel jobs:

| Job                    | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `format`               | Prettier check (PR only)                         |
| `lint-typecheck-build` | ESLint, TypeScript, Angular build                |
| `test (chrome-beta)`   | Unit + e2e tests in Chrome Beta with Gemini Nano |
| `test (msedge-dev)`    | Unit + e2e tests in Edge Dev with Phi-4-mini     |

Browser test jobs use a matrix strategy with:

- Disk cleanup via [`endersonmenezes/free-disk-space`](https://github.com/endersonmenezes/free-disk-space) to free ~30 GB
- `actions/cache` for browser profiles with downloaded models
- Bootstrap script to seed chrome://flags and trigger model download on cache miss

### Model Sizes (Verified)

| Model                | Docs Claim (free space) | Actual Size on Disk |
| -------------------- | ----------------------- | ------------------- |
| Gemini Nano (v3Nano) | 22 GB                   | 4.0 GB              |
| Phi-4-mini-instruct  | 20 GB                   | 2.3 GB              |

## License

MIT
