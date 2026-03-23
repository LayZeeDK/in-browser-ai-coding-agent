# Performance

Angular includes many optimizations out of the box. As applications grow, fine-tune both loading speed and runtime responsiveness using these techniques.

For the full guide, see the [Angular Performance documentation](https://angular.dev/best-practices/performance).

## Loading Performance

### Lazy-Loaded Routes

Defer loading route components until navigation using `loadComponent` and `loadChildren`:

```ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login-page'),
  },
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin.component'),
    loadChildren: () => import('./admin/admin.routes'),
  },
];
```

### Deferred Loading with `@defer`

Split components into separate bundles that load on demand. Use triggers to control when loading starts:

```html
@defer (on viewport) {
<app-heavy-chart [data]="chartData" />
} @placeholder {
<div class="chart-skeleton"></div>
} @loading (minimum 300ms) {
<app-spinner />
} @error {
<p>Failed to load chart.</p>
}
```

Available triggers:

- `on idle` — when the browser is idle (default)
- `on viewport` — when the placeholder enters the viewport
- `on hover` — when the user hovers over the placeholder
- `on interaction` — when the user clicks/focuses the placeholder
- `on timer(duration)` — after a specified delay
- `when condition` — when a boolean expression becomes true

**Prefetching**: Load the bundle early but delay rendering:

```html
@defer (on interaction; prefetch on idle) {
<app-modal />
}
```

### Image Optimization

Use `NgOptimizedImage` for automatic image optimization:

```ts
import { NgOptimizedImage } from '@angular/common';

@Component({
  imports: [NgOptimizedImage],
  template: `
    <!-- LCP image: set priority for above-the-fold images -->
    <img ngSrc="hero.jpg" width="1200" height="600" priority />

    <!-- Below-the-fold: automatically lazy-loaded -->
    <img ngSrc="gallery-1.jpg" width="400" height="300" />

    <!-- Fill mode: image fills its container -->
    <img ngSrc="background.jpg" fill />
  `,
})
export class HeroSection {}
```

Key features:

- `priority` attribute for LCP images (disables lazy loading, adds `fetchpriority="high"`)
- Automatic `loading="lazy"` for non-priority images
- Automatic `srcset` generation with configured image loaders
- Build-time warnings for missing `width`/`height` or missing `priority` on LCP candidates

### Server-Side Rendering (SSR)

SSR renders pages on the server for faster first paint and better SEO. Angular supports full hydration and incremental hydration:

```ts
// app.config.ts
import { provideClientHydration, withIncrementalHydration } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [provideClientHydration(withIncrementalHydration())],
};
```

Incremental hydration defers hydrating sections of the page until needed, combining SSR benefits with `@defer` efficiency.

## Runtime Performance

### Zoneless Change Detection

Angular v21+ defaults to zoneless change detection, removing ZoneJS overhead. Change detection triggers only when signals change or events fire:

```ts
import { provideZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection()],
};
```

For existing zone-based apps migrating to zoneless, see the [Zoneless guide](https://angular.dev/guide/zoneless).

### OnPush Change Detection

For zone-based applications, use `OnPush` to skip unchanged component subtrees:

```ts
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  // ...
})
export class DataGrid {
  readonly data = input.required<Row[]>();
}
```

With `OnPush`, Angular only checks a component when:

- An input reference changes
- An event handler fires within the component
- An `AsyncPipe` receives a new value
- A signal read in the template changes

### Optimizing Slow Computations

Use `computed()` to cache expensive derivations:

```ts
// Expensive filtering runs only when dependencies change
protected filteredItems = computed(() =>
  this.items().filter((item) => item.category === this.selectedCategory()),
);
```

For very heavy computations, move them off the main thread with `@defer`:

```html
@defer (on viewport) {
<app-complex-visualization [data]="largeDataset()" />
}
```

### Zone Pollution (Zone-Based Apps)

In zone-based applications, third-party libraries or browser APIs (timers, WebSocket) can trigger unnecessary change detection. Run them outside Angular's zone:

```ts
export class StreamingService {
  private ngZone = inject(NgZone);

  startStream() {
    this.ngZone.runOutsideAngular(() => {
      this.socket = new WebSocket('wss://data.example.com');
      this.socket.onmessage = (msg) => {
        // Process without triggering change detection
        this.buffer.push(msg.data);
      };
    });
  }
}
```

## Measuring Performance

### Chrome DevTools Angular Track

Angular integrates with Chrome DevTools Performance panel. The Angular-specific track shows:

- Component rendering times
- Change detection cycles
- Lifecycle hook execution

See [Profiling with Chrome DevTools](https://angular.dev/best-practices/profiling-with-chrome-devtools) for setup.

### Angular DevTools

The [Angular DevTools](https://angular.dev/tools/devtools) browser extension provides:

- Component tree inspector
- Change detection cycle profiler
- Dependency injection viewer

## What to Optimize First

1. **Slow initial load**: Use `@defer` to split large components, `NgOptimizedImage` for above-the-fold images, and SSR for faster first paint.
2. **Slow interactions after load**: Enable zoneless change detection, look for slow computations in templates, and use `OnPush` to reduce unnecessary change detection.
3. **Profile first**: Use the Chrome DevTools Angular track to identify specific bottlenecks before optimizing.
