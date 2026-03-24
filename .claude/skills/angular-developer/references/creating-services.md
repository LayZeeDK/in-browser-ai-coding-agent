# Creating and Using Services

Services in Angular are reusable pieces of code that handle data fetching, business logic, or state management that multiple components or other services need to access.

## Creating a Service

Generate a service using the Angular CLI:

```bash
ng generate service my-data
```

Or manually create a TypeScript class decorated with `@Injectable()`.

```ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class BasicDataStore {
  private data: string[] = [];

  addData(item: string): void {
    this.data.push(item);
  }

  getData(): string[] {
    return [...this.data];
  }
}
```

### The `providedIn` Option

`providedIn: 'root'` is the recommended approach for most services. It tells Angular to:

- **Create a single instance (singleton)** for the entire application.
- **Make it available everywhere** without listing it in any `providers` array.
- **Enable tree-shaking** — the service is only bundled if actually injected.

Other `providedIn` values:

| Value        | Scope                                                | Use When                                  |
| ------------ | ---------------------------------------------------- | ----------------------------------------- |
| `'root'`     | App-wide singleton                                   | Most services (data clients, auth, state) |
| `'platform'` | Shared across multiple Angular apps on the same page | Micro-frontends, multi-app pages          |
| `'any'`      | One instance per lazy-loaded module boundary         | Rarely needed — prefer explicit scoping   |
| _(omitted)_  | Must be provided manually in `providers`             | Component-scoped or route-scoped services |

### Service Lifecycle

- **Root-provided services** (`providedIn: 'root'`) live for the entire application lifetime. They are created lazily on first injection.
- **Component-provided services** (in `@Component({ providers: [...] })`) are created when the component is instantiated and destroyed when the component is destroyed. Each component instance gets its own service instance.
- **Route-provided services** (in route `providers` array) are created when the route activates and destroyed when the route is deactivated.

## Injecting a Service

Use the `inject()` function in components, directives, or other services.

### Injecting into a Component

```ts
import { Component, inject } from '@angular/core';
import { BasicDataStore } from './basic-data-store.service';

@Component({
  selector: 'app-example',
  template: `
    <div>
      <p>Data items: {{ dataStore.getData().length }}</p>
      <button (click)="dataStore.addData('New Item')">Add Item</button>
    </div>
  `,
})
export class Example {
  dataStore = inject(BasicDataStore);
}
```

### Injecting into Another Service

Services can inject other services in the exact same way.

```ts
import { Injectable, inject } from '@angular/core';
import { AdvancedDataStore } from './advanced-data-store.service';

@Injectable({
  providedIn: 'root',
})
export class BasicDataStore {
  private advancedDataStore = inject(AdvancedDataStore);

  private data: string[] = [];

  getData(): string[] {
    return [...this.data, ...this.advancedDataStore.getData()];
  }
}
```

## Component-Specific Instances

When a component needs its own isolated instance of a service, provide it directly in the component's `providers` array. This is the standard pattern for component-specific state (forms, edit sessions, local caches).

```ts
@Component({
  selector: 'app-editor',
  providers: [EditorStateService],
  template: `...`,
})
export class EditorComponent {
  private state = inject(EditorStateService);
}
```

Each `EditorComponent` instance gets its own `EditorStateService`. When the component is destroyed, so is its service instance.
