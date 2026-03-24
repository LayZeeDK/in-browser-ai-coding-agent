# Rendering Strategies

Angular supports multiple rendering strategies to optimize for SEO, performance, and interactivity.

## 1. Client-Side Rendering (CSR)

**Default Strategy.** Content is rendered entirely in the browser.

- **Use case**: Interactive dashboards, internal tools.
- **Pros**: Simplest to configure, low server cost.
- **Cons**: Poor SEO, slower initial content visibility (must wait for JS).

## 2. Static Site Generation (SSG / Prerendering)

Content is pre-rendered into static HTML files at **build time**.

- **Use case**: Marketing pages, blogs, documentation.
- **Pros**: Fastest initial load, excellent SEO, CDN-friendly.
- **Cons**: Requires rebuild for content updates, not for user-specific data.

## 3. Server-Side Rendering (SSR)

Content is rendered on the server for the **initial request**. Subsequent navigations happen client-side (SPA style).

- **Use case**: E-commerce product pages, news sites, personalized dynamic content.
- **Pros**: Excellent SEO, fast initial content visibility.
- **Cons**: Requires a server (Node.js), higher server cost/latency.

## Hydration

Hydration is the process of making server-rendered HTML interactive in the browser.

- **Full Hydration**: The entire app becomes interactive at once. Enable with `provideClientHydration()` in your app config (see [performance.md](performance.md) for setup).
- **Incremental Hydration**: Parts become interactive as needed using `@defer` blocks. Reduces the amount of JavaScript executed on page load.
- **Event Replay**: Captures and replays user events that happened before hydration finished. Enable with `withEventReplay()` inside `provideClientHydration()`.

```ts
// app.config.ts (SSR hydration setup)
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes), provideClientHydration(withEventReplay())],
};
```

## Decision Matrix

| Requirement                     | Strategy             |
| :------------------------------ | :------------------- |
| **SEO + Static Content**        | SSG                  |
| **SEO + Dynamic Content**       | SSR                  |
| **No SEO + High Interactivity** | CSR                  |
| **Mixed**                       | Hybrid (Route-based) |
