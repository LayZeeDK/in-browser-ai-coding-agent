# HTTP Client

Angular's `HttpClient` provides a typed, observable-based API for HTTP communication. `httpResource` adds reactive, signal-based data fetching on top of it.

For the full guide, see the [Angular HTTP Client documentation](https://angular.dev/guide/http).

## Setup

Configure `HttpClient` via `provideHttpClient()` in your application config:

```ts
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(withFetch(), withInterceptors([authInterceptor, retryInterceptor]))],
};
```

### Feature Functions

| Feature                       | Purpose                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `withFetch()`                 | Use Fetch API instead of XMLHttpRequest (enables advanced fetch options)       |
| `withInterceptors(fns)`       | Register functional interceptors (recommended over DI-based)                   |
| `withInterceptorsFromDi()`    | Enable class-based `HttpInterceptor` via DI multi-provider                     |
| `withRequestsMadeViaParent()` | Forward requests through parent injector's HttpClient after local interceptors |
| `withJsonpSupport()`          | Enable `.jsonp()` for JSONP cross-domain requests                              |
| `withXsrfConfiguration(opts)` | Customize XSRF cookie/header names                                             |
| `withNoXsrfProtection()`      | Disable built-in XSRF protection                                               |

## Making Requests

### Typed Responses

The generic type parameter is a type **assertion** -- HttpClient does not validate the response shape at runtime:

```ts
// Type assertion only -- no runtime validation
http.get<User>('/api/user/1').subscribe((user) => console.log(user.name));

// For unknown shapes, prefer `unknown` over `Object`
http.get<unknown>('/api/data').subscribe((data) => {
  /* narrow manually */
});
```

### Response Types

| `responseType`     | Returns                         |
| ------------------ | ------------------------------- |
| `'json'` (default) | Parsed JSON of the generic type |
| `'text'`           | `string`                        |
| `'arraybuffer'`    | `ArrayBuffer`                   |
| `'blob'`           | `Blob`                          |

When extracting options to a variable, use `as const`: `responseType: 'text' as const`.

### URL Parameters and Headers

```ts
// Object literal (simplest)
http.get('/api/items', { params: { page: '1', size: '20' } });

// HttpParams (immutable -- mutation methods return new instances)
const params = new HttpParams().set('page', '1').set('size', '20');
http.get('/api/items', { params });

// Headers -- object literal or immutable HttpHeaders
http.get('/api/config', { headers: { 'X-Custom': 'value' } });
```

### Observing the Full Response

```ts
// Access status, headers, body via observe: 'response'
http.get<Config>('/api/config', { observe: 'response' }).subscribe((res) => {
  console.log(res.status, res.headers.get('ETag'), res.body);
});

// Progress events via observe: 'events' + reportProgress: true
http.post('/api/upload', formData, { reportProgress: true, observe: 'events' }).subscribe((event) => {
  if (event.type === HttpEventType.UploadProgress) {
    console.log(`${event.loaded} / ${event.total} bytes`);
  }
});
```

### Timeouts

Set `timeout` in milliseconds. Applies only to the backend request, not the interceptor chain. Timeout errors produce `HttpErrorResponse` with `status: 0`.

### Advanced Fetch Options (withFetch only)

| Option        | Example values                         | Use case                                                |
| ------------- | -------------------------------------- | ------------------------------------------------------- |
| `keepalive`   | `true`                                 | Analytics requests that outlive page navigation         |
| `cache`       | `'force-cache'`, `'no-cache'`          | Browser HTTP cache control                              |
| `priority`    | `'high'`, `'low'`, `'auto'`            | Resource loading priority (Core Web Vitals)             |
| `mode`        | `'cors'`, `'same-origin'`, `'no-cors'` | Cross-origin request handling                           |
| `redirect`    | `'follow'`, `'error'`, `'manual'`      | Redirect behavior                                       |
| `credentials` | `'include'`, `'same-origin'`, `'omit'` | Cookie/credential sending (`withCredentials` overrides) |

## httpResource (Experimental)

`httpResource` is a reactive wrapper around `HttpClient` that exposes request status and response as signals. It initiates requests eagerly (unlike HttpClient which waits for subscription).

```ts
userId = input.required<string>();

// Simple URL -- re-fetches when userId changes
user = httpResource<User>(() => `/api/user/${this.userId()}`);

// Request object for advanced options
user = httpResource<User>(() => ({
  url: `/api/user/${this.userId()}`,
  method: 'GET',
  headers: { 'X-Special': 'true' },
  params: { details: 'full' },
}));
```

Avoid using `httpResource` for mutations (POST/PUT/DELETE). Use `HttpClient` directly for those.

### Template Usage

Guard `.value()` reads with `.hasValue()` -- reading `.value()` in error state throws at runtime:

```html
@if (user.hasValue()) {
<user-details [user]="user.value()" />
} @else if (user.error()) {
<error-banner [message]="user.error().message" />
} @else if (user.isLoading()) {
<loading-spinner />
}
```

### Response Types

```ts
httpResource.text(() => url); // value() returns string
httpResource.blob(() => url); // value() returns Blob
httpResource.arrayBuffer(() => url); // value() returns ArrayBuffer
```

### Response Validation (Zod/Valibot)

Use `parse` to validate and transform the response at runtime -- the return type of `parse` determines the type of `.value()`:

```ts
import { z } from 'zod';

const UserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['admin', 'user']),
});

user = httpResource(() => `/api/user/${this.userId()}`, {
  parse: UserSchema.parse,
});
// user.value() is typed as z.infer<typeof UserSchema>
```

### Error Handling

httpResource errors surface via `.error()` signal -- they do **not** reach `ErrorHandler`. This is consistent with `resource()`. See [error-handling.md](error-handling.md) for `ErrorHandler` patterns.

## Interceptors

Functional interceptors (recommended) receive `HttpRequest` and a `next` function. Register with `provideHttpClient(withInterceptors([...]))`. They execute in listed order.

```ts
export function loggingInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> {
  return next(req).pipe(
    tap((event) => {
      if (event.type === HttpEventType.Response) {
        console.log(req.url, 'returned', event.status);
      }
    }),
  );
}
```

### Modifying Requests (Immutable Clone)

`HttpRequest` and `HttpResponse` are immutable. Use `.clone()` to modify:

```ts
export function authInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn) {
  const token = inject(AuthService).getAuthToken();

  const authReq = req.clone({
    headers: req.headers.set('Authorization', `Bearer ${token}`),
  });

  return next(authReq);
}
```

Interceptors run in the injection context of the injector that registered them, so `inject()` works directly.

### HttpContext for Request Metadata

Pass per-request metadata to interceptors without sending it to the backend. Define a token, read it in the interceptor, set it on the request:

```ts
export const SKIP_AUTH = new HttpContextToken<boolean>(() => false);

// In interceptor: if (req.context.get(SKIP_AUTH)) return next(req);
// In caller: http.get('/api/public', { context: new HttpContext().set(SKIP_AUTH, true) });
```

`HttpContext` is mutable (unlike other request properties) -- useful for passing state across retries.

### Retry Interceptor with Exponential Backoff

```ts
export function retryInterceptor(req: HttpRequest<unknown>, next: HttpHandlerFn) {
  return next(req).pipe(
    retry({
      count: 3,
      delay: (error, retryCount) => {
        if (error instanceof HttpErrorResponse && [503, 429].includes(error.status)) {
          return timer(Math.pow(2, retryCount) * 1000); // 2s, 4s, 8s
        }
        throw error;
      },
    }),
  );
}
```

### Synthetic Responses

Interceptors can skip `next` and return responses directly (e.g., caching): `return of(new HttpResponse({ body: cachedData }));`

## Error Handling

### HttpErrorResponse

All HTTP errors are captured in `HttpErrorResponse`:

| Scenario                   | `status`         | `error` property         |
| -------------------------- | ---------------- | ------------------------ |
| Network/connection failure | `0`              | `ProgressEvent` instance |
| Request timeout            | `0`              | `ProgressEvent` instance |
| Backend error (4xx/5xx)    | HTTP status code | Error response body      |

```ts
http.get<User>('/api/user/1').pipe(
  catchError((error: HttpErrorResponse) => {
    if (error.status === 0) {
      // Network or timeout error
      console.error('Network error:', error.error);
    } else {
      // Backend error -- error.error contains the response body
      console.error(`Backend returned ${error.status}:`, error.error);
    }

    return of(null);
  }),
);
```

For typed error bodies, cast `error.error` to your API's error shape: `const apiError = error.error as ApiError`.

httpResource errors surface via `.error()` signal and do **not** propagate to `ErrorHandler`. See the httpResource Template Usage section above for the pattern.

## Testing

### Setup

`provideHttpClientTesting()` **must** come after `provideHttpClient()` -- it overrides the real backend:

```ts
TestBed.configureTestingModule({
  providers: [
    provideHttpClient(),
    provideHttpClientTesting(), // AFTER provideHttpClient
  ],
});

const httpTesting = TestBed.inject(HttpTestingController);
```

### Expecting and Flushing Requests

```ts
// Trigger the request
const configPromise = firstValueFrom(service.getConfig());

// Assert the request was made
const req = httpTesting.expectOne('/api/config');
expect(req.request.method).toBe('GET');

// Flush a mock response
req.flush({ apiUrl: 'https://api.example.com' });
expect(await configPromise).toEqual({ apiUrl: 'https://api.example.com' });

// Verify no outstanding requests
httpTesting.verify();
```

`expectOne` also accepts an object: `expectOne({ method: 'GET', url: '/api/config' })`.

Use `match()` for multiple matching requests, `expectNone()` to assert no requests match.

### Testing Error Responses

```ts
// Backend error (server returned error status)
const req = httpTesting.expectOne('/api/config');
req.flush('Not Found', { status: 404, statusText: 'Not Found' });

// Network error (request never reached server)
const req2 = httpTesting.expectOne('/api/config');
req2.error(new ProgressEvent('network error'));
```

### Testing Interceptors

Register with `withInterceptors` in TestBed, then assert the interceptor modified the request:

```ts
TestBed.configureTestingModule({
  providers: [AuthService, provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
});
const req = httpTesting.expectOne('/api/data');
expect(req.request.headers.get('Authorization')).toMatch(/^Bearer /);
```

### Testing httpResource

Use `TestBed.tick()` to trigger the effect, then `ApplicationRef.whenStable()` to await value propagation:

```ts
const id = signal(0);
const response = httpResource(() => `/data/${id()}`, { injector: TestBed.inject(Injector) });
TestBed.tick();
mockBackend.expectOne('/data/0').flush({ name: 'Test' });
await TestBed.inject(ApplicationRef).whenStable();
expect(response.value()).toEqual({ name: 'Test' });
```

### Verify in afterEach

Move `httpTesting.verify()` to `afterEach` to catch unexpected requests across all tests.
