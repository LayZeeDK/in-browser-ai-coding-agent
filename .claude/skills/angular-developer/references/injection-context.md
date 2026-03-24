# Injection Context

The `inject()` function can only be used when code is executing within an **injection context**.

## Where is an Injection Context Available?

An injection context is automatically available in:

1. **Field initializers** of classes instantiated by DI (`@Injectable`, `@Component`, `@Directive`, `@Pipe`).
2. **Constructors** of classes instantiated by DI.
3. **Factory functions** specified in `useFactory` or `InjectionToken` configurations.
4. **Functional APIs** executed by Angular (e.g., functional route guards, resolvers, interceptors).
5. **Stack frames** invoked via `runInInjectionContext`.

```ts
@Component({...})
export class Example {
  // Field initializer — injection context exists
  private router = inject(Router);

  constructor() {
    // Constructor body — injection context exists
    const http = inject(HttpClient);
  }

  onClick() {
    // Event handler — NOT an injection context
    // inject(AuthService); // throws NG0203
  }
}
```

## `runInInjectionContext`

Run a function inside an injection context when you are outside one (e.g., in a callback, timer, or method called later). Requires an existing injector.

```ts
import { inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MyService {
  private injector = inject(EnvironmentInjector);

  doSomethingLater() {
    runInInjectionContext(this.injector, () => {
      const router = inject(Router);
    });
  }
}
```

## `assertInInjectionContext`

Use in utility functions to guarantee callers are in a valid context. Throws a clear `NG0203` error with the function name if not.

```ts
import { assertInInjectionContext, inject, ElementRef } from '@angular/core';

export function injectNativeElement<T extends Element>(): T {
  assertInInjectionContext(injectNativeElement);
  return inject(ElementRef).nativeElement;
}
```

## `DestroyRef` — Lifecycle Cleanup via DI

`DestroyRef` lets you register cleanup callbacks tied to a component, directive, or service's destruction — without implementing `OnDestroy`. Inject it within an injection context.

```ts
import { Component, inject, DestroyRef } from '@angular/core';

@Component({...})
export class Example {
  private destroyRef = inject(DestroyRef);

  constructor() {
    const handler = (e: Event) => { /* ... */ };
    document.addEventListener('visibilitychange', handler);

    // Cleanup when component is destroyed — no ngOnDestroy needed
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', handler);
    });
  }
}
```

Use `DestroyRef.onDestroy()` for **non-RxJS cleanup**: DOM listeners, timers, third-party library teardown.

### `takeUntilDestroyed` — RxJS Cleanup

For **RxJS subscriptions**, use `takeUntilDestroyed()` from `@angular/core/rxjs-interop`. It completes the observable when the owning context is destroyed.

**Inside injection context** (field initializer or constructor) — no argument needed:

```ts
import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({...})
export class Dashboard {
  private dataService = inject(DataService);

  constructor() {
    this.dataService.liveUpdates$
      .pipe(takeUntilDestroyed())
      .subscribe(data => this.handleUpdate(data));
  }
}
```

**Outside injection context** (service method, callback) — pass `DestroyRef` explicitly:

```ts
@Injectable({ providedIn: 'root' })
export class JsonStreamService {
  connect(destroyRef: DestroyRef): Observable<JsonData> {
    return this.rawStream$.pipe(
      takeUntilDestroyed(destroyRef)
    );
  }
}

// In the component:
@Component({...})
export class StreamViewer {
  private destroyRef = inject(DestroyRef);
  private streamService = inject(JsonStreamService);

  data$ = this.streamService.connect(this.destroyRef);
}
```

### When to Use Which

These patterns are **either-or** — do not combine them for the same cleanup concern.

| Pattern                          | Use When                                                            |
| -------------------------------- | ------------------------------------------------------------------- |
| `takeUntilDestroyed()`           | RxJS subscription in injection context (constructor/field)          |
| `takeUntilDestroyed(destroyRef)` | RxJS subscription outside injection context                         |
| `DestroyRef.onDestroy(fn)`       | **Non-RxJS** cleanup only (DOM listeners, timers, third-party libs) |

For RxJS cleanup, use `takeUntilDestroyed` — do **not** also add `DestroyRef.onDestroy()`. The operator already registers an `onDestroy` callback internally. Using both is redundant.
