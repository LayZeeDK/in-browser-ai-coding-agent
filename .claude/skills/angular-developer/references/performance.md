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

**Context-aware lazy loading**: The router executes loader functions within the injection context of the current route, so you can use `inject()` inside them:

```ts
export const routes: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => {
      const flags = inject(FeatureFlags);

      return flags.isPremium ? import('./dashboard/premium-dashboard') : import('./dashboard/basic-dashboard');
    },
  },
];
```

**When to use eager vs lazy**: Eager load primary landing pages. Lazy load other routes. Avoid deeply nested lazy loading as each navigation adds a network request.

See the [Lazy-loaded routes guide](https://angular.dev/best-practices/performance/lazy-loaded-routes).

### Deferred Loading with `@defer`

Split components into separate bundles that load on demand. Use triggers to control when loading starts:

```html
@defer (on viewport) {
<app-heavy-chart [data]="chartData" />
} @placeholder {
<div class="chart-skeleton"></div>
} @loading (after 100ms; minimum 1s) {
<app-spinner />
} @error {
<p>Failed to load chart.</p>
}
```

**Requirements for deferred dependencies:**

1. Must be **standalone**. Non-standalone dependencies are still eagerly loaded.
2. Must not be referenced outside the `@defer` block in the same file (otherwise eagerly loaded).

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

The `@placeholder` and `@loading` blocks support `minimum` timing. `@loading` also supports `after` to avoid flashing for fast loads.

See the [Deferred loading guide](https://angular.dev/best-practices/performance/defer).

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

    <!-- Responsive: set sizes for responsive images -->
    <img ngSrc="hero.jpg" width="1200" height="600" sizes="(max-width: 768px) 100vw, 50vw" />

    <!-- Fill mode: image fills its parent container -->
    <img ngSrc="background.jpg" fill />
  `,
})
export class HeroSection {}
```

Key features:

- `priority` attribute for LCP images (disables lazy loading, adds `fetchpriority="high"`, generates preload link in SSR)
- Automatic `loading="lazy"` for non-priority images
- Automatic `srcset` generation with configured image loaders
- Build-time warnings for missing `width`/`height` or missing `priority` on LCP candidates

**Fill mode**: The parent element **must** have `position: relative`, `position: fixed`, or `position: absolute`. Use `object-fit` CSS to control how the image fills its container.

**Image loaders**: Configure a CDN-specific loader for automatic `srcset` generation. Built-in loaders exist for Cloudflare, Cloudinary, ImageKit, Imgix, and Netlify.

See the [Image optimization guide](https://angular.dev/best-practices/performance/image-optimization).

### Server-Side Rendering (SSR)

SSR renders pages on the server for faster first paint and better SEO.

**Setup**:

```bash
ng new --ssr          # New project with SSR
ng add @angular/ssr   # Add SSR to existing project
```

**Server routing**: Configure per-route rendering modes in `app.routes.server.ts`:

```ts
import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Client }, // CSR — interactive landing
  { path: 'about', renderMode: RenderMode.Prerender }, // SSG — static content
  { path: 'profile', renderMode: RenderMode.Server }, // SSR — user-specific data
  { path: '**', renderMode: RenderMode.Server }, // SSR — default
];
```

Register with `provideServerRendering`:

```ts
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes(serverRoutes))],
};
```

**Hydration**: Enable client hydration and incremental hydration to restore interactivity:

```ts
import { provideClientHydration, withIncrementalHydration } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [provideClientHydration(withIncrementalHydration())],
};
```

Incremental hydration defers hydrating sections until needed, combining SSR benefits with `@defer` efficiency.

See the [SSR guide](https://angular.dev/best-practices/performance/ssr).

## Runtime Performance

### Zoneless Change Detection

Angular v21+ defaults to zoneless change detection, removing ZoneJS overhead. Change detection triggers only when signals change or events fire.

For v20, enable explicitly:

```ts
import { provideZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [provideZonelessChangeDetection()],
};
```

**Removing ZoneJS**: After enabling zoneless, remove `zone.js` from `polyfills` in `angular.json` (both `build` and `test` targets), then uninstall:

```bash
npm uninstall zone.js
```

**Compatibility requirements**: Zoneless apps must notify Angular of state changes through:

- Updating signals read in templates
- `ChangeDetectorRef.markForCheck()` (called automatically by `AsyncPipe`)
- `ComponentRef.setInput()`
- Bound host or template listener callbacks

Using `OnPush` on all components is a recommended step toward zoneless compatibility.

See the [Zoneless guide](https://angular.dev/guide/zoneless).

### OnPush Change Detection

Use `OnPush` to skip unchanged component subtrees during change detection:

```ts
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataGrid {
  readonly data = input.required<Row[]>();
}
```

With `OnPush`, Angular only checks a component when:

- An input **reference** changes (object mutation alone is not detected)
- An event handler fires within the component or its children
- An `AsyncPipe` receives a new value
- A signal read in the template changes
- `ChangeDetectorRef.markForCheck()` is called

**Edge case**: Setting inputs via `@ViewChild` in TypeScript does not trigger OnPush change detection. Call `markForCheck()` manually in that case.

See the [Skipping subtrees guide](https://angular.dev/best-practices/skipping-subtrees).

### Optimizing Slow Computations

Several techniques for expensive calculations:

1. **`computed()` signals** — cache derived values, recomputed only when dependencies change:

   ```ts
   protected filteredItems = computed(() =>
     this.items().filter((item) => item.category === this.selectedCategory()),
   );
   ```

2. **Pure pipes** — Angular only re-evaluates when inputs change:

   ```ts
   @Pipe({ name: 'filterByCategory' })
   export class FilterByCategoryPipe implements PipeTransform {
     transform(items: Item[], category: string): Item[] {
       return items.filter((item) => item.category === category);
     }
   }
   ```

3. **Avoid repaints/reflows in lifecycle hooks** — operations that trigger synchronous layout recalculation (reading `offsetHeight`, `getBoundingClientRect()`) are expensive inside change detection cycles.

4. **`@defer`** — move heavy components out of the initial render:
   ```html
   @defer (on viewport) {
   <app-complex-visualization [data]="largeDataset()" />
   }
   ```

Identify slow components using Angular DevTools' profiler timeline.

See the [Slow computations guide](https://angular.dev/best-practices/slow-computations).

### Zone Pollution (Zone-Based Apps)

In zone-based applications, third-party libraries or browser APIs (timers, WebSocket) can trigger unnecessary change detection. Run initialization outside Angular's zone:

```ts
export class ChartComponent implements OnInit {
  private ngZone = inject(NgZone);

  ngOnInit() {
    this.ngZone.runOutsideAngular(() => {
      Plotly.newPlot('chart', data);
    });
  }
}
```

**Re-entering the zone**: When outside code needs to trigger Angular updates, use `ngZone.run()`:

```ts
this.ngZone.runOutsideAngular(() => {
  this.socket = new WebSocket('wss://data.example.com');
  this.socket.onmessage = (msg) => {
    // Re-enter the zone to trigger change detection
    this.ngZone.run(() => {
      this.messages.update((msgs) => [...msgs, msg.data]);
    });
  };
});
```

Identify unnecessary change detection calls using Angular DevTools — they appear as consecutive bars triggered by `setTimeout`, `setInterval`, or event handlers from third-party libraries.

See the [Zone pollution guide](https://angular.dev/best-practices/zone-pollution).

## Measuring Performance

### Chrome DevTools Angular Track

Enable Angular profiling in Chrome DevTools:

```ts
import { enableProfiling } from '@angular/core';

// Call before bootstrapping to capture startup events
enableProfiling();
bootstrapApplication(MyApp);
```

Or run `ng.enableProfiling()` in Chrome's console.

The Angular-specific track in the Performance panel uses color-coding:

- **Blue** — TypeScript code (services, constructors, lifecycle hooks)
- **Purple** — Template code (compiled by Angular)
- **Green** — Entry points and reasons for code execution

Use it to identify: which components are slow during change detection, how many synchronization passes occur (more than one suggests state updates during CD), and whether specific lifecycle hooks are bottlenecks.

See the [Chrome DevTools profiling guide](https://angular.dev/best-practices/profiling-with-chrome-devtools).

### Angular DevTools

The [Angular DevTools](https://angular.dev/tools/devtools) browser extension provides:

- Component tree inspector
- Change detection cycle profiler (identify slow components)
- Dependency injection viewer

## What to Optimize First

1. **Slow initial load**: Use `@defer` to split large components, `NgOptimizedImage` for above-the-fold images, and SSR for faster first paint.
2. **Slow interactions after load**: Enable zoneless change detection, look for slow computations in templates, and use `OnPush` to reduce unnecessary change detection.
3. **Profile first**: Use the Chrome DevTools Angular track to identify specific bottlenecks before optimizing.
