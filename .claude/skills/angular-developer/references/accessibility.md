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
- **`cdkFocusInitial`**: Marks the element that should receive focus when `cdkTrapFocusAutoCapture` activates the trap. Place it on the least destructive action (e.g. Cancel) in confirmation dialogs per WAI-ARIA APG.
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

## Modal Dialog Accessibility

Dialogs require focus trapping, background inertness, and focus restoration. Use CDK a11y tools:

```ts
@Component({
  selector: 'app-confirmation-dialog',
  imports: [A11yModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    '[attr.aria-labelledby]': '"dialog-title"',
    '(keydown.escape)': 'close.emit("cancelled")',
  },
  template: `
    <div cdkTrapFocus cdkTrapFocusAutoCapture="true">
      <h2 id="dialog-title">{{ config().title }}</h2>
      <p>{{ config().message }}</p>
      <button cdkFocusInitial (click)="close.emit('cancelled')">Cancel</button>
      <button (click)="close.emit('confirmed')">Confirm</button>
    </div>
  `,
})
export class ConfirmationDialog {
  readonly config = input.required<{ title: string; message: string }>();
  readonly close = output<'confirmed' | 'cancelled'>();
}
```

**Key requirements:**

- **Focus on open**: `cdkTrapFocusAutoCapture` + `cdkFocusInitial` on the least destructive action.
- **Focus trap**: `cdkTrapFocus` intercepts Tab/Shift+Tab at the boundary.
- **Escape closes**: Host `(keydown.escape)` binding.
- **Focus restoration**: Capture `document.activeElement` before opening; call `trigger.focus()` after closing.
- **Background inert**: Set the HTML `inert` attribute on all `<body>` children outside the dialog. `inert` is superior to `aria-hidden` because it also blocks pointer events and Tab navigation, not just the accessibility tree.
- **Screen reader announcements**: Use `LiveAnnouncer` to announce dialog open/close for AT that do not automatically read `aria-labelledby`.

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

## Accessibility Testing

Use a two-layer automated strategy: angular-eslint catches structural mistakes at author time; axe-core catches runtime violations (color contrast, computed ARIA, dynamic state) in tests.

### axe-core with TestBed

Lazy-load axe-core to avoid import cost in non-a11y tests. Configure once per worker, then run scoped audits against the component's native element:

```ts
// Lazy-load and configure once per worker
let axe: typeof import('axe-core') | null = null;

async function loadAxe() {
  if (!axe) {
    axe = await import('axe-core');
    axe.configure({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
  }

  return axe;
}

// Scoped audit: only the component subtree, not the test harness
async function auditFixture(fixture: ComponentFixture<unknown>): Promise<AxeResults> {
  await fixture.whenStable();
  const engine = await loadAxe();

  return engine.run({ include: [fixture.nativeElement] });
}
```

Test each meaningful component state separately -- ARIA attributes and live-region roles may differ between states:

```ts
describe('NotificationBanner a11y', () => {
  it('has no violations in success state', async () => {
    const fixture = TestBed.createComponent(NotificationBanner);
    fixture.componentRef.setInput('type', 'success');
    fixture.componentRef.setInput('message', 'Saved.');
    const results = await auditFixture(fixture);

    expect(results.violations).toHaveLength(0);
  });

  it('has no violations in error state', async () => {
    const fixture = TestBed.createComponent(NotificationBanner);
    fixture.componentRef.setInput('type', 'error');
    fixture.componentRef.setInput('message', 'Save failed.');
    const results = await auditFixture(fixture);

    expect(results.violations).toHaveLength(0);
  });
});
```

A custom Vitest matcher streamlines assertions and produces readable failure output:

```ts
expect.extend({
  async toHaveNoA11yViolations(received: AxeResults | ComponentFixture<unknown>) {
    const results = 'nativeElement' in received ? await auditFixture(received) : received;
    const pass = results.violations.length === 0;
    const message = () => (pass ? 'No accessibility violations.' : results.violations.map((v) => `[${v.id}] (${v.impact}): ${v.help}`).join('\n'));

    return { pass, message };
  },
});

// Usage: await expect(fixture).toHaveNoA11yViolations();
```

### angular-eslint Template Rules

Add accessibility rules to the `**/*.html` block in your ESLint flat config. These catch structural mistakes at author time without a browser:

```js
{
  files: ['**/*.html'],
  rules: {
    '@angular-eslint/template/accessibility-interactive-supports-focus': 'error',
    '@angular-eslint/template/accessibility-click-events-have-key-events': 'error',
    '@angular-eslint/template/accessibility-alt-text': 'error',
    '@angular-eslint/template/accessibility-label-for': 'error',
    '@angular-eslint/template/accessibility-valid-aria': 'error',
    '@angular-eslint/template/accessibility-role-has-required-aria': 'error',
    '@angular-eslint/template/accessibility-elements-content': 'error',
    '@angular-eslint/template/accessibility-table-scope': 'error',
    '@angular-eslint/template/no-positive-tabindex': 'error',
  },
}
```

**What each layer catches:**

| Concern                                | angular-eslint (static)       | axe-core (runtime) |
| -------------------------------------- | ----------------------------- | ------------------ |
| Missing alt text, empty buttons        | Yes                           | Yes                |
| Color contrast                         | No (no CSS)                   | Yes                |
| Dynamic/signal-driven ARIA values      | No (sees binding expressions) | Yes                |
| Invalid ARIA attributes                | Yes                           | Yes                |
| `(click)` without keyboard handler     | Yes                           | No                 |
| Focus order, hidden focusable elements | No                            | Yes                |

Neither tool replaces manual screen reader testing (NVDA + Chrome, VoiceOver + Safari) for journey-level accessibility verification.

## Best Practices

- Use native HTML elements (`<button>`, `<a>`, `<input>`) whenever possible.
- Test with screen readers and keyboard navigation.
- Configure `angular-eslint` template accessibility rules at `'error'` level in CI.
- Run axe-core audits per component state in unit tests.
- Ensure color contrast meets WCAG AA standards.
- Manage focus explicitly after dynamic content changes and route transitions.
- Use `inert` on background content during modal dialogs, not just `aria-hidden`.
