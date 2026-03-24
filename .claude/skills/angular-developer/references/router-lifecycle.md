# Router Lifecycle and Events

Angular Router emits events through the `Router.events` observable, allowing you to track the navigation lifecycle from start to finish.

## Navigation Events (Chronological)

1. **`NavigationStart`**: Navigation begins.
2. **`RouteConfigLoadStart` / `End`**: Lazy route configuration loading.
3. **`RoutesRecognized`**: Router matches the URL to a route.
4. **`GuardsCheckStart` / `End`**: Evaluation of `canActivate`, `canMatch`, etc.
5. **`ResolveStart` / `End`**: Data resolution phase (fetching data via resolvers).
6. **`ActivationStart` / `End`**: Route activation phase.

### Terminal Events

Every navigation ends with exactly one of these:

| Event                   | When                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| **`NavigationEnd`**     | Navigation completed successfully                                                                              |
| **`NavigationCancel`**  | Guard returned `false`, or redirect via `UrlTree`/`RedirectCommand`                                            |
| **`NavigationError`**   | Error in resolver or route loading                                                                             |
| **`NavigationSkipped`** | Router decided navigation was unnecessary (e.g., same-URL navigation when `onSameUrlNavigation` is `'ignore'`) |

**`NavigationSkipped` pitfall**: If you show a spinner on `NavigationStart` but only hide it on `NavigationEnd`, clicking a link to the current page leaves the spinner stuck. Always handle all four terminal events.

## Subscribing to Events

```ts
import { Router, NavigationStart, NavigationEnd } from '@angular/router';

export class MyService {
  private router = inject(Router);

  constructor() {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        console.log('Navigated to:', event.url);
      });
  }
}
```

## `NavigationCancel` Codes

Distinguish _why_ a navigation was cancelled using `NavigationCancellationCode`:

```ts
import { NavigationCancel, NavigationCancellationCode } from '@angular/router';

if (event instanceof NavigationCancel) {
  if (event.code === NavigationCancellationCode.GuardRejected) {
    // Guard returned false or redirected
  }
}
```

## Debugging

Enable detailed console logging of all routing events:

```ts
provideRouter(routes, withDebugTracing());
```

## `withRouterConfig()` Options

Fine-tune router behavior via `withRouterConfig()`:

| Option                         | Values                                 | Default       | Purpose                                                   |
| ------------------------------ | -------------------------------------- | ------------- | --------------------------------------------------------- |
| `onSameUrlNavigation`          | `'ignore'` / `'reload'`                | `'ignore'`    | Whether to re-run guards/resolvers on same-URL navigation |
| `paramsInheritanceStrategy`    | `'emptyOnly'` / `'always'`             | `'emptyOnly'` | Whether child routes inherit parent params                |
| `urlUpdateStrategy`            | `'deferred'` / `'eager'`               | `'deferred'`  | When browser URL bar updates during navigation            |
| `canceledNavigationResolution` | `'replace'` / `'computed'`             | `'replace'`   | How to restore history on cancelled navigation            |
| `defaultQueryParamsHandling`   | `'replace'` / `'merge'` / `'preserve'` | `'replace'`   | Default for `Router.createUrlTree`                        |

```ts
provideRouter(
  routes,
  withRouterConfig({
    onSameUrlNavigation: 'reload',
    paramsInheritanceStrategy: 'always',
  }),
);
```

## Common Use Cases

- **Loading Indicators**: Show spinner on `NavigationStart`, hide on all terminal events.
- **Analytics**: Track page views on `NavigationEnd`.
- **Scroll Management**: Respond to `Scroll` events for custom scroll behavior.
- **Error Handling**: Show error banners on `NavigationError`, check `NavigationCancellationCode` on `NavigationCancel`.
