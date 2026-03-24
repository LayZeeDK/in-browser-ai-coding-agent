# Navigate to Routes

Angular provides both declarative and programmatic ways to navigate between routes.

## Declarative Navigation (`RouterLink`)

Use the `RouterLink` directive on anchor elements.

```ts
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav>
      <a routerLink="/dashboard" routerLinkActive="active-link">Dashboard</a>
      <a [routerLink]="['/user', userId]">Profile</a>
    </nav>
  `,
})
export class Nav {
  userId = '123';
}
```

- **Absolute Paths**: Start with `/` (e.g., `/settings`).
- **Relative Paths**: No leading `/`. Use `../` to go up a level, `['..', 'list']` for sibling routes.

## Programmatic Navigation (`Router`)

Inject the `Router` service to navigate via TypeScript code.

### `router.navigate()`

Uses an array of commands.

```ts
private router = inject(Router);
private route = inject(ActivatedRoute);

// Absolute navigation
this.router.navigate(['/profile']);

// With query parameters and fragment
this.router.navigate(['/search'], {
  queryParams: { q: 'angular' },
  fragment: 'results',
});

// Relative navigation (requires relativeTo)
this.router.navigate(['edit'], { relativeTo: this.route });

// Navigate to parent
this.router.navigate(['..'], { relativeTo: this.route });
```

### `router.navigateByUrl()`

Uses a string path. Ideal for absolute navigation or full URLs.

```ts
this.router.navigateByUrl('/products/123?view=details');
```

### `NavigationExtras` Options

Both `navigate()` and `navigateByUrl()` accept options:

| Option                | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `replaceUrl`          | Replace current history entry (user cannot press Back to return)  |
| `skipLocationChange`  | Navigate without updating the browser URL                         |
| `browserUrl`          | Display a different URL in the address bar than the actual route  |
| `state`               | Attach arbitrary data to the `History.state` object               |
| `queryParams`         | Set query parameters (`navigate()` only)                          |
| `fragment`            | Set URL fragment (`navigate()` only)                              |
| `relativeTo`          | Base `ActivatedRoute` for relative navigation (`navigate()` only) |
| `onSameUrlNavigation` | Per-navigation override: `'ignore'` or `'reload'`                 |

```ts
// Replace history entry (e.g., after login redirect)
this.router.navigateByUrl('/dashboard', { replaceUrl: true });

// Display different URL in address bar
this.router.navigateByUrl('/not-found', { browserUrl: '/products/missing-item' });

// Attach state for the destination component
this.router.navigate(['/checkout'], { state: { fromCart: true } });
```

## Binding Route Data to Component Inputs

Instead of injecting `ActivatedRoute`, enable `withComponentInputBinding()` in `provideRouter` to pass route params, query params, and resolved data directly to component `input()` properties by name. See [data-resolvers.md](data-resolvers.md) for setup and examples.

## URL Parameters

- **Route Params**: Part of the path (e.g., `/user/123`).
- **Query Params**: After the `?` (e.g., `/search?q=query`).
- **Matrix Params**: Scoped to a segment (e.g., `/products;category=books`).
