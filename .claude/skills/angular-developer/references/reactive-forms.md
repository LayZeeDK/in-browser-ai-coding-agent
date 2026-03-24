# Reactive Forms

Model-driven forms built around observable streams with synchronous data model access.

**Core classes** from `@angular/forms`: `FormControl<T>` (individual input), `FormGroup` (object structure), `FormArray` (indexed list), `FormBuilder` / `NonNullableFormBuilder` (factory service).

## Typed Forms (Angular 14+)

All reactive form classes are strictly typed by default. A `FormControl` initialized with a string is `FormControl<string | null>` because `.reset()` sets the value to `null`.

```ts
const name = new FormControl('Alice'); // FormControl<string | null>
name.reset();
console.log(name.value); // null
```

### Eliminating null with `nonNullable`

Use the `nonNullable` option so `.reset()` restores the initial value instead of `null`:

```ts
const name = new FormControl('Alice', { nonNullable: true }); // FormControl<string>
name.reset();
console.log(name.value); // 'Alice'
```

### NonNullableFormBuilder

Use `fb.nonNullable.group()` to make every control in a group non-nullable, eliminating boilerplate:

```ts
private fb = inject(FormBuilder);

profileForm = this.fb.nonNullable.group({
  firstName: ['', Validators.required],
  lastName: [''],
  email: ['', [Validators.required, Validators.email]],
});
// All controls are FormControl<string> (never null)
```

You can also inject `NonNullableFormBuilder` directly:

```ts
private fb = inject(NonNullableFormBuilder);
```

### `getRawValue()` for disabled controls

`FormGroup.value` is `Partial<T>` because disabled controls are excluded. Use `getRawValue()` to get the full typed value including disabled controls:

```ts
const { firstName, lastName, email } = this.profileForm.getRawValue();
// All fields present, even if some controls are disabled
```

## Setup and Template Binding

Import `ReactiveFormsModule`. Use `[formGroup]`, `formControlName`, `formGroupName`, `formArrayName`, `[formControl]` directives.

```ts
@Component({
  selector: 'app-profile-editor',
  imports: [ReactiveFormsModule],
  template: `
    <form [formGroup]="profileForm" (ngSubmit)="onSubmit()">
      <input formControlName="firstName" />
      <div formGroupName="address">
        <input formControlName="street" />
      </div>
      <div formArrayName="aliases">
        @for (alias of aliases.controls; track $index) {
          <input [formControlName]="$index" />
        }
      </div>
      <button type="submit" [disabled]="!profileForm.valid">Submit</button>
    </form>
  `,
})
export class ProfileEditor {
  private fb = inject(FormBuilder);

  profileForm = this.fb.nonNullable.group({
    firstName: ['', Validators.required],
    lastName: [''],
    address: this.fb.nonNullable.group({ street: [''], city: [''] }),
    aliases: this.fb.array([this.fb.nonNullable.control('')]),
  });

  get aliases() {
    return this.profileForm.controls.aliases;
  }

  addAlias() {
    this.aliases.push(this.fb.nonNullable.control(''));
  }

  onSubmit() {
    console.log(this.profileForm.getRawValue());
  }
}
```

## Updating Values

- `patchValue()`: Updates specified properties only. Silently ignores structural mismatches.
- `setValue()`: Replaces entire model. Strictly enforces form structure.

## Custom Validators

### Sync validators (`ValidatorFn`)

A validator is a function that receives a control and returns `ValidationErrors | null`:

```ts
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function forbiddenNameValidator(nameRe: RegExp): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const forbidden = nameRe.test(control.value);
    return forbidden ? { forbiddenName: { value: control.value } } : null;
  };
}

// Usage: pass as second argument (sync validators)
name = new FormControl('', [Validators.required, forbiddenNameValidator(/bob/i)]);
```

### Async validators (`AsyncValidatorFn`)

Async validators return `Observable<ValidationErrors | null>` or `Promise`. They run only after all sync validators pass. The control enters a `pending` state while async validation runs.

```ts
import { AsyncValidatorFn } from '@angular/forms';
import { Observable, map, catchError, of } from 'rxjs';

export function uniqueNameValidator(service: NameService): AsyncValidatorFn {
  return (control: AbstractControl): Observable<ValidationErrors | null> => {
    return service.isNameTaken(control.value).pipe(
      map((isTaken) => (isTaken ? { nameTaken: true } : null)),
      catchError(() => of(null)),
    );
  };
}

// Usage: pass as third argument or via asyncValidators option
username = new FormControl('', {
  validators: [Validators.required, Validators.minLength(3)],
  asyncValidators: [uniqueNameValidator(this.nameService)],
  nonNullable: true,
});
```

### Cross-field validation

Apply a validator to the `FormGroup` (not individual controls) to compare sibling control values:

```ts
export const passwordMatchValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const password = group.get('password');
  const confirm = group.get('confirmPassword');
  return password && confirm && password.value !== confirm.value ? { passwordMismatch: true } : null;
};

// Attach to the FormGroup
form = this.fb.nonNullable.group(
  {
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  },
  { validators: passwordMatchValidator },
);
```

Check the group-level error in the template:

```html
@if (form.hasError('passwordMismatch') && form.get('confirmPassword')?.touched) {
<p class="error">Passwords do not match.</p>
}
```

## Unified Change Events

Angular v18+ provides a single `events` observable on all controls to track value, status, pristine, touched, reset, and submit events.

```ts
import { ValueChangeEvent, StatusChangeEvent } from '@angular/forms';

this.profileForm.events.subscribe((event) => {
  if (event instanceof ValueChangeEvent) {
    console.log('New value:', event.value);
  }
});
```

## Manual State Management

- `markAsTouched()` / `markAllAsTouched()`: Useful for showing validation errors on submit.
- `markAsDirty()` / `markAsPristine()`: Tracks if the value has been modified.
- `updateValueAndValidity()`: Manually triggers recalculation of value and status.
- Options `{ emitEvent: false }` or `{ onlySelf: true }` can be passed to most methods to control propagation.
