# Codebase Structure

**Analysis Date:** 2026-03-23

## Directory Layout

```
in-browser-ai-coding-agent/                          # Nx monorepo root
├── .planning/                                         # GSD planning artifacts
│   └── codebase/                                      # Codebase analysis documents
├── .github/                                           # GitHub workflows and skills
├── .githooks/                                         # Pre-commit hooks
├── apps/                                              # Application packages
│   ├── in-browser-ai-coding-agent/                   # Main Angular SPA
│   │   ├── src/
│   │   │   ├── app/                                  # Application layer
│   │   │   │   ├── app.ts                            # Root component
│   │   │   │   ├── app.config.ts                     # Angular app config
│   │   │   │   ├── app.routes.ts                     # Route definitions
│   │   │   │   ├── app.html                          # Root template
│   │   │   │   ├── app.css                           # Root styles
│   │   │   │   ├── app.spec.ts                       # Root component tests
│   │   │   │   ├── language-model.service.ts         # LLM API wrapper service
│   │   │   │   ├── language-model.service.spec.ts    # Service unit tests
│   │   │   │   ├── model-status.component.ts         # Model/prompt UI component
│   │   │   │   └── model-status.component.spec.ts    # Component unit tests
│   │   │   ├── main.ts                               # Application bootstrap
│   │   │   ├── index.html                            # HTML shell
│   │   │   └── styles.css                            # Global stylesheet
│   │   ├── public/                                   # Static assets (copied to dist)
│   │   ├── project.json                              # Nx project configuration
│   │   ├── tsconfig.app.json                         # TypeScript config (app)
│   │   ├── tsconfig.spec.json                        # TypeScript config (tests)
│   │   ├── eslint.config.mjs                         # ESLint flat config (app)
│   │   ├── browser-warmup.ts                         # Vitest setupFile — model warm-up
│   │   ├── global-setup.ts                           # Vitest globalSetup — all browsers
│   │   ├── global-setup.chrome.ts                    # Vitest globalSetup — Chrome only
│   │   ├── global-setup.edge.ts                      # Vitest globalSetup — Edge only
│   │   ├── global-setup.shared.ts                    # Shared globalSetup logic
│   │   ├── vitest.config.mts                         # Vitest config (both browsers)
│   │   ├── vitest.config.chrome.mts                  # Vitest config (Chrome only)
│   │   ├── vitest.config.edge.mts                    # Vitest config (Edge only)
│   │   └── vitest.shared.mts                         # Vitest config factory
│   └── in-browser-ai-coding-agent-e2e/              # Playwright E2E tests
│       ├── src/
│       │   ├── fixtures.ts                           # Playwright test fixtures
│       │   ├── example.spec.ts                       # Example tests
│       │   └── prompt.spec.ts                        # Real inference tests
│       ├── project.json                              # Nx project configuration
│       ├── tsconfig.json                             # TypeScript config
│       ├── playwright.config.ts                      # Playwright configuration
│       └── eslint.config.mjs                         # ESLint flat config (E2E)
├── libs/                                              # Reusable libraries
│   └── shared/
│       └── browser-profiles/                         # Browser config library
│           ├── src/
│           │   ├── index.ts                          # Public API export
│           │   └── lib/browser-profiles.ts           # Browser profile definitions
│           ├── project.json                          # Nx project configuration
│           ├── tsconfig.json                         # TypeScript config
│           └── eslint.config.mjs                     # ESLint flat config
├── scripts/                                           # Utility scripts
│   ├── bootstrap-ai-model.mjs                        # Download models and seed profiles
│   └── rebase-format.sh                              # Rebase helper with format fixes
├── docs/                                              # Architecture documentation
│   ├── SUMMARY.md                                    # Architecture summary
│   └── platform-runner-findings.md                   # Platform/runner compatibility
├── .planning/                                         # GSD workflow artifacts
├── .playwright-profiles/                             # Browser profile caches (gitignored)
├── dist/                                              # Build output (gitignored)
├── node_modules/                                      # npm dependencies (gitignored)
├── .env* files                                        # Environment configuration (gitignored)
├── eslint.config.mjs                                 # Root ESLint config
├── nx.json                                           # Nx workspace configuration
├── tsconfig.base.json                                # Root TypeScript config with path aliases
├── vitest.workspace.ts                               # Vitest workspace configuration
├── package.json                                      # Workspace dependencies and scripts
├── package-lock.json                                 # Dependency lock file
├── README.md                                         # Project documentation
├── CLAUDE.md                                         # Claude-specific instructions
├── AGENTS.md                                         # Agent-agnostic guidelines
└── .prettierrc                                       # Prettier formatting config
```

## Directory Purposes

**apps/in-browser-ai-coding-agent/src/app:**

- Purpose: Angular application layer containing all UI components and services
- Contains: Components (.ts), templates (.html), styles (.css), unit tests (.spec.ts)
- Key files: `app.ts` (root), `language-model.service.ts` (business logic), `model-status.component.ts` (UI)

**apps/in-browser-ai-coding-agent/src:**

- Purpose: Application source root
- Contains: Entry point (main.ts), HTML shell (index.html), global styles (styles.css), app/ subdirectory
- Key files: `main.ts` (bootstrap), `index.html` (document root)

**apps/in-browser-ai-coding-agent (root):**

- Purpose: Vitest configuration and test setup
- Contains: vitest configs (both/chrome/edge), globalSetup files, setupFile, browser-warmup
- Key files: `vitest.shared.mts` (config factory), `browser-warmup.ts` (model warm-up), `global-setup.shared.ts` (profile seeding)

**apps/in-browser-ai-coding-agent-e2e/src:**

- Purpose: Playwright E2E tests
- Contains: Test specs, fixtures (worker-scoped persistent context)
- Key files: `fixtures.ts` (browser context and model warm-up), `example.spec.ts`, `prompt.spec.ts`

**libs/shared/browser-profiles/src/lib:**

- Purpose: Single source of truth for browser configuration
- Contains: Profile definitions, launch options, flag seeding logic
- Key files: `browser-profiles.ts` (profiles, seedLocalState, getLaunchOptions)
- Usage: Imported by app, E2E tests, Vitest configs via `@layzeedk/browser-profiles` alias

**scripts:**

- Purpose: Build-time and CI utility scripts
- Contains: `bootstrap-ai-model.mjs` (model download + profile setup), `rebase-format.sh` (git helper)

**docs:**

- Purpose: Architecture and platform/runner reference documentation
- Contains: `SUMMARY.md` (quick-reference tables), `platform-runner-findings.md` (runner compatibility matrix)

## Key File Locations

**Entry Points:**

- `apps/in-browser-ai-coding-agent/src/main.ts`: Application bootstrap — calls `bootstrapApplication()` with appConfig and App component
- `apps/in-browser-ai-coding-agent/src/app/app.ts`: Root component — renders title and ModelStatusComponent
- `apps/in-browser-ai-coding-agent/browser-warmup.ts`: Vitest setupFile — warms model before tests
- `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts`: Playwright E2E fixture — launches persistent context with model warm-up

**Configuration:**

- `tsconfig.base.json`: Root TypeScript config with path alias `@layzeedk/browser-profiles`
- `nx.json`: Nx workspace config with plugins, target defaults, caching rules
- `eslint.config.mjs`: Root ESLint flat config with module boundary rules
- `package.json`: Workspace dependencies (Angular, Nx, Vitest, Playwright) and npm scripts

**Core Logic:**

- `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts`: W3C LanguageModel API wrapper with checkAvailability(), downloadModel(), prompt()
- `libs/shared/browser-profiles/src/lib/browser-profiles.ts`: BrowserProfile definitions and seedLocalState() logic
- `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts`: Main UI component with model status display and inference form

**Testing:**

- `apps/in-browser-ai-coding-agent/src/app/*.spec.ts`: Unit tests (3 files: app, service, component)
- `apps/in-browser-ai-coding-agent-e2e/src/*.spec.ts`: E2E tests (2 files: example, prompt)
- `apps/in-browser-ai-coding-agent/vitest.shared.mts`: Vitest config factory with browser instances
- `apps/in-browser-ai-coding-agent/global-setup.shared.ts`: Shared profile seeding logic

## Naming Conventions

**Files:**

- Components: `[name].component.ts` (e.g., `model-status.component.ts`)
- Services: `[name].service.ts` (e.g., `language-model.service.ts`)
- Tests: `[name].spec.ts` (e.g., `model-status.component.spec.ts`)
- Configuration: `[name].config.ts` (e.g., `app.config.ts`)
- Routes: `*.routes.ts` (e.g., `app.routes.ts`)
- Vitest configs: `vitest.config.mts` or `vitest.config.[variant].mts` (e.g., `vitest.config.chrome.mts`)
- Global setup: `global-setup.ts` or `global-setup.[variant].ts` (e.g., `global-setup.chrome.ts`)

**Directories:**

- Feature modules: `/src/app/` (flat structure — no nested feature directories yet)
- Shared code: `libs/shared/[feature]/` (e.g., `libs/shared/browser-profiles/`)
- Test support: Co-located with source or in `[project-root]/` for Vitest/Playwright config
- Scripts: `scripts/` (build-time utilities)
- Docs: `docs/` (architecture and reference)

**Functions:**

- camelCase for all functions and methods
- Async functions use Promise<T> return type
- Service methods: check\*(), [verb]Model(), prompt() patterns
- Component lifecycle: ngOnInit, onDownload(), onSubmit() patterns

**Types & Interfaces:**

- PascalCase for types (e.g., `ModelAvailability`, `BrowserProfile`)
- Discriminated unions for status: `'available' | 'downloading' | 'downloadable' | 'unavailable'`
- Single responsibility: type names describe scope (LanguageModelService handles LanguageModel API only)

## Where to Add New Code

**New Feature:**

- Primary code: `apps/in-browser-ai-coding-agent/src/app/[feature].component.ts` or `.service.ts`
- Tests: `apps/in-browser-ai-coding-agent/src/app/[feature].component.spec.ts` or `.service.spec.ts`
- Follow existing naming: `[name].component.ts` for components, `[name].service.ts` for services

**New Component/Module:**

- Location: `apps/in-browser-ai-coding-agent/src/app/` (no nested subdirectories — flat structure)
- Standalone: Use `@Component` with `standalone: true` (implicit in Angular 21)
- Imports: List dependencies in `@Component({ imports: [...] })`
- Example: See `model-status.component.ts`

**Shared Utilities:**

- Shared across app and E2E: `libs/shared/[name]/src/lib/[name].ts`
- Export via `libs/shared/[name]/src/index.ts`
- Register path alias in `tsconfig.base.json` paths section
- Example: `@layzeedk/browser-profiles` alias for `libs/shared/browser-profiles`

**Shared Library (Nx):**

- Run: `npm exec nx g @nx/angular:library --name [name] --directory libs/shared`
- Creates project.json, tsconfig.json, eslint config
- Update path alias in tsconfig.base.json

**Test Files:**

- Unit tests (Vitest browser mode): Co-located with source `.spec.ts`
- E2E tests (Playwright): `apps/in-browser-ai-coding-agent-e2e/src/[feature].spec.ts`
- Fixtures (worker-scoped): Add to `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts`

## Special Directories

**.playwright-profiles:**

- Purpose: Browser profile caches (Chrome Beta, Edge Dev)
- Generated: Yes — by bootstrap script or on test run
- Committed: No — .gitignore excludes `**/.playwright-profiles`
- Contains: profile directories with Local State (flags), ONNX runtime DLLs, model files

**dist/**

- Purpose: Build output directory
- Generated: Yes — by `npm run build` or Nx build target
- Committed: No — .gitignore excludes `dist`
- Contains: `apps/in-browser-ai-coding-agent/browser/` (Vite output)

**node_modules/**

- Purpose: npm dependencies
- Generated: Yes — by `npm install`
- Committed: No — standard exclusion
- Layout: Hoisted monorepo structure under node_modules/.pnpm/ (npm v8+)

**.nx/cache/**

- Purpose: Nx task cache
- Generated: Yes — by Nx on task execution
- Committed: No — .gitignore excludes `.nx`
- Usage: Task caching for build, lint, test, typecheck

**.github/workflows/**

- Purpose: GitHub Actions CI/CD
- Contains: `.yml` files for lint, test, build, E2E on multiple runners
- Key workflows: `ci.yml` (main pipeline), browser-specific workflows

**.githooks/**

- Purpose: Git hooks
- Contains: `pre-commit` hook that runs `nx format` on staged files
- Setup: `npm install` runs `git config core.hooksPath .githooks`

---

_Structure analysis: 2026-03-23_
