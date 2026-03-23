# Accessibility

Angular applications should be accessible to all users, including those who rely on assistive technologies. This reference covers Angular-specific accessibility patterns.

For the full guide, see the [Angular Accessibility documentation](https://angular.dev/best-practices/a11y).

## ARIA Attribute Binding

Use standard property binding for ARIA attributes:

```html
<!-- Dynamic ARIA attributes -->
<button [aria-label]="myActionLabel">...</button>

<!-- Static ARIA attributes -->
<button aria-label="Save document">...</button>
```

For structured ARIA relationships, use property bindings with element references:

```ts
@Component({
  template: `
    <h2 #dialogTitle>Attention</h2>
    <p #dialogDescription>Please review your answers.</p>
    <section role="dialog" [ariaLabelledByElements]="[dialogTitle, dialogDescription]">
      <ng-content />
    </section>
  `,
})
export class ReviewDialog {}
```

## Augmenting Native Elements

Prefer attribute selectors on native elements over creating custom element replacements. This preserves built-in accessibility behavior:

```ts
// Prefer: attribute selector on native element
@Component({
  selector: 'button[app-action]',
  template: `<ng-content />`,
})
export class ActionButton {}

// Usage: <button app-action>Save</button>
// The native <button> provides focus, keyboard, and ARIA behavior for free.
```

## Container Pattern for Native Elements

When wrapping native elements like `<input>`, use content projection so consumers can set attributes directly:

```ts
@Component({
  selector: 'app-form-field',
  template: `
    <label><ng-content select="label" /></label>
    <ng-content select="input,select,textarea" />
    <span class="error"><ng-content select="[error]" /></span>
  `,
})
export class FormField {}
```

```html
<app-form-field>
  <label>Email</label>
  <input type="email" aria-required="true" />
  <span error>Please enter a valid email.</span>
</app-form-field>
```

## Routing and Focus Management

After navigation, focus should move to the main content area. Use the `NavigationEnd` event:

```ts
import { Router, NavigationEnd } from '@angular/router';

export class AppComponent {
  private router = inject(Router);

  constructor() {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      const mainHeader = document.querySelector('#main-content-header');

      if (mainHeader) {
        (mainHeader as HTMLElement).focus();
      }
    });
  }
}
```

### Active Link Identification

Use `ariaCurrentWhenActive` on `RouterLinkActive` to communicate the active link to screen readers:

```html
<nav>
  <a routerLink="home" routerLinkActive="active-page" ariaCurrentWhenActive="page">Home</a>
  <a routerLink="about" routerLinkActive="active-page" ariaCurrentWhenActive="page">About</a>
</nav>
```

## Deferred Loading Accessibility

When using `@defer` blocks, wrap them in ARIA live regions so screen readers announce content changes:

```html
<div aria-live="polite">
  @defer (on viewport) {
  <app-comments />
  } @placeholder {
  <p>Loading comments...</p>
  }
</div>
```

See the [defer accessibility guide](https://angular.dev/guide/templates/defer#keep-accessibility-in-mind) for details.

## Angular CDK a11y Tools

The `@angular/cdk/a11y` package provides utilities:

- **`LiveAnnouncer`**: Announces messages to screen readers via an `aria-live` region.
- **`cdkTrapFocus`**: Traps Tab-key focus within an element (useful for modal dialogs).
- **`FocusMonitor`**: Tracks how an element received focus (mouse, keyboard, touch, programmatic).

```ts
import { LiveAnnouncer } from '@angular/cdk/a11y';

export class SearchResults {
  private announcer = inject(LiveAnnouncer);

  onResultsLoaded(count: number) {
    this.announcer.announce(`${count} results found`);
  }
}
```

## Custom Component Accessibility Example

A progress bar with proper ARIA attributes:

```ts
@Component({
  selector: 'app-progressbar',
  template: '<div class="bar" [style.width.%]="value()"></div>',
  host: {
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-valuenow]': 'value()',
  },
})
export class Progressbar {
  readonly value = input(0);
}
```

```html
<app-progressbar [value]="progress" aria-label="Upload progress" />
```

## Best Practices

- Use native HTML elements (`<button>`, `<a>`, `<input>`) whenever possible.
- Test with screen readers and keyboard navigation.
- Use `angular-eslint` for accessibility linting rules.
- Ensure color contrast meets WCAG AA standards.
- Manage focus explicitly after dynamic content changes and route transitions.
