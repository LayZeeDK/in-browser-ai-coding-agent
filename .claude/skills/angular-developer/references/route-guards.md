# Route Guards

Route guards control whether a user can navigate to or leave a route.

## Types of Guards

| Guard              | Question it answers                                                    | On `false`                                   |
| ------------------ | ---------------------------------------------------------------------- | -------------------------------------------- |
| `CanActivate`      | Can the user access this route? (e.g., auth check)                     | Blocks navigation entirely                   |
| `CanActivateChild` | Can the user access children of this route?                            | Blocks navigation entirely                   |
| `CanDeactivate`    | Can the user leave this route? (e.g., unsaved changes)                 | Blocks navigation entirely                   |
| `CanMatch`         | Should this route be considered during matching? (e.g., feature flags) | Router **falls through** to try other routes |

**When to use `CanMatch` vs `CanActivate`**: Use `CanMatch` when you want the router to skip this route definition and try the next matching route (e.g., showing different components for the same path based on user role). Use `CanActivate` when you want to block navigation entirely or redirect.

```ts
// CanMatch: same path, different components based on role
const routes: Routes = [
  { path: 'dashboard', component: AdminDashboard, canMatch: [adminGuard] },
  { path: 'dashboard', component: UserDashboard }, // fallback if adminGuard returns false
];
```

## Creating a Guard

Guards are typically functional since Angular 15.

```ts
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isLoggedIn()) {
    return true;
  }

  // Redirect to login using RedirectCommand
  return new RedirectCommand(router.parseUrl('/login'), {
    replaceUrl: true,
  });
};
```

## `RedirectCommand` vs `UrlTree`

Both redirect the user, but `RedirectCommand` wraps a `UrlTree` with `NavigationBehaviorOptions`:

```ts
// Old approach: bare UrlTree (no control over navigation behavior)
return router.parseUrl('/login');

// Modern approach: RedirectCommand with NavigationBehaviorOptions
return new RedirectCommand(router.parseUrl('/login'), {
  replaceUrl: true, // prevent Back button returning to guarded route
  skipLocationChange: true, // keep original URL in address bar (rare)
});
```

Prefer `RedirectCommand` when you need `replaceUrl` or `skipLocationChange`. A bare `UrlTree` still works for simple redirects.

## Applying Guards

Add them to the route configuration as an array. They execute in order.

```ts
{
  path: 'admin',
  component: Admin,
  canActivate: [authGuard, adminRoleGuard],
  canDeactivate: [unsavedChangesGuard],
}
```

## Composing Multiple Guards

Guards in the array execute sequentially. If any guard returns `false`, a `UrlTree`, or a `RedirectCommand`, the remaining guards are skipped.

```ts
// Both must pass: first checks auth, then checks admin role
canActivate: [authGuard, adminRoleGuard];
```

## Return Values

- `boolean`: `true` to allow, `false` to block.
- `UrlTree` or `RedirectCommand`: Redirect to a different route.
- `Observable` or `Promise`: Resolves to the above types. The router uses the first emitted value and unsubscribes.

## Security Note

**Client-side guards are NOT a substitute for server-side security.** Always verify permissions on the server.
