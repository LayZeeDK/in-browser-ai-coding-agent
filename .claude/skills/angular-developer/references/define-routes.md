# Define Routes

Routes are objects that define which component should render for a specific URL path.

## Basic Configuration

Define routes in a `Routes` array and provide them using `provideRouter` in your `appConfig`.

```ts
// app.routes.ts
export const routes: Routes = [
  { path: '', component: HomePage },
  { path: 'admin', component: AdminPage },
];

// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes)],
};
```

## `provideRouter` Feature Functions

`provideRouter` accepts optional feature functions after the routes array:

| Feature Function                | Purpose                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| `withComponentInputBinding()`   | Bind route params, query params, and resolved data to component `input()`  |
| `withPreloading(strategy)`      | Configure preloading strategy (e.g., `PreloadAllModules`)                  |
| `withViewTransitions(options?)` | Enable View Transitions API for route animations                           |
| `withDebugTracing()`            | Log all router events to console for debugging                             |
| `withHashLocation()`            | Use hash-based URLs (`/#/path`) instead of HTML5 pushState                 |
| `withRouterConfig(options)`     | Configure router behavior (see [router-lifecycle.md](router-lifecycle.md)) |

```ts
provideRouter(routes, withComponentInputBinding(), withPreloading(PreloadAllModules), withViewTransitions());
```

## URL Paths

- **Static**: Matches an exact string (e.g., `'admin'`).
- **Route Parameters**: Dynamic segments prefixed with a colon (e.g., `'user/:id'`). Names must start with a letter and can contain letters, numbers, `_`, and `-`.
- **Wildcard**: Matches any URL using `**`. Useful for "Not Found" pages. **Always place at the end of the array.**

## Matching Strategy

Angular uses a **first-match wins** strategy. Specific routes must come before less specific ones.

```ts
const routes: Routes = [
  { path: '', component: Home }, // Empty path
  { path: 'users/new', component: NewUser }, // Static, most specific
  { path: 'users/:id', component: UserDetail }, // Dynamic
  { path: 'users', component: Users }, // Static, less specific
  { path: '**', component: NotFound }, // Wildcard - always last
];
```

## Redirects and `pathMatch`

Use `redirectTo` to point one path to another. The `pathMatch` property controls how the path is matched:

| Value      | Behavior                                                |
| ---------- | ------------------------------------------------------- |
| `'prefix'` | **(Default)** Matches if the URL _starts with_ the path |
| `'full'`   | Matches only if the _entire_ URL equals the path        |

**Common pitfall**: `{ path: '', redirectTo: 'home' }` redirects _every_ URL because the empty string is a prefix of everything. Fix with `pathMatch: 'full'`:

```ts
// BAD: redirects /about, /settings, everything
{ path: '', redirectTo: 'home' }

// GOOD: only redirects the root URL (/) to /home
{ path: '', redirectTo: 'home', pathMatch: 'full' }
```

`pathMatch: 'prefix'` is useful for renaming route hierarchies:

```ts
// /news, /news/article, /news/article/123 all redirect to /blog equivalents
{ path: 'news', redirectTo: 'blog' }
```

### Conditional Redirects

`redirectTo` also accepts a `RedirectFunction` for dynamic logic:

```ts
{
  path: 'menu',
  redirectTo: (route) => {
    const hour = new Date().getHours();
    return hour < 11 ? '/menu/breakfast' : '/menu/lunch';
  },
}
```

## Page Titles

Associate titles with routes for accessibility. Titles can be static or dynamic (via `ResolveFn` or a custom `TitleStrategy`).

```ts
{ path: 'home', component: Home, title: 'Home Page' }
```

## Route Data and Providers

- **Static Data**: Attach metadata using the `data` property.
- **Route Providers**: Scope dependencies to a specific route and its children using the `providers` array.

## Nested (Child) Routes

Define sub-views using the `children` property. Parent components must include a `<router-outlet />`.

```ts
{
  path: 'product/:id',
  component: Product,
  children: [
    { path: 'info', component: ProductInfo },
    { path: 'reviews', component: ProductReviews },
  ],
}
```
