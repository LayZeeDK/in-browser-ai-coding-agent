# Angular Routing Documentation (fetched from angular.dev)

Fetched on 2026-03-24 from angular.dev. Contains 10 pages total: the 6 requested pages (with corrected URLs where needed) plus 4 supplementary pages covering topics specifically called out in the gap analysis.

> **Note:** The original URLs `https://angular.dev/guide/routing/router-lifecycle` and `https://angular.dev/guide/routing/route-animations` redirect to the Angular homepage. The correct URLs (from the sidebar navigation) are `https://angular.dev/guide/routing/lifecycle-and-events` and `https://angular.dev/guide/routing/route-transition-animations` respectively.

---

## Table of Contents

1. [Define Routes](#1-define-routes)
2. [Route Loading Strategies](#2-route-loading-strategies)
3. [Navigate to Routes](#3-navigate-to-routes)
4. [Control Route Access with Guards](#4-control-route-access-with-guards)
5. [Lifecycle and Events](#5-lifecycle-and-events)
6. [Route Transition Animations](#6-route-transition-animations)
7. [Redirecting Routes (supplementary)](#7-redirecting-routes)
8. [Router Reference (supplementary)](#8-router-reference)
9. [Other Routing Tasks (supplementary)](#9-other-routing-tasks)
10. [Customizing Route Behavior (supplementary)](#10-customizing-route-behavior)

---

# 1. Define Routes

Source: https://angular.dev/guide/routing/define-routes

## What are routes?

In Angular, a **route** is an object that defines which component should render for a specific URL path or pattern, as well as additional configuration options about what happens when a user navigates to that URL.

Here is a basic example of a route:

```ts
import {AdminPage} from './app-admin';

const adminPage = {
  path: 'admin',
  component: AdminPage,
};
```

For this route, when a user visits the `/admin` path, the app will display the `AdminPage` component.

### Managing routes in your application

Most projects define routes in a separate file that contains `routes` in the filename.

A collection of routes looks like this:

```ts
import {Routes} from '@angular/router';
import {HomePage} from './home-page';
import {AdminPage} from './about-page';

export const routes: Routes = [
  {
    path: '',
    component: HomePage,
  },
  {
    path: 'admin',
    component: AdminPage,
  },
];
```

> **Tip:** If you generated a project with Angular CLI, your routes are defined in `src/app/app.routes.ts`.

### Adding the router to your application

When bootstrapping an Angular application without the Angular CLI, you can pass a configuration object that includes a `providers` array.

Inside of the `providers` array, you can add the Angular router to your application by adding a `provideRouter` function call with your routes.

```ts
import {ApplicationConfig} from '@angular/core';
import {provideRouter} from '@angular/router';
import {routes} from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    // ...
  ],
};
```

## Route URL Paths

### Static URL Paths

Static URL Paths refer to routes with predefined paths that don't change based on dynamic parameters. These are routes that match a `path` string exactly and have a fixed outcome.

Examples of this include:
- "/admin"
- "/blog"
- "/settings/account"

### Define URL Paths with Route Parameters

Parameterized URLs allow you to define dynamic paths that allow multiple URLs to the same component while dynamically displaying data based on parameters in the URL.

You can define this type of pattern by adding parameters to your route's `path` string and prefixing each parameter with the colon (`:`) character.

**IMPORTANT:** Parameters are distinct from information in the URL's query string.

```ts
import {Routes} from '@angular/router';
import {UserProfile} from './user-profile/user-profile';

const routes: Routes = [{path: 'user/:id', component: UserProfile}];
```

In this example, URLs such as `/user/leeroy` and `/user/jenkins` render the `UserProfile` component.

Valid route parameter names must start with a letter (a-z, A-Z) and can only contain:
- Letters (a-z, A-Z)
- Numbers (0-9)
- Underscore (_)
- Hyphen (-)

You can also define paths with multiple parameters:

```ts
import {Routes} from '@angular/router';
import {UserProfile} from './user-profile';
import {SocialMediaFeed} from './social-media-feed';

const routes: Routes = [
  {path: 'user/:id/:social-media', component: SocialMediaFeed},
  {path: 'user/:id/', component: UserProfile},
];
```

### Wildcards

When you need to catch all routes for a specific path, the solution is a wildcard route which is defined with the double asterisk (`**`).

```ts
import {Home} from './home/home';
import {UserProfile} from './user-profile';
import {NotFound} from './not-found';

const routes: Routes = [
  {path: 'home', component: Home},
  {path: 'user/:id', component: UserProfile},
  {path: '**', component: NotFound},
];
```

> **Tip:** Wildcard routes are typically placed at the end of a routes array.

## How Angular matches URLs

When you define routes, the order is important because Angular uses a **first-match wins strategy**. This means that once Angular matches a URL with a route `path`, it stops checking any further routes. As a result, always put more specific routes before less specific routes.

```ts
const routes: Routes = [
  {path: '', component: Home},              // Empty path
  {path: 'users/new', component: NewUser},  // Static, most specific
  {path: 'users/:id', component: UserDetail}, // Dynamic
  {path: 'users', component: Users},        // Static, less specific
  {path: '**', component: NotFound},        // Wildcard - always last
];
```

## Redirects

You can define a route that redirects to another route instead of rendering a component:

```ts
import {Blog} from './home/blog';

const routes: Routes = [
  {
    path: 'articles',
    redirectTo: '/blog',
  },
  {
    path: 'blog',
    component: Blog,
  },
];
```

## Page titles

You can associate a **title** with each route. Angular automatically updates the page title when a route activates.

```ts
import {Routes} from '@angular/router';
import {Home} from './home';
import {About} from './about';
import {Products} from './products';

const routes: Routes = [
  {
    path: '',
    component: Home,
    title: 'Home Page',
  },
  {
    path: 'about',
    component: About,
    title: 'About Us',
  },
];
```

The page `title` property can be set dynamically to a resolver function using `ResolveFn`:

```ts
const titleResolver: ResolveFn<string> = (route) => route.queryParams['id'];

const routes: Routes = [
  ...{
    path: 'products',
    component: Products,
    title: titleResolver,
  },
];
```

### Using TitleStrategy for page titles

For advanced scenarios where you need centralized control over how the document title is composed, implement a `TitleStrategy`.

```ts
import {inject, Injectable} from '@angular/core';
import {Title} from '@angular/platform-browser';
import {TitleStrategy, RouterStateSnapshot} from '@angular/router';

@Injectable()
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  updateTitle(snapshot: RouterStateSnapshot): void {
    const pageTitle = this.buildTitle(snapshot) || this.title.getTitle();
    this.title.setTitle(`MyAwesomeApp - ${pageTitle}`);
  }
}
```

To use the custom strategy:

```ts
import {provideRouter, TitleStrategy} from '@angular/router';
import {AppTitleStrategy} from './app-title.strategy';

export const appConfig = {
  providers: [provideRouter(routes), {provide: TitleStrategy, useClass: AppTitleStrategy}],
};
```

## Route-level providers for dependency injection

Each route has a `providers` property that lets you provide dependencies to that route's content via dependency injection.

```ts
export const ROUTES: Route[] = [
  {
    path: 'admin',
    providers: [AdminService, {provide: ADMIN_API_KEY, useValue: '12345'}],
    children: [
      {path: 'users', component: AdminUsers},
      {path: 'teams', component: AdminTeams},
    ],
  },
  // ... other application routes that don't
  //     have access to ADMIN_API_KEY or AdminService.
];
```

## Associating data with routes

### Static data

You can associate arbitrary static data with a route via the `data` property:

```ts
const routes: Routes = [
  {
    path: 'about',
    component: About,
    data: {analyticsId: '456'},
  },
  {
    path: '',
    component: Home,
    data: {analyticsId: '123'},
  },
];
```

### Dynamic data with data resolvers

When you need to provide dynamic data to a route, check out the guide on route data resolvers.

## Nested Routes

Nested routes, also known as child routes, are a common technique for managing more complex navigation routes where a component has a sub-view that changes based on the URL.

```ts
const routes: Routes = [
  {
    path: 'product/:id',
    component: Product,
    children: [
      {
        path: 'info',
        component: ProductInfo,
      },
      {
        path: 'reviews',
        component: ProductReviews,
      },
    ],
  },
];
```

The parent component (`Product`) includes its own `<router-outlet>`:

```html
<!-- Product -->
<article>
  <h1>Product {{ id }}</h1>
  <router-outlet />
</article>
```

---

# 2. Route Loading Strategies

Source: https://angular.dev/guide/routing/loading-strategies

Angular offers two primary strategies to control loading behavior:

1. **Eagerly loaded**: Routes and components that are loaded immediately
2. **Lazily loaded**: Routes and components loaded only when needed

## Eagerly loaded components

When you define a route with the `component` property, the referenced component is eagerly loaded as part of the same JavaScript bundle as the route configuration.

```ts
import {Routes} from '@angular/router';
import {HomePage} from './components/home/home-page';
import {LoginPage} from './components/auth/login-page';

export const routes: Routes = [
  {
    path: '',
    component: HomePage,
  },
  {
    path: 'login',
    component: LoginPage,
  },
];
```

## Lazily loaded components and routes

You can use the `loadComponent` property to lazily load the JavaScript for a component at the point at which that route would become active. The `loadChildren` property lazily loads child routes during route matching.

```ts
import {Routes} from '@angular/router';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./components/auth/login-page'),
  },
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin.component'),
    loadChildren: () => import('./admin/admin.routes'),
  },
];
```

The `loadComponent` and `loadChildren` properties accept a loader function that returns a Promise that resolves to an Angular component or a set of routes respectively. In most cases, this function uses the standard JavaScript dynamic import API.

If the lazily loaded file uses a `default` export, you can return the `import()` promise directly without an additional `.then` call to select the exported class.

## Injection context lazy loading

The Router executes `loadComponent` and `loadChildren` within the **injection context of the current route**, allowing you to call `inject` inside these loader functions to access providers declared on that route, inherited from parent routes through hierarchical dependency injection, or available globally.

```ts
import {Routes} from '@angular/router';
import {inject} from '@angular/core';
import {FeatureFlags} from './feature-flags';

export const routes: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => {
      const flags = inject(FeatureFlags);
      return flags.isPremium
        ? import('./dashboard/premium-dashboard')
        : import('./dashboard/basic-dashboard');
    },
  },
];
```

## Should I use an eager or a lazy route?

In general, eager loading is recommended for primary landing page(s) while other pages would be lazy-loaded.

**NOTE:** While lazy routes have the upfront performance benefit of reducing the amount of initial data requested by the user, it adds future data requests that could be undesirable. This is particularly true when dealing with nested lazy loading at multiple levels, which can significantly impact performance.

---

# 3. Navigate to Routes

Source: https://angular.dev/guide/routing/navigate-to-routes

The RouterLink directive is Angular's declarative approach to navigation. It allows you to use standard anchor elements (`<a>`) that seamlessly integrate with Angular's routing system.

## How to use RouterLink

```ts
import {RouterLink} from '@angular/router';

@Component({
  template: `
    <nav>
      <a routerLink="/user-profile">User profile</a>
      <a routerLink="/settings">Settings</a>
    </nav>
  `,
  imports: [RouterLink],
  ...
})
export class App {}
```

### Using absolute or relative links

**Relative URLs** in Angular routing allow you to define navigation paths relative to the current route's location. Generally speaking, relative URLs are preferred as they are more maintainable.

### How relative URLs work

Angular routing has two syntaxes for defining relative URLs: strings and arrays.

```html
<!-- Navigates user to /dashboard -->
<a routerLink="dashboard">Dashboard</a>
<a [routerLink]="['dashboard']">Dashboard</a>
```

When you need to define dynamic parameters in a relative URL, use the array syntax:

```html
<a [routerLink]="['user', currentUserId]">Current User</a>
```

Angular routing allows you to specify whether you want the path to be relative to the current URL or to the root domain based on whether the relative path is prefixed with a forward slash (`/`) or not.

```html
<!-- Navigates to /settings/notifications -->
<a routerLink="notifications">Notifications</a>
<a routerLink="/settings/notifications">Notifications</a>

<!-- Navigates to /team/:teamId/user/:userId -->
<a routerLink="/team/123/user/456">User 456</a>
<a [routerLink]="['/team', teamId, 'user', userId]">Current User</a>
```

## Programmatic navigation to routes

### router.navigate()

You can use the `router.navigate()` method to programmatically navigate between routes by specifying a URL path array.

```ts
import {Router} from '@angular/router';

@Component({
  selector: 'app-dashboard',
  template: ` <button (click)="navigateToProfile()">View Profile</button> `,
})
export class AppDashboard {
  private router = inject(Router);

  navigateToProfile() {
    // Standard navigation
    this.router.navigate(['/profile']);

    // With route parameters
    this.router.navigate(['/users', userId]);

    // With query parameters
    this.router.navigate(['/search'], {
      queryParams: {category: 'books', sort: 'price'},
    });

    // With matrix parameters
    this.router.navigate(['/products', {featured: true, onSale: true}]);
  }
}
```

You can also build dynamic navigation paths relative to your component's location in the routing tree using the `relativeTo` option:

```ts
import {Router, ActivatedRoute} from '@angular/router';

@Component({
  selector: 'app-user-detail',
  template: `
    <button (click)="navigateToEdit()">Edit User</button>
    <button (click)="navigateToParent()">Back to List</button>
  `,
})
export class UserDetail {
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // Navigate to a sibling route
  navigateToEdit() {
    // From: /users/123
    // To:   /users/123/edit
    this.router.navigate(['edit'], {relativeTo: this.route});
  }

  // Navigate to parent
  navigateToParent() {
    // From: /users/123
    // To:   /users
    this.router.navigate(['..'], {relativeTo: this.route});
  }

  navigateToList() {
    // From: /users/123
    // Result: /users/list
    this.router.navigate(['..', 'list'], {relativeTo: this.route});
  }
}
```

### router.navigateByUrl()

The `router.navigateByUrl()` method provides a direct way to programmatically navigate using URL path strings rather than array segments.

```ts
// Standard route navigation
router.navigateByUrl('/products');

// Navigate to nested route
router.navigateByUrl('/products/featured');

// Complete URL with parameters and fragment
router.navigateByUrl('/products/123?view=details#reviews');

// Navigate with query parameters
router.navigateByUrl('/search?category=books&sortBy=price');

// With matrix parameters
router.navigateByUrl('/sales-awesome;isOffer=true;showModal=false');
```

In the event you need to replace the current URL in history, `navigateByUrl` also accepts a configuration object that has a `replaceUrl` option:

```ts
// Replace current URL in history
router.navigateByUrl('/checkout', {
  replaceUrl: true,
});
```

### Display a different URL in the address bar

You can pass a `browserUrl` option to `navigateByUrl` to display a different URL in the browser's address bar than the one used for route matching.

```ts
router.navigateByUrl('/not-found', {browserUrl: '/products/missing-item'});
```

Angular navigates to and renders the `/not-found` route, but the browser address bar shows `/products/missing-item`.

**NOTE:** `browserUrl` only affects what appears in the browser's address bar.

## Customizing the browser URL with RouterLink

The RouterLink directive also supports a `browserUrl` input:

```html
<!-- Navigates to /dashboard, but the address bar shows /home -->
<a [routerLink]="['/dashboard']" [browserUrl]="'/home'">Go to Dashboard</a>
```

You can also bind a `UrlTree` for more dynamic use cases:

```ts
import {Component, inject} from '@angular/core';
import {Router, RouterLink, UrlTree} from '@angular/router';

@Component({
  template: `
    <a [routerLink]="['/products', product.id]" [browserUrl]="displayUrl">
      {{ product.name }}
    </a>
  `,
  imports: [RouterLink],
})
export class ProductList {
  private router = inject(Router);
  product = {id: 42, name: 'Widget'};

  // Create a UrlTree to display in the address bar
  displayUrl: UrlTree = this.router.createUrlTree(['/products', 'widget']);
}
```

---

# 4. Control Route Access with Guards

Source: https://angular.dev/guide/routing/route-guards

**CRITICAL:** Never rely on client-side guards as the sole source of access control. All JavaScript that runs in a web browser can be modified by the user running the browser. Always enforce user authorization server-side, in addition to any client-side guards.

Route guards are functions that control whether a user can navigate to or leave a particular route. They are like checkpoints that manage whether a user can access specific routes.

## Creating a route guard

```bash
ng generate guard CUSTOM_NAME
```

## Route guard return types

All route guards share the same possible return types:

| Return types | Description |
|---|---|
| boolean | true allows navigation, false blocks it (see note for CanMatch route guard) |
| UrlTree or RedirectCommand | Redirects to another route instead of blocking |
| Promise<T> or Observable<T> | Router uses the first emitted value and then unsubscribes |

**NOTE:** `CanMatch` behaves differently -- when it returns `false`, Angular tries other matching routes instead of completely blocking navigation.

## Types of route guards

### CanActivate

The `CanActivate` guard determines whether a user can access a route. It is most commonly used for authentication and authorization.

Arguments:
- `route`: `ActivatedRouteSnapshot` - Contains information about the route being activated
- `state`: `RouterStateSnapshot` - Contains the router's current state

```ts
export const authGuard: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const authService = inject(AuthService);
  return authService.isAuthenticated();
};
```

> **Tip:** If you need to redirect the user, return a `URLTree` or `RedirectCommand`. Do **not** return `false` and then programmatically `navigate` the user.

### CanActivateChild

The `CanActivateChild` guard determines whether a user can access child routes of a particular parent route. `canActivateChild` runs for _all_ children.

Arguments:
- `childRoute`: `ActivatedRouteSnapshot` - Contains information about the "future" snapshot of the child route being activated
- `state`: `RouterStateSnapshot` - Contains the router's current state

```ts
export const adminChildGuard: CanActivateChildFn = (
  childRoute: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const authService = inject(AuthService);
  return authService.hasRole('admin');
};
```

### CanDeactivate

The `CanDeactivate` guard determines whether a user can leave a route. A common scenario is preventing navigation away from unsaved forms.

Arguments:
- `component`: `T` - The component instance being deactivated
- `currentRoute`: `ActivatedRouteSnapshot`
- `currentState`: `RouterStateSnapshot`
- `nextState`: `RouterStateSnapshot`

```ts
export const unsavedChangesGuard: CanDeactivateFn<Form> = (
  component: Form,
  currentRoute: ActivatedRouteSnapshot,
  currentState: RouterStateSnapshot,
  nextState: RouterStateSnapshot,
) => {
  return component.hasUnsavedChanges()
    ? confirm('You have unsaved changes. Are you sure you want to leave?')
    : true;
};
```

### CanMatch

The `CanMatch` guard determines whether a route can be matched during path matching. Unlike other guards, rejection falls through to try other matching routes instead of blocking navigation entirely. This can be useful for feature flags, A/B testing, or conditional route loading.

Arguments:
- `route`: `Route` - The route configuration being evaluated
- `segments`: `UrlSegment[]` - The URL segments that have not been consumed by previous parent route evaluations

When it returns `false`, Angular tries other matching routes instead of completely blocking navigation.

```ts
export const featureToggleGuard: CanMatchFn = (route: Route, segments: UrlSegment[]) => {
  const featureService = inject(FeatureService);
  return featureService.isFeatureEnabled('newDashboard');
};
```

It can also allow you to use different components for the same path:

```ts
const routes: Routes = [
  {
    path: 'dashboard',
    component: AdminDashboard,
    canMatch: [adminGuard],
  },
  {
    path: 'dashboard',
    component: UserDashboard,
    canMatch: [userGuard],
  },
];
```

## Applying guards to routes

Guards are specified as arrays in the route configuration. They are executed in the order they appear in the array.

```ts
import {Routes} from '@angular/router';
import {authGuard} from './guards/auth.guard';
import {adminGuard} from './guards/admin.guard';
import {canDeactivateGuard} from './guards/can-deactivate.guard';
import {featureToggleGuard} from './guards/feature-toggle.guard';

const routes: Routes = [
  // Basic CanActivate - requires authentication
  {
    path: 'dashboard',
    component: Dashboard,
    canActivate: [authGuard],
  },
  // Multiple CanActivate guards - requires authentication AND admin role
  {
    path: 'admin',
    component: Admin,
    canActivate: [authGuard, adminGuard],
  },
  // CanActivate + CanDeactivate
  {
    path: 'profile',
    component: Profile,
    canActivate: [authGuard],
    canDeactivate: [canDeactivateGuard],
  },
  // CanActivateChild - protects all child routes
  {
    path: 'users',
    canActivateChild: [authGuard],
    children: [
      {path: 'list', component: UserList},
      {path: 'detail/:id', component: UserDetail},
    ],
  },
  // CanMatch - conditionally matches route based on feature flag
  {
    path: 'beta-feature',
    component: BetaFeature,
    canMatch: [featureToggleGuard],
  },
  // Fallback route if beta feature is disabled
  {
    path: 'beta-feature',
    component: ComingSoon,
  },
];
```

---

# 5. Lifecycle and Events

Source: https://angular.dev/guide/routing/lifecycle-and-events

Angular Router provides a comprehensive set of lifecycle hooks and events that allow you to respond to navigation changes and execute custom logic during the routing process.

## Common router events

| Events | Description |
|---|---|
| NavigationStart | Occurs when navigation begins and contains the requested URL. |
| RoutesRecognized | Occurs after the router determines which route matches the URL. |
| GuardsCheckStart | Begins the route guard phase. |
| GuardsCheckEnd | Signals completion of guard evaluation. Contains the result (allowed/denied). |
| ResolveStart | Begins the data resolution phase. Route resolvers start fetching data. |
| ResolveEnd | Data resolution completes. All required data becomes available. |
| NavigationEnd | Final event when navigation completes successfully. The router updates the URL. |
| NavigationSkipped | Occurs when the router skips navigation (e.g., same URL navigation). |

Common error events:

| Event | Description |
|---|---|
| NavigationCancel | Occurs when the router cancels navigation. Often due to a guard returning false. |
| NavigationError | Occurs when navigation fails. Could be due to invalid routes or resolver errors. |

## How to subscribe to router events

```ts
import {Component, inject, signal, effect} from '@angular/core';
import {Event, Router, NavigationStart, NavigationEnd} from '@angular/router';

@Component({/*...*/})
export class RouterEvents {
  private readonly router = inject(Router);

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event: Event) => {
      if (event instanceof NavigationStart) {
        console.log('Navigation starting:', event.url);
      }

      if (event instanceof NavigationEnd) {
        console.log('Navigation completed:', event.url);
      }
    });
  }
}
```

## How to debug routing events

Enable logging with `withDebugTracing()`:

```ts
import {provideRouter, withDebugTracing} from '@angular/router';

const appRoutes: Routes = [];

bootstrapApplication(App, {
  providers: [provideRouter(appRoutes, withDebugTracing())],
});
```

## Common use cases

### Loading indicators

```ts
import {Component, inject} from '@angular/core';
import {Router} from '@angular/router';

@Component({
  selector: 'app-root',
  template: `
    @if (isNavigating()) {
      <div class="loading-bar">Loading...</div>
    }
    <router-outlet />
  `,
})
export class App {
  private router = inject(Router);
  isNavigating = computed(() => !!this.router.currentNavigation());
}
```

### Analytics tracking

```ts
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {inject, Injectable, DestroyRef} from '@angular/core';
import {Router, NavigationEnd} from '@angular/router';

@Injectable({providedIn: 'root'})
export class AnalyticsService {
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  startTracking() {
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.analytics.trackPageView(event.url);
      }
    });
  }

  private analytics = {
    trackPageView: (url: string) => {
      console.log('Page view tracked:', url);
    },
  };
}
```

### Error handling

```ts
import {Component, inject, signal} from '@angular/core';
import {
  Router,
  NavigationStart,
  NavigationError,
  NavigationCancel,
  NavigationCancellationCode,
} from '@angular/router';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-error-handler',
  template: `
    @if (errorMessage()) {
      <div class="error-banner">
        {{ errorMessage() }}
        <button (click)="dismissError()">Dismiss</button>
      </div>
    }
  `,
})
export class ErrorHandler {
  private router = inject(Router);
  readonly errorMessage = signal('');

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.errorMessage.set('');
      } else if (event instanceof NavigationError) {
        console.error('Navigation error:', event.error);
        this.errorMessage.set('Failed to load page. Please try again.');
      } else if (event instanceof NavigationCancel) {
        console.warn('Navigation cancelled:', event.reason);

        if (event.code === NavigationCancellationCode.GuardRejected) {
          this.errorMessage.set('Access denied. Please check your permissions.');
        }
      }
    });
  }

  dismissError() {
    this.errorMessage.set('');
  }
}
```

## All router events

### Navigation events

| Event | Description |
|---|---|
| NavigationStart | Occurs when navigation starts |
| RouteConfigLoadStart | Occurs before lazy loading a route configuration |
| RouteConfigLoadEnd | Occurs after a lazy-loaded route configuration loads |
| RoutesRecognized | Occurs when the router parses the URL and recognizes the routes |
| GuardsCheckStart | Occurs at the start of the guard phase |
| GuardsCheckEnd | Occurs at the end of the guard phase |
| ResolveStart | Occurs at the start of the resolve phase |
| ResolveEnd | Occurs at the end of the resolve phase |

### Activation events

| Event | Description |
|---|---|
| ActivationStart | Occurs at the start of route activation |
| ChildActivationStart | Occurs at the start of child route activation |
| ActivationEnd | Occurs at the end of route activation |
| ChildActivationEnd | Occurs at the end of child route activation |

### Navigation completion events

| Event | Description |
|---|---|
| NavigationEnd | Occurs when navigation ends successfully |
| NavigationCancel | Occurs when the router cancels navigation |
| NavigationError | Occurs when navigation fails due to an unexpected error |
| NavigationSkipped | Occurs when the router skips navigation (e.g., same URL navigation) |

### Other events

| Event | Description |
|---|---|
| Scroll | Occurs during scrolling |

---

# 6. Route Transition Animations

Source: https://angular.dev/guide/routing/route-transition-animations

Route transition animations enhance user experience by providing smooth visual transitions when navigating between different views. Angular Router includes built-in support for the browser's View Transitions API.

**HELPFUL:** The Router's native View Transitions integration is currently in developer preview. Native View Transitions are a relatively new browser feature with limited support across all browsers.

## How View Transitions work

View transitions use the browser's native `document.startViewTransition` API to create smooth animations between different states:

1. **Capturing the current state** - The browser takes a screenshot of the current page
2. **Executing the DOM update** - Your callback function runs to update the DOM
3. **Capturing the new state** - The browser captures the updated page state
4. **Playing the transition** - The browser animates between the old and new states

```ts
document.startViewTransition(async () => {
  await updateTheDOMSomehow();
});
```

## How the Router uses view transitions

During navigation, the Router:

1. **Completes navigation preparation** - Route matching, lazy loading, guards, and resolvers execute
2. **Initiates the view transition** - Router calls `startViewTransition` when routes are ready for activation
3. **Updates the DOM** - Router activates new routes and deactivates old ones within the transition callback
4. **Finalizes the transition** - The transition Promise resolves when Angular completes rendering

The Router's view transition integration acts as a progressive enhancement. When browsers don't support the View Transitions API, the Router performs normal DOM updates without animation.

## Enabling View Transitions in the Router

### Standalone bootstrap

```ts
import {bootstrapApplication} from '@angular/platform-browser';
import {provideRouter, withViewTransitions} from '@angular/router';
import {routes} from './app.routes';

bootstrapApplication(MyApp, {
  providers: [provideRouter(routes, withViewTransitions())],
});
```

### NgModule bootstrap

```ts
import {NgModule} from '@angular/core';
import {RouterModule} from '@angular/router';

@NgModule({
  imports: [RouterModule.forRoot(routes, {enableViewTransitions: true})],
})
export class AppRouting {}
```

## Customizing transitions with CSS

To create custom transitions:

1. **Add view-transition-name** - Assign unique names to elements you want to animate
2. **Define global animations** - Create CSS animations in your global styles
3. **Target transition pseudo-elements** - Use `::view-transition-old()` and `::view-transition-new()` selectors

```css
/* Define keyframe animations */
@keyframes rotate-out {
  to {
    transform: rotate(90deg);
  }
}

@keyframes rotate-in {
  from {
    transform: rotate(-90deg);
  }
}

/* Target view transition pseudo-elements */
::view-transition-old(count),
::view-transition-new(count) {
  animation-duration: 200ms;
  animation-name: -ua-view-transition-fade-in, rotate-in;
}

::view-transition-old(count) {
  animation-name: -ua-view-transition-fade-out, rotate-out;
}
```

**IMPORTANT:** Define view transition animations in your global styles file, not in component styles. Angular's view encapsulation scopes component styles, which prevents them from targeting the transition pseudo-elements correctly.

## Advanced transition control with onViewTransitionCreated

The `withViewTransitions` feature accepts an options object with an `onViewTransitionCreated` callback for advanced control. This callback:

- Runs in an injection context
- Receives a `ViewTransitionInfo` object containing:
  - The `ViewTransition` instance from `startViewTransition`
  - The `ActivatedRouteSnapshot` for the route being navigated from
  - The `ActivatedRouteSnapshot` for the route being navigated to

```ts
import {inject} from '@angular/core';
import {Router, withViewTransitions, isActive} from '@angular/router';

withViewTransitions({
  onViewTransitionCreated: ({transition}) => {
    const router = inject(Router);
    const targetUrl = router.currentNavigation()!.finalUrl!;

    // Skip transition if only fragment or query params change
    const config = {
      paths: 'exact',
      matrixParams: 'exact',
      fragment: 'ignored',
      queryParams: 'ignored',
    };

    const isTargetRouteCurrent = isActive(targetUrl, router, config);

    if (isTargetRouteCurrent()) {
      transition.skipTransition();
    }
  },
});
```

## Shared element transitions

Elements can transition smoothly between different DOM elements as long as they share the same `view-transition-name`. This enables shared element transitions where an element in one route animates into a corresponding element in another route.

---

# 7. Redirecting Routes

Source: https://angular.dev/guide/routing/redirecting-routes

## How to configure redirects

```ts
import {Routes} from '@angular/router';

const routes: Routes = [
  // Simple redirect
  {path: 'marketing', redirectTo: 'newsletter'},
  // Redirect with path parameters
  {path: 'legacy-user/:id', redirectTo: 'users/:id'},
  // Redirect any other URLs that don't match (wildcard redirect)
  {path: '**', redirectTo: '/login'},
];
```

## Understanding pathMatch

The `pathMatch` property on routes enables developers to control how Angular matches a URL to routes.

| Value | Description |
|---|---|
| `'full'` | The entire URL path must match exactly |
| `'prefix'` | Only the beginning of the URL needs to match |

By default, all redirects use the `prefix` strategy.

### pathMatch: 'prefix'

`pathMatch: 'prefix'` is the default strategy and ideal when you want Angular Router to match all subsequent routes when triggering a redirect.

```ts
export const routes: Routes = [
  // This redirect route is equivalent to...
  { path: 'news', redirectTo: 'blog' },
  // This explicitly defined route redirect pathMatch
  { path: 'news', redirectTo: 'blog', pathMatch: 'prefix' },
];
```

All routes that are prefixed with `news` are redirected to their `/blog` equivalents:
- `/news` redirects to `/blog`
- `/news/article` redirects to `/blog/article`
- `/news/article/:id` redirects to `/blog/article/:id`

### pathMatch: 'full'

`pathMatch: 'full'` is useful when you want Angular Router to only redirect a specific path.

```ts
export const routes: Routes = [
  {path: '', redirectTo: '/dashboard', pathMatch: 'full'}
];
```

Any time the user visits the root URL (i.e., `''`), the router redirects that user to the `'/dashboard'` page. Any subsequent pages are ignored and do not trigger a redirect.

**TIP:** Be careful when configuring a redirect on the root page (i.e., `"/"` or `""`). If you do not set `pathMatch: 'full'`, the router will redirect all URLs.

## Conditional redirects

The `redirectTo` property can also accept a function (RedirectFunction) to add logic to how users are redirected:

```ts
import {Routes} from '@angular/router';
import {Menu} from './menu';

export const routes: Routes = [
  {
    path: 'restaurant/:location/menu',
    redirectTo: (activatedRouteSnapshot) => {
      const location = activatedRouteSnapshot.params['location'];
      const currentHour = new Date().getHours();

      if (activatedRouteSnapshot.queryParams['meal']) {
        return `/restaurant/${location}/menu/${queryParams['meal']}`;
      }

      if (currentHour >= 5 && currentHour < 11) {
        return `/restaurant/${location}/menu/breakfast`;
      } else if (currentHour >= 11 && currentHour < 17) {
        return `/restaurant/${location}/menu/lunch`;
      } else {
        return `/restaurant/${location}/menu/dinner`;
      }
    },
  },
  {path: 'restaurant/:location/menu/breakfast', component: Menu},
  {path: 'restaurant/:location/menu/lunch', component: Menu},
  {path: 'restaurant/:location/menu/dinner', component: Menu},
  {path: '', redirectTo: '/restaurant/downtown/menu', pathMatch: 'full'},
];
```

---

# 8. Router Reference

Source: https://angular.dev/guide/routing/router-reference

## Router events

| Router event | Details |
|---|---|
| NavigationStart | Triggered when navigation starts. |
| RouteConfigLoadStart | Triggered before the Router lazy loads a route configuration. |
| RouteConfigLoadEnd | Triggered after a route has been lazy loaded. |
| RoutesRecognized | Triggered when the Router parses the URL and the routes are recognized. |
| GuardsCheckStart | Triggered when the Router begins the Guards phase of routing. |
| ChildActivationStart | Triggered when the Router begins activating a route's children. |
| ActivationStart | Triggered when the Router begins activating a route. |
| GuardsCheckEnd | Triggered when the Router finishes the Guards phase of routing successfully. |
| ResolveStart | Triggered when the Router begins the Resolve phase of routing. |
| ResolveEnd | Triggered when the Router finishes the Resolve phase of routing successfully. |
| ChildActivationEnd | Triggered when the Router finishes activating a route's children. |
| ActivationEnd | Triggered when the Router finishes activating a route. |
| NavigationEnd | Triggered when navigation ends successfully. |
| NavigationCancel | Triggered when navigation is canceled. This can happen when a Route Guard returns false during navigation, or redirects by returning a UrlTree or RedirectCommand. |
| NavigationError | Triggered when navigation fails due to an unexpected error. |
| Scroll | Represents a scrolling event. |

## Router terminology

| Router part | Details |
|---|---|
| Router | Displays the application component for the active URL. Manages navigation from one component to the next. |
| provideRouter | Provides the necessary service providers for navigating through application views. |
| RouterModule | A separate NgModule that provides the necessary service providers and directives for navigating through application views. |
| Routes | Defines an array of Routes, each mapping a URL path to a component. |
| Route | Defines how the router should navigate to a component based on a URL pattern. |
| RouterOutlet | The directive (`<router-outlet>`) that marks where the router displays a view. |
| RouterLink | The directive for binding a clickable HTML element to a route. |
| RouterLinkActive | The directive for adding/removing classes from an HTML element when an associated routerLink becomes active/inactive. |
| ActivatedRoute | A service provided to each route component that contains route specific information. |
| RouterState | The current state of the router including a tree of the currently activated routes. |

## `<base href>`

You must add a `<base href>` element to the application's `index.html` for `pushState` routing to work:

```html
<base href="/" />
```

### HashLocationStrategy

```ts
providers: [provideRouter(appRoutes, withHashLocation())];
```

When using `RouterModule.forRoot`, configure with `useHash: true`:

```ts
RouterModule.forRoot(routes, {useHash: true})
```

---

# 9. Other Routing Tasks

Source: https://angular.dev/guide/routing/common-router-tasks

## Getting route information (withComponentInputBinding)

Use `withComponentInputBinding` feature with `provideRouter` or the `bindToComponentInputs` option of `RouterModule.forRoot`.

### Step 1: Add withComponentInputBinding

```ts
providers: [provideRouter(appRoutes, withComponentInputBinding())];
```

### Step 2: Add an input to the component

Update the component to have an `input()` property matching the name of the parameter:

```ts
id = input.required<string>();
hero = computed(() => this.service.getHero(id()));
```

### Step 3: Optional: Use a default value

The router assigns values to all inputs based on the current route when `withComponentInputBinding` is enabled. The router assigns `undefined` if no route data matches the input key.

```ts
id = input.required({
  transform: (maybeUndefined: string | undefined) => maybeUndefined ?? '0',
});

// or
id = input<string | undefined>();
internalId = linkedSignal(() => this.id() ?? getDefaultId());
```

**NOTE:** You can bind all route data with key, value pairs to component inputs: static or resolved route data, path parameters, matrix parameters, and query parameters. If you want to use the parent components route info you will need to set the router `paramsInheritanceStrategy` option: `withRouterConfig({paramsInheritanceStrategy: 'always'})`.

## Displaying a 404 page

```ts
const routes: Routes = [
  {path: 'first-component', component: First},
  {path: 'second-component', component: Second},
  {path: '**', component: PageNotFound}, // Wildcard route for a 404 page
];
```

## Link parameters array

```html
<a [routerLink]="['/heroes']">Heroes</a>

<!-- With route parameter -->
<a [routerLink]="['/hero', hero.id]">
  <span class="badge">{{ hero.id }}</span>{{ hero.name }}
</a>

<!-- With optional (matrix) route parameters -->
<a [routerLink]="['/crisis-center', {foo: 'foo'}]">Crisis Center</a>
```

## LocationStrategy and browser URL styles

| Providers | Details |
|---|---|
| PathLocationStrategy | The default "HTML5 pushState" style. |
| HashLocationStrategy | The "hash URL" style. |

---

# 10. Customizing Route Behavior

Source: https://angular.dev/guide/routing/customizing-route-behavior

## Router configuration options (withRouterConfig)

The `withRouterConfig` or `RouterModule.forRoot` allows providing additional `RouterConfigOptions` to adjust the Router's behavior.

### Handle canceled navigations

`canceledNavigationResolution` controls how the Router restores browser history when a navigation is canceled. Default is `'replace'`.

```ts
provideRouter(routes, withRouterConfig({canceledNavigationResolution: 'computed'}));
```

### React to same-URL navigations

`onSameUrlNavigation` configures what should happen when the user asks to navigate to the current URL. Default `'ignore'` skips work, while `'reload'` re-runs guards and resolvers.

```ts
provideRouter(routes, withRouterConfig({onSameUrlNavigation: 'reload'}));
```

You can also control this on individual navigations:

```ts
router.navigate(['/some-path'], {onSameUrlNavigation: 'reload'});
```

### Control parameter inheritance

`paramsInheritanceStrategy` defines how route parameters and data flow from parent routes.

With the default `'emptyOnly'`, child routes inherit params only when their path is empty or the parent does not declare a component.

```ts
provideRouter(routes, withRouterConfig({paramsInheritanceStrategy: 'always'}));
```

Using `'always'` ensures matrix parameters, route data, and resolved values are available further down the route tree:

```ts
@Component({/* ... */})
export class Customer {
  private route = inject(ActivatedRoute);
  // All parent parameters are available directly
  orgId = this.route.snapshot.params['orgId'];
  projectId = this.route.snapshot.params['projectId'];
  customerId = this.route.snapshot.params['customerId'];
}
```

### Decide when the URL updates

`urlUpdateStrategy` determines when Angular writes to the browser address bar. Default `'deferred'` waits for a successful navigation. Use `'eager'` to update immediately when navigation starts.

```ts
provideRouter(routes, withRouterConfig({urlUpdateStrategy: 'eager'}));
```

### Choose default query parameter handling

`defaultQueryParamsHandling` sets the fallback behavior for `Router.createUrlTree` when the call does not specify `queryParamsHandling`. Default is `'replace'`. Options: `'merge'`, `'preserve'`.

```ts
provideRouter(routes, withRouterConfig({defaultQueryParamsHandling: 'merge'}));
```

## Route reuse strategy

Route reuse strategy controls whether Angular destroys and recreates components during navigation or preserves them for reuse.

### When to implement route reuse

- **Form state preservation**
- **Expensive data retention**
- **Scroll position maintenance**
- **Tab-like interfaces**

### Creating a custom route reuse strategy

The `RouteReuseStrategy` class provides the following methods:

| Method | Description |
|---|---|
| shouldDetach | Determines if a route should be stored for later reuse |
| store | Stores the detached route handle |
| shouldAttach | Determines if a stored route should be reattached |
| retrieve | Returns the previously stored route handle |
| shouldReuseRoute | Determines if the router should reuse the current route instance |
| shouldDestroyInjector | (Experimental) Determines if the router should destroy the injector of a detached route |

```ts
import {
  RouteReuseStrategy,
  Route,
  ActivatedRouteSnapshot,
  DetachedRouteHandle,
} from '@angular/router';
import {Injectable} from '@angular/core';

@Injectable()
export class CustomRouteReuseStrategy implements RouteReuseStrategy {
  private handlers = new Map<Route | null, DetachedRouteHandle>();

  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return route.data['reuse'] === true;
  }

  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    if (handle && route.data['reuse'] === true) {
      const key = this.getRouteKey(route);
      this.handlers.set(key, handle);
    }
  }

  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const key = this.getRouteKey(route);
    return route.data['reuse'] === true && this.handlers.has(key);
  }

  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const key = this.getRouteKey(route);
    return route.data['reuse'] === true ? (this.handlers.get(key) ?? null) : null;
  }

  shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    return future.routeConfig === curr.routeConfig;
  }

  private getRouteKey(route: ActivatedRouteSnapshot): Route | null {
    return route.routeConfig;
  }
}
```

Configure at application level:

```ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    {provide: RouteReuseStrategy, useClass: CustomRouteReuseStrategy},
  ],
};
```

### (Experimental) Automatic cleanup of unused route injectors

```ts
import {provideRouter, withExperimentalAutoCleanupInjectors} from '@angular/router';

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes, withExperimentalAutoCleanupInjectors())],
};
```

## Preloading strategy

### Built-in preloading strategies

| Strategy | Description |
|---|---|
| NoPreloading | The default strategy that disables all preloading. Modules only load when users navigate to them. |
| PreloadAllModules | Loads all lazy-loaded modules immediately after the initial navigation. |

Configure with `withPreloading`:

```ts
import {ApplicationConfig} from '@angular/core';
import {provideRouter, withPreloading, PreloadAllModules} from '@angular/router';
import {routes} from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [provideRouter(routes, withPreloading(PreloadAllModules))],
};
```

### Creating a custom preloading strategy

Custom preloading strategies implement the `PreloadingStrategy` interface:

```ts
import {Injectable} from '@angular/core';
import {PreloadingStrategy, Route} from '@angular/router';
import {Observable, of, timer} from 'rxjs';
import {mergeMap} from 'rxjs/operators';

@Injectable()
export class SelectivePreloadingStrategy implements PreloadingStrategy {
  preload(route: Route, load: () => Observable<any>): Observable<any> {
    // Only preload routes marked with data: { preload: true }
    if (route.data?.['preload']) {
      return load();
    }
    return of(null);
  }
}
```

Routes can opt into preloading through their configuration:

```ts
export const routes: Routes = [
  {
    path: 'dashboard',
    loadChildren: () => import('./dashboard/dashboard.routes'),
    data: {preload: true}, // Preload immediately after initial navigation
  },
  {
    path: 'reports',
    loadChildren: () => import('./reports/reports.routes'),
    data: {preload: false}, // Only load when user navigates to reports
  },
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin.routes'),
    // No preload flag - won't be preloaded
  },
];
```

## URL handling strategy

Custom URL handling strategies extend the `UrlHandlingStrategy` class:

```ts
import {Injectable} from '@angular/core';
import {UrlHandlingStrategy, UrlTree} from '@angular/router';

@Injectable()
export class CustomUrlHandlingStrategy implements UrlHandlingStrategy {
  shouldProcessUrl(url: UrlTree): boolean {
    return url.toString().startsWith('/app') || url.toString().startsWith('/admin');
  }

  extract(url: UrlTree): UrlTree {
    return url;
  }

  merge(newUrlPart: UrlTree, rawUrl: UrlTree): UrlTree {
    return newUrlPart;
  }
}
```

## Custom route matchers

Custom matchers provide flexibility for complex URL patterns beyond standard path matching:

```ts
import {Route, UrlSegment, UrlSegmentGroup, UrlMatchResult} from '@angular/router';

export function customMatcher(
  segments: UrlSegment[],
  group: UrlSegmentGroup,
  route: Route,
): UrlMatchResult | null {
  if (matchSuccessful) {
    return {
      consumed: segments,
      posParams: {
        paramName: new UrlSegment('paramValue', {}),
      },
    };
  }
  return null;
}
```

---

# Quick Reference: provideRouter Feature Functions

Based on the documentation above, here is a consolidated list of `provideRouter` feature functions:

| Feature Function | Purpose |
|---|---|
| `withComponentInputBinding()` | Bind route params/data/query params to component inputs |
| `withPreloading(strategy)` | Configure preloading strategy (e.g., `PreloadAllModules`) |
| `withViewTransitions(options?)` | Enable View Transitions API for route animations |
| `withDebugTracing()` | Log all router events to console for debugging |
| `withHashLocation()` | Use hash-based URLs instead of HTML5 pushState |
| `withRouterConfig(options)` | Configure router behavior options (see below) |
| `withExperimentalAutoCleanupInjectors()` | Auto-destroy injectors of unused detached routes |

## withRouterConfig Options

| Option | Values | Default | Description |
|---|---|---|---|
| `canceledNavigationResolution` | `'replace'` / `'computed'` | `'replace'` | How to restore history when navigation is canceled |
| `onSameUrlNavigation` | `'ignore'` / `'reload'` | `'ignore'` | What happens on same-URL navigation |
| `paramsInheritanceStrategy` | `'emptyOnly'` / `'always'` | `'emptyOnly'` | How route params flow from parent to child |
| `urlUpdateStrategy` | `'deferred'` / `'eager'` | `'deferred'` | When the browser URL bar updates |
| `defaultQueryParamsHandling` | `'replace'` / `'merge'` / `'preserve'` | `'replace'` | Default query param handling for createUrlTree |
