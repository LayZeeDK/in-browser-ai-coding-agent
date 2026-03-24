# Defining Dependency Providers

Angular offers automatic and manual ways to provide dependencies to its Dependency Injection (DI) system.

## Automatic Provision

The most common way to provide a service is using `providedIn: 'root'` on an `@Injectable()`.

### InjectionToken

Use `InjectionToken` for non-class dependencies (configuration objects, functions, primitives). An `InjectionToken` with a `factory` is `providedIn: 'root'` by default.

```ts
import { InjectionToken } from '@angular/core';

export interface AppConfig {
  apiUrl: string;
}

export const APP_CONFIG = new InjectionToken<AppConfig>('app.config', {
  providedIn: 'root',
  factory: () => ({ apiUrl: 'https://api.example.com' }),
});
```

## Manual Provision

Use the `providers` array when a service lacks `providedIn`, when you want a new instance for a specific component, or when configuring runtime values.

```ts
@Component({
  providers: [
    // Shorthand for { provide: LocalService, useClass: LocalService }
    LocalService,

    // useClass: Swap implementations
    { provide: Logger, useClass: BetterLogger },

    // useValue: Provide static values
    { provide: API_URL_TOKEN, useValue: 'https://api.example.com' },

    // useFactory: Generate value dynamically
    {
      provide: ApiClient,
      useFactory: (http = inject(HttpClient)) => new ApiClient(http),
    },

    // useExisting: Create an alias
    { provide: OldLogger, useExisting: NewLogger },

    // multi: Provide multiple values for the same token as an array
    { provide: INTERCEPTOR_TOKEN, useClass: AuthInterceptor, multi: true },
  ],
})
export class Example {}
```

## Scopes of Providers

- **Application Bootstrap**: Global singletons. Use for HTTP clients, logging, or app-wide config.
- **Component/Directive**: Isolated instances. Use for component-specific state or forms. Services are destroyed when the component is destroyed.
- **Route**: Feature-specific services loaded only with specific routes.

## `makeEnvironmentProviders`

Wraps a provider array into `EnvironmentProviders`. Angular throws at runtime if these are accidentally placed in a component's `providers` array. Use this whenever creating `provide*` functions for app-level or route-level configuration.

```ts
import { makeEnvironmentProviders } from '@angular/core';

export function provideAnalytics(config: AnalyticsConfig): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: ANALYTICS_CONFIG, useValue: config }, AnalyticsService]);
}
```

## App Initialization

### Pre-bootstrap config loading (preferred for remote config)

Load config before `bootstrapApplication` and pass it as a static `useValue` provider. This guarantees the config is always available — no mutable module-scope variables, no nullish checks, no race conditions.

```ts
// main.ts
const config: AppConfig = await fetch('/api/config').then((r) => r.json());

bootstrapApplication(App, {
  providers: [{ provide: APP_CONFIG, useValue: config }],
});
```

This defers bootstrapping until the fetch completes, but every service and component can inject `APP_CONFIG` with full type safety and no null handling.

### `provideAppInitializer` (Angular 19+)

Registers a function that Angular awaits before rendering. Replaces the deprecated `APP_INITIALIZER` multi token. The function runs in an injection context, so `inject()` works directly. Best for side-effect initialization (analytics, logging) rather than config loading.

```ts
import { provideAppInitializer, inject } from '@angular/core';

provideAppInitializer(() => {
  const analytics = inject(AnalyticsService);
  analytics.initialize();
});
```

### `provideEnvironmentInitializer` (Angular 19+)

Registers a synchronous callback that fires when an `EnvironmentInjector` is created. Replaces the deprecated `ENVIRONMENT_INITIALIZER` multi token. Use for lazy-loaded route setup. Wrap with `makeEnvironmentProviders` when creating reusable `provide*` functions.

```ts
import { makeEnvironmentProviders, provideEnvironmentInitializer, inject } from '@angular/core';

export function provideFeatureLogging(context: string): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      inject(LoggingService).initialize(context);
    }),
  ]);
}

// In route config:
export const featureRoutes: Routes = [
  {
    path: 'dashboard',
    providers: [provideFeatureLogging('DashboardModule')],
    loadChildren: () => import('./dashboard/dashboard.routes'),
  },
];
```

The callback is **not** awaited — it must be synchronous. For async setup at the route level, use `provideAppInitializer` in the route's `providers` array.

## Library Pattern: `provide*` Functions

Library authors should export `provide*` functions that return `EnvironmentProviders` via `makeEnvironmentProviders()`. This follows Angular's own patterns (`provideRouter`, `provideHttpClient`).
