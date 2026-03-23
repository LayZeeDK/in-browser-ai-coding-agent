# Outputs (Custom Events)

Outputs allow a child component to emit custom events that a parent component can listen to. Angular recommends using the new `output()` function for modern applications.

## Function-based outputs

Declare outputs using the `output()` function. This returns an `OutputEmitterRef`.

```ts
import { Component, output } from '@angular/core';

@Component({
  selector: 'custom-slider',
  template: `<button (click)="changeValue(50)">Set to 50</button>`,
})
export class CustomSlider {
  // Output without event data
  panelClosed = output<void>();

  // Output with event data (number)
  valueChanged = output<number>();

  changeValue(newValue: number) {
    this.valueChanged.emit(newValue);
  }
}
```

### Usage in Template

Bind to the output event using parentheses `()`. If the event emits data, access it using the special `$event` variable.

```html
<custom-slider (panelClosed)="savePanelState()" (valueChanged)="logValue($event)" />
```

## Configuration Options

The `output` function accepts a config object to specify an alias.

```ts
@Component({...})
export class CustomSlider {
  // The event is named 'valueChanged' in the template,
  // but accessed as 'changed' in the component class.
  changed = output<number>({ alias: 'valueChanged' });
}
```

## Programmatic Subscription

When creating components dynamically, you can subscribe to outputs programmatically:

```ts
const componentRef = viewContainerRef.createComponent(CustomSlider);

const subscription = componentRef.instance.valueChanged.subscribe((val) => {
  console.log('Value changed:', val);
});

// Clean up manually if needed (Angular cleans up destroyed components automatically)
subscription.unsubscribe();
```

## Decorator-based Outputs (@Output)

The legacy API uses the `@Output()` decorator with an `EventEmitter`. It remains supported but is not recommended for new code.

```ts
import { Component, Output, EventEmitter } from '@angular/core';

@Component({...})
export class LegacyExample {
  @Output() valueChanged = new EventEmitter<number>();

  // With alias
  @Output('customEventName') changed = new EventEmitter<void>();
}
```

## RxJS Interop

Angular provides two functions in `@angular/core/rxjs-interop` for bridging between outputs and Observables:

- **`outputFromObservable(obs$)`**: Creates an output that emits whenever the Observable emits. Useful when wrapping Observable-based services:

```ts
import { outputFromObservable } from '@angular/core/rxjs-interop';

@Component({
  /* ... */
})
export class SearchBox {
  private searchService = inject(SearchService);

  readonly results = outputFromObservable(this.searchService.results$);
}
```

- **`outputToObservable(outputRef)`**: Converts an `OutputEmitterRef` to an Observable for use in RxJS pipelines:

```ts
import { outputToObservable } from '@angular/core/rxjs-interop';

// In a parent component or test
const obs$ = outputToObservable(childComponent.valueChanged);
obs$.pipe(debounceTime(300)).subscribe((val) => console.log(val));
```

## Best Practices

- **Prefer `output()`**: Use the function-based `output()` instead of `@Output()` and `EventEmitter`.
- **Mark as `readonly`**: Properties initialized by `output()` should be marked `readonly`.
  ```ts
  readonly panelClosed = output<void>();
  readonly valueChanged = output<number>();
  ```
- **Naming**: Use `camelCase` for output names. Avoid prefixing with `on` (e.g., use `valueChanged` instead of `onValueChanged`).
- **No DOM Bubbling**: Angular custom events do not bubble up the DOM tree like native events.
- **Avoid Collisions**: Do not choose names that collide with native DOM events (like `click` or `submit`).
