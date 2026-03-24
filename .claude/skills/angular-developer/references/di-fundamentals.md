# Dependency Injection (DI) Fundamentals

Dependency Injection (DI) is a design pattern used to organize and share code across an application by allowing you to "inject" features into different parts. This improves code maintainability, scalability, and testability.

## How DI Works in Angular

There are two primary ways code interacts with Angular's DI system:

1. **Providing**: Making values (objects, functions, primitives) available to the DI system.
2. **Injecting**: Asking the DI system for those values.

Angular components, directives, and services automatically participate in DI.

## Services

A **service** is the most common way to share data and functionality across an application. It is a TypeScript class decorated with `@Injectable()`.

### Creating a Service

Use the `providedIn: 'root'` option in the `@Injectable` decorator to make the service a singleton available throughout the entire application. This is the recommended approach for most services.

```ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class AnalyticsLogger {
  trackEvent(category: string, value: string) {
    console.log('Analytics event logged:', { category, value });
  }
}
```

Common uses for services include:

- Data clients (API calls)
- State management
- Authentication and authorization
- Logging and error handling
- Utility functions

## Injecting Dependencies

Use Angular's `inject()` function to request dependencies. This is the recommended approach over constructor injection.

```ts
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AnalyticsLogger } from './analytics-logger.service';

@Component({
  selector: 'app-navbar',
  template: `<a href="#" (click)="navigateToDetail($event)">Detail Page</a>`,
})
export class Navbar {
  private router = inject(Router);
  private analytics = inject(AnalyticsLogger);

  navigateToDetail(event: Event) {
    event.preventDefault();
    this.analytics.trackEvent('navigation', '/details');
    this.router.navigate(['/details']);
  }
}
```

### Where `inject()` Is Valid

`inject()` works in an **injection context** — during construction of a component, directive, or service. The most common places:

1. **Class field initializers** (recommended)
2. **Constructor body**
3. **Route guards and resolvers** (functional)
4. **Factory functions** in providers

For advanced injection context topics (running `inject()` outside construction, `DestroyRef`, `takeUntilDestroyed`), see [injection-context.md](injection-context.md).
