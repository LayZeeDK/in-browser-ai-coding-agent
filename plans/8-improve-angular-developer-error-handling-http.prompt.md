/skill-creator:skill-creator Improve angular-developer skill: Error Handling + HTTP Client reference

Continue the skill improvement work from the previous session. The accessibility improvements are committed. `error-handling.md` is at its original 113-line state (no HTTP content).

## What's already done

- `accessibility.md` improved and committed (3 commits on main: `0ceee7a`, `e3424a2`, `4711b4c`)
- `error-handling.md` reverted to original state (113 lines: ErrorHandler, global listeners, TestBed error behavior, resource() error patterns)
- Component evals moved to gitignored workspace (`c5588aa`)
- All 5 angular.dev HTTP sub-pages are fetched as Markdown in `angular-developer-workspace/http-guide/*.md.md`
- Benchmark data from the a11y iteration is in `angular-developer-workspace/iteration-a11y-2/`

## Steps to complete

### Step 1: Create http-client.md

Create `.claude/skills/angular-developer/references/http-client.md` (~250-350 lines) synthesizing all 5 angular.dev HTTP sub-pages. Source files are at:

- `angular-developer-workspace/http-guide/setup.md.md` (80 lines)
- `angular-developer-workspace/http-guide/making-requests.md.md` (361 lines)
- `angular-developer-workspace/http-guide/http-resource.md.md` (63 lines)
- `angular-developer-workspace/http-guide/interceptors.md.md` (159 lines)
- `angular-developer-workspace/http-guide/testing.md.md` (105 lines)

Key sections to include:

1. **Setup**: `provideHttpClient()` feature table (`withFetch`, `withInterceptors`, `withJsonpSupport`, `withXsrfConfiguration`, `withRequestsMadeViaParent`, `withNoXsrfProtection`)
2. **Making requests**: Typed responses, `responseType` table, params (`HttpParams`), headers (`HttpHeaders`), `observe: 'response'`/`'events'`, progress events, **error handling** (`HttpErrorResponse` -- network vs backend vs timeout), **timeouts**, advanced fetch options (`keepalive`, `cache`, `priority`, `mode`, `redirect`, `credentials`)
3. **httpResource**: Reactive fetching, request objects, `.text()`/`.blob()`/`.arrayBuffer()`, Zod/Valibot parse validation, testing with `TestBed.tick()` + `ApplicationRef.whenStable()`. Note: avoid mutations (POST/PUT) with httpResource
4. **Interceptors**: Functional `HttpInterceptorFn` (preferred over DI-based), `inject()` in interceptors, `HttpContext`/`HttpContextToken` for request metadata, immutable `clone()`, auth pattern, retry pattern, synthetic responses
5. **Error handling**: `HttpErrorResponse` (status 0 = network, status > 0 = backend), typed error body parsing, retry with `RxJS retry()` + exponential backoff for 503/429, `catchError` patterns. Note: httpResource errors surface via `.error()` signal -- they do NOT reach `ErrorHandler`
6. **Testing**: `provideHttpClientTesting()` (must come AFTER `provideHttpClient()`), `HttpTestingController`, `expectOne`/`match`/`expectNone`, flushing responses, error testing (`flush` with status, `error` with ProgressEvent), testing interceptors with `withInterceptors` in TestBed

Also update SKILL.md:

- Add new HTTP Client section routing to `http-client.md`
- Update Error Handling section description (keep it focused on ErrorHandler/resource patterns, cross-reference http-client.md for HTTP-specific error patterns)

### Step 2: Eval cycle for error-handling + HTTP

Write 2-3 eval prompts covering:

- HTTP error handling with typed responses, retry interceptor, httpResource error flow (tests the overlap between error-handling.md and http-client.md)
- httpResource with advanced patterns (Zod validation, reactive params, testing with HttpTestingController)
- Interceptor patterns (auth headers, HttpContext tokens, testing interceptors)

Run evals (with-skill vs without-skill), do qualitative review yourself (as done for a11y), then run 5+5 benchmark. Commit after confirming improvement.

## Constraints

- Do not modify `accessibility.md`, `performance.md`, or `security.md`
- Do not modify the 5 Reactivity+AI files (signals-overview.md, resource.md, linked-signal.md, effects.md, ai-design-patterns.md)
- `http-client.md` can be up to 350 lines
- `error-handling.md` should stay at its original 113 lines (revert the HTTP content)
- Follow commit style: `feat(ai): ...` with detailed bodies
- The eval workspace directory `angular-developer-workspace/` is already gitignored

## Angular.dev source pages

- https://angular.dev/guide/http/setup
- https://angular.dev/guide/http/making-requests
- https://angular.dev/guide/http/http-resource
- https://angular.dev/guide/http/interceptors
- https://angular.dev/guide/http/testing
- https://angular.dev/best-practices/error-handling
