# Hierarchical Injectors

Angular's dependency injection system is hierarchical, meaning services can be scoped to different levels of the application.

## Types of Injector Hierarchies

1. **`EnvironmentInjector` Hierarchy**: Configured via `@Injectable({ providedIn: 'root' })` or `ApplicationConfig.providers` during bootstrap. These are global singletons.
2. **`ElementInjector` Hierarchy**: Created implicitly at each DOM element. Configured via the `providers` or `viewProviders` array in `@Component()` or `@Directive()`.

## Resolution Rules

When a dependency is requested, Angular resolves it in two phases:

1. It searches up the **`ElementInjector`** tree, starting from the requesting component/directive up to the root element.
2. If not found, it searches the **`EnvironmentInjector`** tree, starting from the closest environment injector up to the root.
3. If still not found, it throws an error (unless marked optional).

## Resolution Modifiers

Alter how Angular searches for a dependency using the options object in `inject()`:

- **`optional`**: Return `null` instead of throwing if not found.
- **`self`**: Only check the current `ElementInjector`. Do not look up the tree.
- **`skipSelf`**: Start searching in the parent `ElementInjector`, skipping the current element.
- **`host`**: Stop searching at the host component's view boundary (`<#VIEW>`).

```ts
@Component({...})
export class Example {
  optionalService = inject(MyService, { optional: true });
  parentService = inject(ParentService, { skipSelf: true });
}
```

## `providers` vs `viewProviders`

When providing a service at the component level:

- **`providers`**: The service is available to the component, its view (template), and any **projected content** (`<ng-content>`).
- **`viewProviders`**: The service is available to the component and its view, but **NOT** to projected content. Use this to isolate services from content passed in by consumers.

### Why the Difference Matters

Angular uses a logical `<#VIEW>` boundary to separate a component's own template from projected content. `viewProviders` places the provider inside `<#VIEW>`, so only the component's own template can see it. Projected content lives in the **logical parent's** view — it never crosses into the host's `<#VIEW>`.

### Content Projection Isolation Example

```ts
// Service with no providedIn — must be scoped explicitly
@Injectable()
export class FormStateService {
  submitted = signal(false);
  errorMessage = signal('');
}

// Wrapper: uses viewProviders — only its own template sees FormStateService
@Component({
  selector: 'app-form-wrapper',
  viewProviders: [FormStateService],
  template: `
    <!-- This component is in the wrapper's view — it CAN inject FormStateService -->
    <app-form-status />

    <!-- Projected content is NOT in the wrapper's view — it CANNOT see FormStateService -->
    <ng-content />

    <button (click)="submit()">Submit</button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormWrapperComponent {
  private formState = inject(FormStateService);

  submit() {
    this.formState.submitted.set(true);
  }
}

// Projected child: injected via <ng-content> — gets null, not the wrapper's instance
@Component({
  selector: 'app-projected-field',
  template: `<p>Has form state: {{ !!formState }}</p>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectedFieldComponent {
  // optional: true because viewProviders isolates this from the wrapper's instance
  formState = inject(FormStateService, { optional: true });
}
```

Usage in the parent template:

```html
<app-form-wrapper>
  <!-- This is projected content — it lives in the PARENT's view, not the wrapper's -->
  <app-projected-field />
</app-form-wrapper>
```

Result: `ProjectedFieldComponent.formState` is `null` because `viewProviders` hides the wrapper's `FormStateService` from projected content.

### `createEnvironmentInjector`

Create a child `EnvironmentInjector` dynamically for advanced scenarios like dynamic component creation with scoped providers:

```ts
import { createEnvironmentInjector, EnvironmentInjector, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DynamicLoaderService {
  private parentInjector = inject(EnvironmentInjector);

  createScopedInjector(providers: Provider[]): EnvironmentInjector {
    return createEnvironmentInjector(providers, this.parentInjector);
  }
}
```
