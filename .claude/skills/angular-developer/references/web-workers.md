# Web Workers

[Web Workers](https://developer.mozilla.org/docs/Web/API/Web_Workers_API) run CPU-intensive computations in a background thread, keeping the main thread free for UI updates. Use them for heavy calculations, data processing, or AI inference that would otherwise block user interactions.

For the full guide, see the [Angular Web Workers documentation](https://angular.dev/ecosystem/web-workers).

## Adding a Web Worker

Use the Angular CLI to scaffold a web worker:

```bash
ng generate web-worker <location>
```

For example, to add a worker to the app component:

```bash
ng generate web-worker app
```

This creates two files:

### Worker file (`src/app/app.worker.ts`)

```ts
addEventListener('message', ({ data }) => {
  const response = `worker response to ${data}`;
  postMessage(response);
});
```

### Component using the worker (`src/app/app.component.ts`)

```ts
if (typeof Worker !== 'undefined') {
  const worker = new Worker(new URL('./app.worker', import.meta.url));
  worker.onmessage = ({ data }) => {
    console.log(`page got message: ${data}`);
  };
  worker.postMessage('hello');
} else {
  // Web workers are not supported in this environment.
  // Provide a fallback for SSR or unsupported platforms.
}
```

## Communication Pattern

Workers communicate via message passing. Structure messages with a type discriminator for complex interactions:

```ts
// shared types (e.g., worker-messages.ts)
interface WorkerRequest {
  type: 'process';
  payload: unknown;
}

interface WorkerResponse {
  type: 'result' | 'error';
  payload: unknown;
}
```

### Sending work to the worker

```ts
const worker = new Worker(new URL('./heavy-task.worker', import.meta.url));

worker.postMessage({ type: 'process', payload: largeDataset });

worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
  if (data.type === 'result') {
    this.result.set(data.payload);
  }
};
```

### Processing in the worker

```ts
// heavy-task.worker.ts
addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === 'process') {
    const result = performHeavyComputation(data.payload);
    postMessage({ type: 'result', payload: result });
  }
});
```

## Wrapping Workers in a Service

Encapsulate worker lifecycle and communication in an Angular service:

```ts
import { Injectable, OnDestroy } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ComputeService implements OnDestroy {
  private worker: Worker | null = null;

  constructor() {
    if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./compute.worker', import.meta.url));
    }
  }

  compute(data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        // Fallback: run on main thread
        resolve(this.computeFallback(data));

        return;
      }

      this.worker.onmessage = ({ data }) => resolve(data);
      this.worker.onerror = (err) => reject(err);
      this.worker.postMessage(data);
    });
  }

  private computeFallback(data: unknown): unknown {
    // Synchronous fallback for SSR or environments without Worker support
    return data;
  }

  ngOnDestroy() {
    this.worker?.terminate();
  }
}
```

## Limitations

- **No DOM access**: Workers cannot access the DOM, `window`, `document`, or Angular components/services directly.
- **No Angular DI**: Workers run outside Angular's dependency injection system. Share data only through `postMessage`.
- **SSR incompatible**: `@angular/platform-server` does not support web workers. Always provide a fallback.
- **Serialization**: Data sent via `postMessage` is structured-cloned. Functions, DOM nodes, and class instances cannot be transferred. Use `Transferable` objects (e.g., `ArrayBuffer`) for large binary data to avoid copying.
- **Angular CLI limitation**: The Angular CLI itself cannot run in a web worker.

## When to Use Web Workers

- Heavy mathematical or geometric computations (CAD, physics, image processing)
- Large dataset parsing or transformation
- AI model inference (e.g., running ONNX or TensorFlow.js models)
- Compression or encryption operations
- Any task that takes >50ms and would cause visible UI jank

## Transferable Objects

For large binary data, use `Transferable` to move (not copy) data to the worker:

```ts
const buffer = new ArrayBuffer(1024 * 1024); // 1MB
worker.postMessage(buffer, [buffer]);
// buffer is now detached (zero-copy transfer)
```
