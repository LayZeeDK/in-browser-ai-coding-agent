# Component Styling

Angular components can define styles that apply specifically to their template, enabling encapsulation and modularity.

## Defining Styles

Styles can be defined inline or in separate files.

```ts
@Component({
  selector: 'app-photo',
  // Inline styles
  styles: `
    img {
      border-radius: 50%;
    }
  `,
  // OR external file
  styleUrl: 'photo.component.css',
})
export class Photo {}
```

## View Encapsulation

Every component has a view encapsulation setting that determines how styles are scoped.

| Mode                            | Behavior                                                                                      |
| :------------------------------ | :-------------------------------------------------------------------------------------------- |
| `Emulated` (Default)            | Scopes styles to the component using unique HTML attributes. Global styles can still leak in. |
| `ShadowDom`                     | Uses the browser's native Shadow DOM API to isolate styles completely.                        |
| `None`                          | Disables encapsulation. Component styles become global.                                       |
| `ExperimentalIsolatedShadowDom` | Strictly guarantees that only the component's styles apply.                                   |

### Usage

```ts
import { ViewEncapsulation } from '@angular/core';

@Component({
  ...,
  encapsulation: ViewEncapsulation.None,
})
export class GlobalStyled {}
```

## Special Selectors

### `:host`

Targets the component's host element (the element matching the component's selector).

```css
:host {
  display: block;
  border: 1px solid black;
}
```

### `:host-context()`

Targets the host element based on some condition in its ancestry.

```css
/* Apply styles if any ancestor has the 'theme-dark' class */
:host-context(.theme-dark) {
  background-color: #333;
}
```

### `::ng-deep` (Deprecated)

Disables view encapsulation for a specific rule, allowing it to "leak" into child components.
**The Angular team strongly discourages new use of `::ng-deep`.** It is supported only for backwards compatibility. Use CSS custom properties instead (see below).

## CSS Custom Properties for Cross-Component Theming

CSS custom properties (variables) are the modern replacement for `::ng-deep` when sharing styles across components. They inherit through the DOM tree regardless of view encapsulation mode because Angular's attribute rewriting never touches `var()` resolution or custom property declarations.

### How It Works

1. A **theme boundary** component defines CSS custom properties on its host element (via a class selector in global CSS or inline styles).
2. All descendant components consume them with `var(--token-name)` in their own encapsulated styles.
3. No `::ng-deep`, no `ViewEncapsulation.None` required.

### Defining Theme Variables

Define variables in a global stylesheet (added to `angular.json` `styles` array):

```css
/* src/styles/theme.css */
:root,
.theme-light {
  --color-primary: #1a73e8;
  --color-surface: #ffffff;
  --color-on-surface: #202124;
  --color-outline: #dadce0;
}

.theme-dark {
  --color-primary: #8ab4f8;
  --color-surface: #202124;
  --color-on-surface: #e8eaed;
  --color-outline: #5f6368;
}
```

### Theme Boundary Component

Apply the theme class on a host element. All children inherit the variables automatically.

```ts
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.theme-light]': 'isLight()',
    '[class.theme-dark]': 'isDark()',
  },
  styles: `
    :host {
      display: block;
      background-color: var(--color-surface);
      color: var(--color-on-surface);
    }
  `,
  template: `<ng-content />`,
})
export class AppShell {
  private readonly theme = inject(ThemeService);
  protected readonly isLight = computed(() => this.theme.mode() === 'light');
  protected readonly isDark = computed(() => this.theme.mode() === 'dark');
}
```

### Consuming in Child Components

Child components use `var()` directly -- no imports, no awareness of the theme boundary:

```css
/* Any child component's styles */
.card {
  background-color: var(--color-surface);
  border: 1px solid var(--color-outline);
}
.card-title {
  color: var(--color-primary);
}
```

### Why This Works with Emulated Encapsulation

Angular's emulated encapsulation rewrites selectors with attribute qualifiers (e.g., `.card[_ngcontent-abc]`), but `var(--color-primary)` resolves through the browser's computed style cascade -- not through selector matching. The variables flow from the theme boundary through every descendant element regardless of which component owns them.

### `@media (prefers-color-scheme)` Integration

Combine class-based switching with OS preference detection:

```css
@media (prefers-color-scheme: dark) {
  :root:not(.theme-light) {
    --color-primary: #8ab4f8;
    --color-surface: #202124;
    /* ... dark values ... */
  }
}
```

## Prefer `class` and `style` Bindings Over `ngClass` / `ngStyle`

Use Angular's built-in `class` and `style` bindings instead of `NgClass` and `NgStyle`:

```html
<div [class.admin]="isAdmin" [style.color]="textColor">
  <div [class]="{ admin: isAdmin, dense: density === 'high' }"></div>
</div>
```

## External Styles

Using `<link>` or `@import` in CSS is treated as external styles. **External styles are not affected by emulated view encapsulation.**
