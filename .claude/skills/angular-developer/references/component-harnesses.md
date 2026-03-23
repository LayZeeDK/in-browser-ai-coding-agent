# Testing with Component Harnesses

Component harnesses provide a robust, user-centric API for interacting with components in tests. They insulate tests from internal DOM structure changes.

## Why Use Harnesses?

- **Robustness:** Tests don't break when you refactor internal HTML/CSS.
- **Readability:** Interactions read like user actions (`button.click()`, `slider.getValue()`).
- **Reusability:** The same harness works in both unit and E2E tests.

Angular Material provides a harness for every component in its library.

## Using Material Harnesses

```ts
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { HarnessLoader } from '@angular/cdk/testing';
import { MatButtonHarness } from '@angular/material/button/testing';

let fixture: ComponentFixture<MyComponent>;
let loader: HarnessLoader;

beforeEach(async () => {
  await TestBed.configureTestingModule({
    imports: [MyComponent, MatButtonModule],
  }).compileComponents();

  fixture = TestBed.createComponent(MyComponent);
  loader = TestbedHarnessEnvironment.loader(fixture);
});

it('should find and click a submit button', async () => {
  const button = await loader.getHarness(MatButtonHarness.with({ text: 'Submit' }));

  expect(await button.isDisabled()).toBe(false);
  await button.click();
});
```

## Creating Custom Harnesses

Extend `ComponentHarness` to create harnesses for your own components.

### Step 1: Define the Harness Class

```ts
import { ComponentHarness, HarnessPredicate, TestElement } from '@angular/cdk/testing';

export interface DatePickerHarnessFilters {
  disabled?: boolean;
}

export class DatePickerHarness extends ComponentHarness {
  static readonly hostSelector = 'app-date-picker';

  // Locators — resolve to TestElement instances
  private readonly getInput = this.locatorFor('input[type="date"]');
  private readonly getClearBtn = this.locatorFor('[data-testid="clear-btn"]');
  private readonly getError = this.locatorForOptional('[data-testid="error"]');

  // Static factory for filtering
  static with(options: DatePickerHarnessFilters = {}): HarnessPredicate<DatePickerHarness> {
    return new HarnessPredicate(DatePickerHarness, options).addOption('disabled', options.disabled, async (harness, disabled) => {
      return (await harness.isDisabled()) === disabled;
    });
  }

  async getValue(): Promise<string> {
    return (await this.getInput()).getProperty<string>('value');
  }

  async setValue(isoDate: string): Promise<void> {
    const input = await this.getInput();
    await input.clear();
    await input.sendKeys(isoDate);
    await input.dispatchEvent('change');
  }

  async clickClear(): Promise<void> {
    await (await this.getClearBtn()).click();
  }

  async hasError(): Promise<boolean> {
    return (await this.getError()) !== null;
  }

  async getErrorText(): Promise<string | null> {
    const el = await this.getError();
    return el ? (await el.text()).trim() : null;
  }

  async isDisabled(): Promise<boolean> {
    return (await this.getInput()).getProperty<boolean>('disabled');
  }
}
```

### Step 2: Key APIs

**`this.locatorFor(selector)`** — returns a function that resolves to a `TestElement`. Throws if not found.

**`this.locatorForOptional(selector)`** — returns `null` instead of throwing. Use for conditional elements (error messages, optional badges).

**`this.locatorForAll(selector)`** — returns all matching `TestElement` instances.

**`TestElement` API:**

- `click()`, `sendKeys(text)`, `clear()` — user interactions
- `text()` — visible text content
- `getProperty<T>(name)` — DOM property (`value`, `disabled`, `checked`)
- `getAttribute(name)` — HTML attribute
- `dispatchEvent(name)` — custom events like `change`, `input`
- `isFocused()`, `blur()`, `focus()` — focus management

### Step 3: `HarnessPredicate` for Filtering

`HarnessPredicate` lets callers filter harness instances by component state:

```ts
// Usage in tests
const disabledPicker = await loader.getHarness(DatePickerHarness.with({ disabled: true }));
```

`addOption(name, value, predicate)` registers a filter. The predicate receives the harness and the value, returning a boolean.

### Step 4: `parallel()` for Batch Operations

Use `parallel` from `@angular/cdk/testing` to run multiple harness queries concurrently:

```ts
import { parallel } from '@angular/cdk/testing';

it('should read all values at once', async () => {
  const harness = await loader.getHarness(DateRangeHarness);

  const [start, end, hasError] = await parallel(() => [harness.getStartDate(), harness.getEndDate(), harness.hasError()]);

  expect(start).toBe('2024-01-01');
  expect(end).toBe('2024-12-31');
  expect(hasError).toBe(false);
});
```

## Testing with Custom Harnesses

```ts
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';

let loader: HarnessLoader;

beforeEach(async () => {
  await TestBed.configureTestingModule({
    imports: [DatePickerComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(DatePickerComponent);
  loader = TestbedHarnessEnvironment.loader(fixture);
});

it('should get and set the date value', async () => {
  const picker = await loader.getHarness(DatePickerHarness);

  await picker.setValue('2024-06-15');

  expect(await picker.getValue()).toBe('2024-06-15');
});

it('should show validation error for invalid dates', async () => {
  const picker = await loader.getHarness(DatePickerHarness);

  await picker.setValue('invalid');

  expect(await picker.hasError()).toBe(true);
  expect(await picker.getErrorText()).toContain('Invalid date');
});

it('should clear the value', async () => {
  const picker = await loader.getHarness(DatePickerHarness);
  await picker.setValue('2024-06-15');

  await picker.clickClear();

  expect(await picker.getValue()).toBe('');
  expect(await picker.hasError()).toBe(false);
});

it('should filter by disabled state', async () => {
  const enabled = await loader.getAllHarnesses(DatePickerHarness.with({ disabled: false }));

  expect(enabled.length).toBe(1);
});
```

## Key Concepts Summary

| Concept                             | Purpose                                           |
| ----------------------------------- | ------------------------------------------------- |
| `HarnessLoader`                     | Entry point — finds and creates harness instances |
| `loader.getHarness(Class)`          | First matching harness (throws if none)           |
| `loader.getAllHarnesses(Class)`     | All matching harnesses                            |
| `Class.with({ ... })`               | Filter via `HarnessPredicate`                     |
| `locatorFor` / `locatorForOptional` | Find child elements within the harness            |
| `TestElement`                       | Platform-agnostic DOM interaction                 |
| `parallel()`                        | Batch async operations for performance            |
