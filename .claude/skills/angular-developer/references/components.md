# Components

Angular components are the fundamental building blocks of an application. Each component consists of a TypeScript class with behaviors, an HTML template, and a CSS selector.

## Component Definition

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

### Metadata Options

- `selector`: CSS selector identifying the component in templates.
- `template` / `templateUrl`: Inline or external HTML template.
- `styles` / `styleUrl` / `styleUrls`: Inline or external CSS.
- `imports`: Components, directives, or pipes used in the template.

### Using Components

Add to the `imports` array and use the selector in the template:

```ts
@Component({
  selector: 'app-root',
  imports: [Profile],
  template: `<app-profile />`,
})
export class App {}
```

## Template Control Flow

### `@if` / `@else if` / `@else`

```html
@if (user.isAdmin) {
<admin-dashboard />
} @else {
<standard-dashboard />
}
```

**Result aliasing**: `@if (user.settings(); as settings) { <p>{{ settings.theme }}</p> }`

### `@for` (track is required)

```html
@for (item of items(); track item.id; let i = $index) {
<li>{{ i }}: {{ item.name }}</li>
} @empty {
<li>No items.</li>
}
```

Implicit variables: `$index`, `$count`, `$first`, `$last`, `$even`, `$odd`.

### `@switch` (no fallthrough, strict `===`)

```html
@switch (status()) { @case ('loading') { <app-spinner /> } @case ('success') { <app-data /> } @default {
<p>Unknown</p>
} }
```

**Exhaustive checking**: `@default never;` errors if a union case is unhandled.

## Content Projection

`<ng-content>` is a placeholder for consumer-provided content.

### Multi-Slot Projection

Use `select` to route content to named slots. Prefer **component or directive selectors** over bare attributes or CSS classes — component selectors are discoverable, type-checked, and self-documenting. An `<ng-content>` without `select` catches unmatched content.

```ts
@Component({ selector: 'card-title', template: `<ng-content />` })
export class CardTitle {}

@Component({ selector: 'card-body', template: `<ng-content />` })
export class CardBody {}

@Component({
  selector: 'custom-card',
  imports: [CardTitle, CardBody],
  template: `
    <ng-content select="card-title" />
    <div class="divider"></div>
    <ng-content select="card-body" />
    <ng-content />
  `,
})
export class CustomCard {}
```

### Fallback Content

Default content renders when nothing is projected:

```html
<ng-content select="card-actions">
  <button (click)="close()">Close</button>
</ng-content>
```

### `ngProjectAs`

Project a standard element into a named slot: `<h3 ngProjectAs="card-title">Hello</h3>`. Static only — cannot bind dynamically.

**Important**: Never conditionally wrap `<ng-content>` with `@if`/`@for`/`@switch`. Angular always instantiates projected content regardless.

## Queries (View and Content)

Signal-based query functions return reactive signals.

### View Queries

`viewChild()` / `viewChildren()` find elements in the component's own template:

```ts
import { viewChild, viewChildren, computed, ElementRef } from '@angular/core';

@Component({
  template: `
    <card-header>Title</card-header>
    <card-action>Save</card-action>
    <card-action>Cancel</card-action>
    <textarea #editor></textarea>
  `,
})
export class CustomCard {
  header = viewChild(CardHeader); // single, may be undefined
  actions = viewChildren(CardAction); // array signal
  editor = viewChild<ElementRef<HTMLTextAreaElement>>('editor'); // by template ref var

  headerText = computed(() => this.header()?.text);
}
```

Use `viewChild.required()` when the target is always present — excludes `undefined` from the type and errors if not found.

### Content Queries

`contentChild()` / `contentChildren()` find elements projected by the consumer:

```ts
@Component({ selector: 'custom-menu' })
export class CustomMenu {
  items = contentChildren(CustomMenuItem);
  labels = computed(() => this.items().map((i) => i.text));
}
```

`contentChildren()` finds **direct children** only by default. Set `{ descendants: true }` for nested matches. `contentChild()` traverses descendants by default. Use `contentChild.required()` to guarantee presence.

### Query Options

- **`read`**: Retrieve a different token — e.g., `viewChild(MyDir, { read: ElementRef })`.
- Queries never pierce component boundaries.

### Legacy Decorators

`@ViewChild`, `@ViewChildren`, `@ContentChild`, `@ContentChildren` remain supported. Decorator-based view queries are available in `ngAfterViewInit`; content queries in `ngAfterContentInit`. Prefer signal-based functions for new code.

## Lifecycle Hooks

Implement lifecycle interfaces for type safety. The hooks run during Angular's top-down change detection traversal.

| Phase            | Method                  | Timing                                                                   |
| ---------------- | ----------------------- | ------------------------------------------------------------------------ |
| Creation         | `constructor`           | Instantiation. Use `inject()` here.                                      |
| Change Detection | `ngOnChanges`           | Before `ngOnInit`, then on every input change. Receives `SimpleChanges`. |
|                  | `ngOnInit`              | Once, after inputs initialized. Before template is checked.              |
|                  | `ngDoCheck`             | Every CD cycle. Avoid — runs very frequently.                            |
|                  | `ngAfterContentInit`    | Once, after projected content initialized. Content queries available.    |
|                  | `ngAfterContentChecked` | Every time content is checked. Runs frequently.                          |
|                  | `ngAfterViewInit`       | Once, after view initialized. View queries available. Can measure DOM.   |
|                  | `ngAfterViewChecked`    | Every time view is checked. Runs frequently.                             |
| Rendering        | `afterNextRender`       | Once after all components render to DOM. Standalone function.            |
|                  | `afterEveryRender`      | Every render cycle. Standalone function.                                 |
| Destruction      | `ngOnDestroy`           | Once before destruction. Clean up observers, subscriptions, timers.      |

**Init order**: `constructor` -> `ngOnChanges` -> `ngOnInit` -> `ngDoCheck` -> `ngAfterContentInit` -> `ngAfterContentChecked` -> `ngAfterViewInit` -> `ngAfterViewChecked` -> `afterNextRender`.

**Subsequent**: `ngOnChanges` -> `ngDoCheck` -> `ngAfterContentChecked` -> `ngAfterViewChecked` -> `afterEveryRender`.

```ts
import { Component, OnInit, AfterViewInit, OnDestroy } from '@angular/core';

@Component({
  /* ... */
})
export class Dashboard implements OnInit, AfterViewInit, OnDestroy {
  ngOnInit() {
    /* inputs ready */
  }
  ngAfterViewInit() {
    /* view queries ready, measure DOM */
  }
  ngOnDestroy() {
    /* cleanup */
  }
}
```

### DestroyRef (Modern Alternative)

`DestroyRef` is an **alternative** to `ngOnDestroy`, not a supplement. Choose one approach per cleanup concern — do not split the same cleanup between both. `DestroyRef` co-locates setup and teardown, which is its main advantage:

```ts
constructor() {
  const observer = new ResizeObserver(entries => { /* ... */ });
  observer.observe(someElement);
  inject(DestroyRef).onDestroy(() => observer.disconnect());
}
```

When the class already implements `OnDestroy` (e.g., because the prompt or interface requires it), put all cleanup in `ngOnDestroy` and do not also register `DestroyRef.onDestroy` for the same resource.

### afterNextRender / afterEveryRender

Standalone functions called in an injection context (constructor). Do not run during SSR. Support phased execution (`earlyRead` -> `write` -> `mixedReadWrite` -> `read`) to avoid layout thrashing:

```ts
afterNextRender({
  write: () => {
    el.nativeElement.style.padding = '10px';
  },
  read: () => {
    /* measure after all writes */
  },
});
```

## Deferred Loading (`@defer`)

Lazy-load heavy components. See [performance.md](performance.md) for full coverage.

```html
@defer (on viewport) {
<heavy-chart />
} @placeholder {
<div>Loading area</div>
} @loading (after 100ms; minimum 1s) { <spinner /> } @error {
<p>Failed to load.</p>
}
```

Triggers: `idle` (default), `viewport`, `interaction`, `hover`, `immediate`, `timer(ms)`, `when condition`. Only standalone components can be deferred.

## Core Concepts

- **Host Element**: DOM element matching the component's selector.
- **View**: DOM rendered by the template inside the host element.
- **Content**: Children projected via `<ng-content>`.
- **Standalone**: Default since Angular 19. Do not set `standalone: true` explicitly.
- **Component Tree**: Apps are structured as a tree of components.
- **Naming**: Follow your project's convention. Consistency matters more than suffix choice.

## Style Guide

- **`protected`** for template-only members. Public members are the component's API.
- **`readonly`** for Angular-initialized properties (`input()`, `output()`, `model()`, `viewChild()`, etc.).
- **Name handlers for actions**: `saveUserData()` not `handleClick()`.
- **Keep lifecycle methods simple**: Delegate to well-named methods.
- **Always implement lifecycle interfaces** (`OnInit`, `AfterViewInit`, etc.) for type safety.
- **Refactor complex template expressions** into `computed()` signals.
- **Do not expose internal state in reusable component templates.** Measurement values (element height, scroll position), debug info, and implementation details belong in private fields or outputs — not rendered in the template. If the consumer needs the data, expose it via an output or a public signal, not inline text.
