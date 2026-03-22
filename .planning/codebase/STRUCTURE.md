# Codebase Structure

**Analysis Date:** 2026-03-22

## Directory Layout

```
in-browser-ai-coding-agent/
├── apps/                              # Nx workspace applications
│   ├── in-browser-ai-coding-agent/   # Main Angular SPA application
│   │   ├── src/
│   │   │   ├── app/                  # Angular components and services
│   │   │   │   ├── app.ts            # Root component
│   │   │   │   ├── app.config.ts     # Angular config (providers, routes)
│   │   │   │   ├── app.routes.ts     # Route definitions
│   │   │   │   ├── language-model.service.ts
│   │   │   │   ├── model-status.component.ts
│   │   │   │   ├── app.spec.ts
│   │   │   │   ├── language-model.service.spec.ts
│   │   │   │   └── model-status.component.spec.ts
│   │   │   ├── main.ts               # Bootstrap entry point
│   │   │   ├── index.html            # HTML template
│   │   │   └── styles.css            # Global styles
│   │   ├── public/                   # Static assets (served as-is)
│   │   ├── global-setup.ts           # Vitest global setup (model warm-up)
│   │   ├── vitest.config.mts         # Vitest browser config
│   │   ├── project.json              # Nx project config
│   │   └── tsconfig.*.json           # TypeScript configs
│   │
│   └── in-browser-ai-coding-agent-e2e/ # E2E tests
│       ├── src/
│       │   ├── fixtures.ts           # Playwright fixture (persistent context)
│       │   ├── example.spec.ts       # Basic navigation tests
│       │   └── prompt.spec.ts        # Prompt inference tests
│       └── playwright.config.ts      # Playwright configuration
│
├── scripts/                           # Build and setup scripts
│   └── bootstrap-ai-model.mjs        # Bootstrap script (download model, seed flags)
│
├── .github/
│   ├── workflows/                    # GitHub Actions CI workflows
│   │   └── ci.yml                    # Main CI pipeline
│   ├── docker/
│   │   └── Dockerfile                # Docker image for Chrome Beta on Linux
│   ├── skills/                       # Nx plugin skills
│   └── prompts/                      # Custom agent prompts
│
├── .planning/
│   ├── codebase/                     # This file and architecture docs
│   └── docs/                         # Detailed analysis (CI, platform, testing)
│
├── .nx/                              # Nx cache (generated)
├── .angular/                         # Angular cache (generated)
├── dist/                             # Build output (generated)
├── .playwright-profiles/             # Browser persistent profiles (generated)
│   ├── chrome-beta/                  # Chrome Beta model profile
│   └── msedge-dev/                   # Edge Dev model profile
│
├── nx.json                           # Nx workspace configuration
├── tsconfig.base.json                # Base TypeScript config (shared paths)
├── package.json                      # Workspace dependencies and scripts
├── eslint.config.mjs                 # ESLint flat config
├── vitest.workspace.ts               # Vitest workspace configuration
└── README.md
```

## Directory Purposes

**apps/in-browser-ai-coding-agent/src/app/:**

- Purpose: Angular components and services for the main application
- Contains: Standalone components, injectable services, unit tests (\*.spec.ts)
- Key files:
  - `app.ts` — Root component
  - `model-status.component.ts` — Main UI for model interaction
  - `language-model.service.ts` — Service wrapper for W3C LanguageModel API

**apps/in-browser-ai-coding-agent-e2e/src/:**

- Purpose: End-to-end tests with Playwright
- Contains: Test specs (\*.spec.ts), test fixtures
- Key files:
  - `fixtures.ts` — Worker-scoped persistent context fixture
  - `example.spec.ts` — Basic navigation and UI tests
  - `prompt.spec.ts` — Inference tests with prompt/response capture

**scripts/:**

- Purpose: Node.js scripts for CI setup and model bootstrapping
- Contains: ESM modules (\*.mjs)
- Key files:
  - `bootstrap-ai-model.mjs` — Downloads model, seeds browser flags, validates API

**.github/workflows/:**

- Purpose: GitHub Actions CI/CD pipeline definitions
- Contains: YAML workflow files
- Key files:
  - `ci.yml` — Main CI pipeline (format, lint, build, e2e, unit tests)

**.planning/docs/:**

- Purpose: Detailed architectural analysis and decision records
- Contains: Markdown documentation
- Key files:
  - `SUMMARY.md` — Executive summary of testing infrastructure
  - `ci-workflow-architecture.md` — CI pipeline design and patterns

## Key File Locations

**Entry Points:**

- `apps/in-browser-ai-coding-agent/src/main.ts` — Browser-side bootstrap (calls `bootstrapApplication()`)
- `apps/in-browser-ai-coding-agent/src/index.html` — HTML template
- `apps/in-browser-ai-coding-agent/global-setup.ts` — Node.js global setup before Vitest browser launch

**Configuration:**

- `nx.json` — Nx workspace config (plugins, generators, caching)
- `tsconfig.base.json` — Base TypeScript compiler options
- `package.json` — Dependencies, workspace scripts, version constraints
- `apps/in-browser-ai-coding-agent/tsconfig.app.json` — App-specific TypeScript config
- `apps/in-browser-ai-coding-agent-e2e/playwright.config.ts` — Playwright test configuration
- `apps/in-browser-ai-coding-agent/vitest.config.mts` — Vitest browser mode config

**Core Logic:**

- `apps/in-browser-ai-coding-agent/src/app/language-model.service.ts` — Service for LanguageModel API
- `apps/in-browser-ai-coding-agent/src/app/model-status.component.ts` — Main UI component
- `apps/in-browser-ai-coding-agent-e2e/src/fixtures.ts` — Playwright persistent context fixture

**Testing:**

- `apps/in-browser-ai-coding-agent/src/app/*.spec.ts` — Unit tests
- `apps/in-browser-ai-coding-agent-e2e/src/*.spec.ts` — E2E tests
- `apps/in-browser-ai-coding-agent/global-setup.ts` — Vitest global setup

**CI/CD:**

- `.github/workflows/ci.yml` — GitHub Actions main workflow
- `.github/docker/Dockerfile` — Docker image for Chrome Beta
- `scripts/bootstrap-ai-model.mjs` — Model bootstrap script

## Naming Conventions

**Files:**

- Components: `*.component.ts` (e.g., `model-status.component.ts`)
- Services: `*.service.ts` (e.g., `language-model.service.ts`)
- Tests: `*.spec.ts` (e.g., `app.spec.ts`)
- Config: `*.config.ts` or `*.config.mjs` (e.g., `vite.config.ts`)
- Setup: `*-setup.ts` (e.g., `global-setup.ts`)

**Directories:**

- Components/services live in `app/` directory
- E2E tests in separate `in-browser-ai-coding-agent-e2e` app
- Build output in `dist/apps/{app-name}`
- Browser profiles in `.playwright-profiles/{browser-name}`

**Test Naming:**

- Unit test files co-located with source: `foo.service.ts` + `foo.service.spec.ts`
- E2E tests in separate app with `src/` directory
- Test suite names follow component/service names: `describe('ModelStatusComponent', ...)`

## Where to Add New Code

**New Feature (UI/Service Enhancement):**

- Primary code: `apps/in-browser-ai-coding-agent/src/app/`
- Create new component: `apps/in-browser-ai-coding-agent/src/app/my-feature.component.ts`
- Create new service: `apps/in-browser-ai-coding-agent/src/app/my-feature.service.ts`
- Tests: Co-located `*.spec.ts` files
- Import in parent component or app.config (if injectable)

**New Component/Module:**

- Implementation: `apps/in-browser-ai-coding-agent/src/app/{component-name}.component.ts`
- Template: Inline in `template` property (no separate HTML file)
- Styles: Inline in `styles` property (no separate CSS file)
- Standalone: Always use `standalone: true` and `imports: [...]`

**Utilities/Shared Helpers:**

- Shared helpers for app: `apps/in-browser-ai-coding-agent/src/app/` (if small, in component file)
- Shared helpers for tests: `apps/in-browser-ai-coding-agent-e2e/src/` (if E2E) or same app `src/app/` (if unit)

**New E2E Tests:**

- Location: `apps/in-browser-ai-coding-agent-e2e/src/{feature}.spec.ts`
- Pattern: Import `{ test, expect }` from `./fixtures` (not `@playwright/test`)
- Fixture parameter: `{ persistentPage: page }` to get page from worker-scoped context
- Assertions: Use standard Playwright `expect()` from fixtures export

**New Unit Tests:**

- Location: `apps/in-browser-ai-coding-agent/src/app/{feature}.spec.ts`
- Pattern: Use Vitest `describe()`, `it()`, `beforeEach()` from `vitest`
- Setup: Inject services via `TestBed.inject()` (Angular testing)
- Browser API access: Direct (e.g., `typeof LanguageModel`)

## Special Directories

**`.playwright-profiles/`:**

- Purpose: Persistent browser user data directories
- Generated: Yes (by bootstrap script or fixture)
- Committed: No (in `.gitignore`)
- Contents: Model files (~4 GB Phi-4 Mini), ONNX artifacts, browser Local State
- Cached in CI: Via rolling cache key with `run_number` suffix

**`dist/`:**

- Purpose: Build output (production and development)
- Generated: Yes (by `nx build`)
- Committed: No (in `.gitignore`)
- Contents: `apps/in-browser-ai-coding-agent/browser/` (Vite build) and `server/` (if SSR)

**`.nx/cache/`:**

- Purpose: Nx task cache
- Generated: Yes (by Nx during build/test)
- Committed: No (in `.gitignore`)
- Scope: Workspace-level, improves incremental build performance

**`.angular/cache/`:**

- Purpose: Angular build cache
- Generated: Yes (by Angular CLI/Vite during build)
- Committed: No (in `.gitignore`)
- Scope: Version-specific (e.g., `.angular/cache/21.2.3`)

**`.github/docker/`:**

- Purpose: Docker build files for Chrome Beta CI
- Generated: No (checked in)
- Contains: Dockerfile with multi-stage build for Chrome Beta and Edge Dev
- Used by: GitHub Actions when `container: true` in test matrix

---

_Structure analysis: 2026-03-22_
