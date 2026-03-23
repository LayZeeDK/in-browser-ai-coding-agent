# Side Effects with `effect` and `afterRenderEffect`

In Angular, an **effect** is an operation that runs whenever one or more signal values it tracks change.

## When to use `effect`

Effects are intended for syncing signal state to imperative, non-signal APIs.

**Valid Use Cases:**

- Logging analytics.
- Syncing state to `localStorage` or `sessionStorage`.
- Performing custom rendering to a `<canvas>` or 3rd-party charting library.

**CRITICAL RULE: DO NOT use effects to propagate state.**
If you find yourself using `.set()` or `.update()` on a signal _inside_ an effect to keep two signals in sync, you are making a mistake. This causes `ExpressionChangedAfterItHasBeenChecked` errors and infinite loops. **Always use `computed()` or `linkedSignal()` for state derivation.**

## Basic Usage

Effects execute asynchronously during the change detection process. They always run at least once.

```ts
import { Component, signal, effect } from '@angular/core';

@Component({...})
export class Example {
  count = signal(0);

  constructor() {
    // Effect must be created in an injection context (e.g., a constructor)
    effect((onCleanup) => {
      console.log(`Count changed to ${this.count()}`);

      const timer = setTimeout(() => console.log('Timer finished'), 1000);

      // Cleanup function runs before the next execution, or when destroyed
      onCleanup(() => clearTimeout(timer));
    });
  }
}
```

### Injection Context

By default, `effect()` must be created in an injection context (constructor, field initializer). To create an effect elsewhere, pass an `Injector`:

```ts
private injector = inject(Injector);

initializeLogging(): void {
  effect(
    () => console.log(`Count: ${this.count()}`),
    { injector: this.injector }
  );
}
```

### View Effects vs Root Effects

Angular distinguishes two kinds of effects based on where they are created:

- **View Effect** (created in a component context): runs _before_ its component is checked during change detection. Destroyed when the component is destroyed.
- **Root Effect** (created in a root-provided service): runs before _all_ components are checked. Destroyed when the application is destroyed.

### Manual Cleanup

Effects are automatically destroyed with their injection context. For manual control, use `manualCleanup` and the returned `EffectRef`:

```ts
const ref = effect(() => console.log(this.count()), { manualCleanup: true });
// Later:
ref.destroy();
```

## One-Time Initialization with `afterNextRender`

For one-time setup that needs DOM access (e.g., initializing a chart library), use `afterNextRender` instead of `afterRenderEffect`:

```ts
import { afterNextRender, viewChild, ElementRef } from '@angular/core';

canvas = viewChild.required<ElementRef>('canvas');

constructor() {
  afterNextRender({
    write: () => {
      this.chart = initializeChart(this.canvas().nativeElement);
    },
  });
}
```

## DOM Manipulation with `afterRenderEffect`

Standard `effect` runs _before_ Angular updates the DOM. If you need to manually inspect or modify the DOM based on a signal change (e.g., integrating a 3rd party UI library), use `afterRenderEffect`.

`afterRenderEffect` runs after Angular has finished rendering the DOM.

### Render Phases

To prevent reflows (forced layout thrashing), `afterRenderEffect` forces you to divide your DOM reads and writes into specific phases.

```ts
import { Component, afterRenderEffect, viewChild, ElementRef } from '@angular/core';

@Component({...})
export class Chart {
  canvas = viewChild.required<ElementRef>('canvas');

  constructor() {
    afterRenderEffect({
      // 1. Read from the DOM
      earlyRead: () => {
        return this.canvas().nativeElement.getBoundingClientRect().width;
      },
      // 2. Write to the DOM (receives the result of the previous phase)
      write: (width) => {
        // NEVER read from the DOM in the write phase.
        setupChart(this.canvas().nativeElement, width);
      }
    });
  }
}
```

**Available Phases (executed in this order):**

1. `earlyRead`
2. `write` (Never read here)
3. `mixedReadWrite` (Avoid if possible)
4. `read` (Never write here)

_Note: `afterRenderEffect` only runs on the client, never during Server-Side Rendering (SSR)._

**Prefer native observers when possible:** Use `ResizeObserver`, `MutationObserver`, or `IntersectionObserver` over `effect`/`afterRenderEffect` when you need to react to DOM changes — they are more efficient and purpose-built for these use cases.
