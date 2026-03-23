# Components

Angular components are the fundamental building blocks of an application. Each component consists of a TypeScript class with behaviors, an HTML template, and a CSS selector.

## Component Definition

Use the `@Component` decorator to define a component's metadata.

```ts
@Component({
  selector: 'app-profile',
  template: `
    <img src="profile.jpg" alt="Profile photo" />
    <button (click)="save()">Save</button>
  `,
  styles: `
    img {
      border-radius: 50%;
    }
  `,
})
export class Profile {
  save() {
    /* ... */
  }
}
```

## Metadata Options

- `selector`: The CSS selector that identifies this component in templates.
- `template`: Inline HTML template (preferred for small templates).
- `templateUrl`: Path to an external HTML file.
- `styles`: Inline CSS styles.
- `styleUrl` / `styleUrls`: Path(s) to external CSS file(s).
- `imports`: Lists the components, directives, or pipes used in this component's template.

## Using Components

To use a component, add it to the `imports` array of the consuming component and use its selector in the template.

```ts
@Component({
  selector: 'app-root',
  imports: [Profile],
  template: `<app-profile />`,
})
export class App {}
```

## Template Control Flow

Angular uses built-in blocks for conditional rendering and loops.

### Conditional Rendering (`@if`)

Use `@if` to conditionally show content. You can include `@else if` and `@else` blocks.

```html
@if (user.isAdmin) {
<admin-dashboard />
} @else if (user.isModerator) {
<mod-dashboard />
} @else {
<standard-dashboard />
}
```

**Result aliasing**: Save the result of the expression for reuse.

```html
@if (user.settings(); as settings) {
<p>Theme: {{ settings.theme }}</p>
}
```

### Loops (`@for`)

The `@for` block iterates over collections. The `track` expression is **required** for performance and DOM reuse.

```html
<ul>
  @for (item of items(); track item.id; let i = $index, total = $count) {
  <li>{{ i + 1 }}/{{ total }}: {{ item.name }}</li>
  } @empty {
  <li>No items to display.</li>
  }
</ul>
```

**Implicit Variables**: `$index`, `$count`, `$first`, `$last`, `$even`, `$odd`.

### Switching Content (`@switch`)

The `@switch` block renders content based on a value. It uses strict equality (`===`) and has **no fallthrough**.

```html
@switch (status()) { @case ('loading') { <app-spinner /> } @case ('error') { <app-error-msg /> } @case ('success') { <app-data-grid /> } @default {
<p>Unknown status</p>
} }
```

**Exhaustive Type Checking**: Use `@default never;` to ensure all cases of a union type are handled.

```html
@switch (state) { @case ('on') { ... } @case ('off') { ... } @default never; // Errors if a new state like 'standby' is added }
```

## Core Concepts

- **Host Element**: The DOM element that matches the component's selector.
- **View**: The DOM rendered by the component's template inside the host element.
- **Standalone**: By default, components are standalone (since Angular 19, `standalone: true` is default). For older versions, `standalone: true` must be explicit or the component must be part of an `NgModule`.
- **Component Tree**: Angular applications are structured as a tree of components, where each component can host child components.
- **Component Naming**: Follow your project's naming convention. The Angular CLI generates a `Component` suffix by default (e.g., `UserProfileComponent`). Some projects omit it (e.g., `UserProfile`). Consistency within a project matters more than which convention you choose.

## Style Guide Conventions

### Use `protected` for Template-Only Members

Class members that are only used in the component's template should be `protected`. Public members define a public API accessible via DI and queries.

```ts
@Component({
  template: `<p>{{ fullName() }}</p>`,
})
export class UserProfile {
  firstName = input();
  lastName = input();

  // Not part of the public API, only used in the template
  protected fullName = computed(() => `${this.firstName()} ${this.lastName()}`);
}
```

### Use `readonly` for Angular-Initialized Properties

Mark properties initialized by Angular as `readonly` to prevent accidental overwriting:

```ts
@Component({
  /*...*/
})
export class UserProfile {
  readonly userId = input();
  readonly userSaved = output();
  readonly userName = model();
}
```

### Name Event Handlers for What They Do

Prefer naming event handlers for the action they perform, not the triggering event:

```html
<!-- Prefer -->
<button (click)="saveUserData()">Save</button>

<!-- Avoid -->
<button (click)="handleClick()">Save</button>
```

### Keep Lifecycle Methods Simple

Avoid putting complex logic directly inside lifecycle hooks. Create well-named methods and call them:

```ts
ngOnInit() {
  this.startLogging();
  this.runBackgroundTask();
}
```

Always implement lifecycle hook interfaces for type safety:

```ts
import { Component, OnInit } from '@angular/core';

@Component({
  /*...*/
})
export class UserProfile implements OnInit {
  ngOnInit() {
    /* ... */
  }
}
```

### Avoid Complex Template Logic

When template expressions get too complex, refactor into `computed()` signals:

```ts
// Instead of complex inline expressions in templates
protected displayName = computed(() => {
  const first = this.firstName();
  const last = this.lastName();

  return last ? `${last}, ${first}` : first;
});
```
