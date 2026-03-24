# Template-Driven Forms

Two-way data binding with `[(ngModel)]` for simple forms. Directives manage form state and validation in the template.

**Core directives** from `FormsModule`: `NgModel` (two-way binding), `NgForm` (auto-created top-level `FormGroup` on `<form>`), `NgModelGroup` (nested group).

## Setup

Import `FormsModule` into your component. **Every element using `[(ngModel)]` MUST have a `name` attribute** -- Angular uses it to register the control with `NgForm`.

```html
<form #userForm="ngForm" (ngSubmit)="onSubmit()">
  <!-- Basic Input -->
  <div>
    <label for="name">Name:</label>
    <input type="text" id="name" required [(ngModel)]="user.name" name="name" #nameCtrl="ngModel" />
  </div>

  <!-- Select Box -->
  <div>
    <label for="role">Role:</label>
    <select id="role" [(ngModel)]="user.role" name="role">
      <option value="Admin">Admin</option>
      <option value="Guest">Guest</option>
    </select>
  </div>

  <!-- Submit Button (disabled if form is invalid) -->
  <button type="submit" [disabled]="!userForm.form.valid">Submit</button>
</form>
```

## Form and Control State

Angular automatically applies CSS classes to controls and forms based on their state:

| State          | Class if True                     | Class if False |
| :------------- | :-------------------------------- | :------------- |
| Visited        | `ng-touched`                      | `ng-untouched` |
| Value Changed  | `ng-dirty`                        | `ng-pristine`  |
| Value is Valid | `ng-valid`                        | `ng-invalid`   |
| Form Submitted | `ng-submitted` (on `<form>` only) | -              |

## Validation and Error Messages

To display error messages conditionally, export the `ngModel` directive to a template reference variable (e.g., `#nameCtrl="ngModel"`).

```html
<input type="text" id="name" required [(ngModel)]="user.name" name="name" #nameCtrl="ngModel" />

<!-- Show error only if the control is invalid AND (touched OR dirty) -->
@if (nameCtrl.invalid && (nameCtrl.dirty || nameCtrl.touched)) {
<div class="alert alert-danger">
  @if (nameCtrl.errors?.['required']) {
  <div>Name is required.</div>
  }
</div>
}
```

## Custom Validator Directives

In template-driven forms, custom validators must be wrapped in a directive that implements the `Validator` interface and registers with the `NG_VALIDATORS` token. Use `forwardRef` because the directive class is referenced in its own decorator metadata before it is declared.

```ts
import { Directive, forwardRef, input } from '@angular/core';
import { AbstractControl, NG_VALIDATORS, ValidationErrors, Validator } from '@angular/forms';

@Directive({
  selector: '[appForbiddenName]',
  providers: [
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => ForbiddenNameDirective),
      multi: true,
    },
  ],
})
export class ForbiddenNameDirective implements Validator {
  readonly appForbiddenName = input.required<string>();

  validate(control: AbstractControl): ValidationErrors | null {
    const forbidden = new RegExp(this.appForbiddenName(), 'i').test(control.value);
    return forbidden ? { forbiddenName: { value: control.value } } : null;
  }
}
```

Usage in template:

```html
<input type="text" [(ngModel)]="name" name="name" appForbiddenName="bob" #nameCtrl="ngModel" />
@if (nameCtrl.errors?.['forbiddenName']) {
<p>Name cannot be {{ nameCtrl.errors?.['forbiddenName'].value }}.</p>
}
```

### Re-validating when inputs change

When a directive input changes, Angular does not automatically re-run validation. Implement `registerOnValidatorChange` and trigger it on input changes:

```ts
@Directive({
  /* ... */
})
export class RequiredIfDirective implements Validator {
  readonly appRequiredIf = input.required<boolean>();

  private onChange: (() => void) | null = null;

  constructor() {
    effect(() => {
      this.appRequiredIf(); // track the signal
      this.onChange?.(); // re-validate when condition changes
    });
  }

  validate(control: AbstractControl): ValidationErrors | null {
    if (!this.appRequiredIf()) {
      return null;
    }
    const empty = !control.value || (typeof control.value === 'string' && !control.value.trim());
    return empty ? { requiredIf: true } : null;
  }

  registerOnValidatorChange(fn: () => void): void {
    this.onChange = fn;
  }
}
```

### Async validator directives

For async validators in template-driven forms, use `NG_ASYNC_VALIDATORS` and implement `AsyncValidator`:

```ts
@Directive({
  selector: '[appUniqueUsername]',
  providers: [
    {
      provide: NG_ASYNC_VALIDATORS,
      useExisting: forwardRef(() => UniqueUsernameDirective),
      multi: true,
    },
  ],
})
export class UniqueUsernameDirective implements AsyncValidator {
  private userService = inject(UserService);

  validate(control: AbstractControl): Observable<ValidationErrors | null> {
    return this.userService.isUsernameTaken(control.value).pipe(
      map((taken) => (taken ? { usernameTaken: true } : null)),
      catchError(() => of(null)),
    );
  }
}
```

## Submitting the Form

1. Use the `(ngSubmit)` event on the `<form>` element.
2. Bind the submit button's disabled state to the overall form validity using the `NgForm` template reference variable (e.g., `[disabled]="!userForm.form.valid"`).

## Resetting the Form

To programmatically reset the form to its pristine state (clearing values and validation flags), use the `reset()` method on the `NgForm` instance.

```html
<button type="button" (click)="userForm.reset()">Reset</button>
```

## Choosing a Forms Approach

| Consideration                  | Signal Forms (v21+)        | Reactive Forms                  | Template-Driven Forms    |
| :----------------------------- | :------------------------- | :------------------------------ | :----------------------- |
| New project (v21+)             | Preferred                  | Supported                       | Supported                |
| Existing codebase (pre-v21)    | N/A                        | Preferred for complex forms     | Fine for simple forms    |
| Type safety                    | Inferred from signal model | Explicit with typed controls    | Minimal                  |
| Complex validation/cross-field | Schema-based validators    | `ValidatorFn` on `FormGroup`    | Validator directives     |
| Dynamic controls               | Signal model updates       | `FormArray.push()`/`removeAt()` | Structural directives    |
| Testability                    | Signal assertions          | Direct control access           | Requires DOM interaction |
| Learning curve                 | Medium                     | Medium-High                     | Low                      |
| Status                         | Experimental               | Stable                          | Stable                   |
