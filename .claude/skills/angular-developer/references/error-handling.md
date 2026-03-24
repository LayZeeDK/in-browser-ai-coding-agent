# Error Handling

Angular provides mechanisms for handling errors that are not explicitly caught by application code. Prefer handling errors at the callsite where they occur.

For the full guide, see the [Angular Error Handling documentation](https://angular.dev/best-practices/error-handling).

## Error Handling Strategy

Handle errors as close to their origin as possible:

```ts
export class UserService {
  private http = inject(HttpClient);

  getUser(id: string) {
    return this.http.get<User>(`/api/users/${id}`).pipe(
      catchError((error) => {
        console.error('Failed to fetch user:', error);

        return of(null);
      }),
    );
  }
}
```

## ErrorHandler

Angular reports unhandled errors to the application's root `ErrorHandler`. Create a custom one for logging and analytics:

```ts
import { ErrorHandler, Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly router = inject(Router);

  handleError(error: unknown) {
    const url = this.router.url;
    const errorMessage = (error as Error)?.message ?? 'unknown';
    this.analyticsService.trackEvent({
      eventName: 'exception',
      description: `Screen: ${url} | ${errorMessage}`,
    });
    console.error('Unhandled error:', error);
  }
}
```

Provide it in your application config alongside `provideBrowserGlobalErrorListeners()`:

```ts
import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [{ provide: ErrorHandler, useClass: GlobalErrorHandler }, provideBrowserGlobalErrorListeners()],
};
```

## When Angular Catches Errors

Angular catches errors from:

- Component constructors and lifecycle methods
- Template event handlers
- `AsyncPipe` observable/promise errors
- `PendingTasks.run` failures

Angular does **not** catch errors from:

- Service methods called directly by your code (use `try...catch` or RxJS `catchError`)
- `resource()` and `httpResource()` errors (exposed via `.status()` and `.error()` signals instead -- see [http-client.md](http-client.md) for `httpResource` error patterns)

## Global Error Listeners

### Browser (CSR)

`provideBrowserGlobalErrorListeners()` catches `'error'` and `'unhandledrejection'` events at the window level. The Angular CLI includes it by default in new applications. Wire it alongside the custom ErrorHandler as shown above.

### Server (SSR)

Angular automatically adds `'unhandledRejection'` and `'uncaughtException'` listeners to the server process to prevent crashes.

## TestBed Error Behavior

By default, `TestBed` rethrows unhandled errors so they are not silently ignored in tests. To disable this for specific error-handling tests:

```ts
TestBed.configureTestingModule({
  rethrowApplicationErrors: false,
});
```

## Best Practices

- Handle errors at the callsite using `try...catch` or RxJS `catchError`.
- Use `ErrorHandler` as a last resort for logging unexpected errors, not as a primary error handling mechanism.
- The `resource()` API exposes errors via `status` and `error` properties rather than throwing.
- Add `provideBrowserGlobalErrorListeners()` to catch errors that escape both application code and Angular's framework handling.
