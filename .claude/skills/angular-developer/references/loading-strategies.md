# Route Loading Strategies

Angular supports eager loading, lazy loading, and preloading to balance initial load time and navigation responsiveness.

## Eager Loading

Components are bundled into the initial JavaScript payload and are available immediately.

```ts
{ path: 'home', component: Home }
```

- **Pros**: Seamless transitions, no loading delay.
- **Cons**: Increases initial bundle size.

## Lazy Loading

Components or routes are loaded only when the user navigates to them. This creates separate JavaScript "chunks".

### Lazy Loading Components

Use `loadComponent` to fetch the component on demand. If the file uses a `default` export, return the `import()` directly without `.then()`.

```ts
{
  path: 'admin',
  loadComponent: () => import('./admin/admin.component'),
}
```

### Lazy Loading Child Routes

Use `loadChildren` to fetch a set of routes.

```ts
{
  path: 'settings',
  loadChildren: () => import('./settings/settings.routes'),
}
```

## Preloading Strategies

Preloading downloads lazy chunks in the background after the initial navigation completes, so subsequent navigations are instant without increasing the initial bundle.

Configure with `withPreloading()` in `provideRouter`:

```ts
import { provideRouter, withPreloading, PreloadAllModules } from '@angular/router';

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes, withPreloading(PreloadAllModules))],
};
```

### Built-in Strategies

| Strategy            | Behavior                                          |
| ------------------- | ------------------------------------------------- |
| `NoPreloading`      | **(Default)** Chunks load only on navigation      |
| `PreloadAllModules` | All lazy chunks download after initial navigation |

### Custom Preloading Strategy

Implement `PreloadingStrategy` to selectively preload routes based on route data:

```ts
@Injectable()
export class SelectivePreloadingStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<any>): Observable<any> {
    return route.data?.['preload'] ? load() : of(null);
  }
}
```

Mark routes for preloading:

```ts
{
  path: 'dashboard',
  loadChildren: () => import('./dashboard/dashboard.routes'),
  data: { preload: true },
}
```

Register the strategy:

```ts
provideRouter(routes, withPreloading(new SelectivePreloadingStrategy()));
```

## Injection Context and Lazy Loading

Loader functions run within the **injection context** of the current route. This allows you to call `inject()` to make context-aware loading decisions.

```ts
{
  path: 'dashboard',
  loadComponent: () => {
    const flags = inject(FeatureFlags);
    return flags.isPremium
      ? import('./premium-dashboard')
      : import('./basic-dashboard');
  },
}
```

## Recommendation

- **Eager load** primary landing pages.
- **Lazy load** all other feature areas.
- **Preload** features users are likely to visit (use `PreloadAllModules` for dashboard-style apps, a custom strategy for apps with many rarely-visited routes).
