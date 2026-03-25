# Async Reactivity with `resource`

> [!IMPORTANT]
> The `resource` API (`@angular/core`) is experimental and only available from Angular 21.2 onwards. It does not exist in Angular 19, 20, 21.0, or 21.1. For HTTP data fetching in earlier versions, use `httpResource` (experimental since v19.2) or `HttpClient` directly.

A `Resource` incorporates asynchronous data fetching into Angular's signal-based reactivity. It executes an async loader function whenever its dependencies change, exposing the status and result as synchronous signals.

## Basic Usage

The `resource` function accepts an options object with two main properties:

1. `params`: A reactive computation (like `computed`). When signals read here change, the resource re-fetches.
2. `loader`: An async function (returns `Promise`) that fetches data based on the parameters. Use `stream` instead of `loader` for Observable-based or streaming responses (see Streaming and rxResource sections below).

> **v21.2+ only:** `resource()` uses `params` and `loader` (Promise) or `stream` (Observable/streaming). Cannot use both `loader` and `stream` at the same time.

```ts
import { Component, resource, signal, computed } from '@angular/core';

@Component({...})
export class UserProfile {
  userId = signal('123');

  userResource = resource({
    // Reactively tracking userId
    params: () => ({ id: this.userId() }),

    // Executes whenever params change
    loader: async ({ params, abortSignal }) => {
      const response = await fetch(`/api/users/${params.id}`, { signal: abortSignal });
      if (!response.ok) throw new Error('Network error');
      return response.json();
    }
  });

  // Use the resource value in computed signals
  userName = computed(() => {
    if (this.userResource.hasValue()) {
      return this.userResource.value()?.name;
    } else {
      return 'Loading...';
    }
  });
}
```

## Idle State

If the `params` computation returns `undefined`, the loader does **not** run and the resource status becomes `'idle'`. This is useful for conditionally disabling the resource:

```ts
userResource = resource({
  params: () => {
    const id = this.userId();
    // Return undefined to skip fetching
    return id ? { id } : undefined;
  },
  loader: ({ params }) => fetchUser(params),
});
```

## Resource Loaders

The loader receives a `ResourceLoaderParams` object with three properties:

| Property      | Description                                          |
| :------------ | :--------------------------------------------------- |
| `params`      | The value produced by the `params` computation       |
| `previous`    | Object with `status` — the previous `ResourceStatus` |
| `abortSignal` | An `AbortSignal` for cancelling in-flight requests   |

## Aborting Requests

If the `params` signal changes while a previous loader is still running, the `Resource` will attempt to abort the outstanding request using the provided `abortSignal`. **Always pass `abortSignal` to your `fetch` calls.**

```ts
loader: async ({ params, abortSignal }) => {
  const response = await fetch(`/api/users/${params.id}`, { signal: abortSignal });
  return response.json();
};
```

## Reloading Data

You can imperatively force the resource to re-run the loader without the params changing by calling `.reload()`. During a reload, `value()` retains the previous result (status becomes `'reloading'`), so you can keep showing old data while fresh data loads.

```ts
this.userResource.reload();
```

## Resource Status Signals

The `Resource` object provides several signals to read its current state:

- `value()`: The resolved data, or `undefined`.
- `hasValue()`: Type-guard boolean. `true` if a value exists (including during reloads).
- `isLoading()`: Boolean indicating if the loader is currently running (initial load or reload).
- `error()`: The error thrown by the loader, or `undefined`.
- `status()`: A string constant representing the exact state.

| Status        | `value()`         | Description                                                |
| :------------ | :---------------- | :--------------------------------------------------------- |
| `'idle'`      | `undefined`       | No valid params — loader has not run                       |
| `'loading'`   | `undefined`       | Loader running from params change                          |
| `'reloading'` | Previous value    | Loader running from `.reload()` — old data still available |
| `'resolved'`  | Resolved value    | Loader completed successfully                              |
| `'error'`     | `undefined`       | Loader threw an error                                      |
| `'local'`     | Locally set value | Value set via `.set()` or `.update()`                      |

## Local Mutation

You can optimistically update the resource's value directly. This changes the status to `'local'`.

```ts
this.userResource.value.set({ name: 'Optimistic Update' });
```

## Streaming with `resource.stream`

For incremental data delivery (e.g., LLM token-by-token responses), use the `stream` property instead of `loader`. The stream function returns a signal of `ResourceStreamItem<T>` that you update as data arrives:

```ts
import { resource, signal } from '@angular/core';
import type { ResourceStreamItem } from '@angular/core';

chatResponse = resource({
  stream: async () => {
    const data = signal<ResourceStreamItem<string>>({ value: '' });

    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      body: JSON.stringify({ prompt: this.submittedPrompt() }),
    });

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    (async () => {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        data.update((prev) => {
          if ('value' in prev) {
            return { value: prev.value + chunk };
          }

          return prev;
        });
      }
    })();

    return data;
  },
});
```

The resource's `value()`, `isLoading()`, `hasValue()`, and `error()` signals work the same way with streaming — the template updates reactively as the signal is updated.

## Resource Composition with Snapshots

A `ResourceSnapshot` captures a resource's current state (status + value or error). Use `resourceFromSnapshots` to compose resources with signal APIs like `computed` and `linkedSignal`:

```ts
import { linkedSignal, resourceFromSnapshots, Resource, ResourceSnapshot } from '@angular/core';

// Keep the previous value visible while a new one loads
function withPreviousValue<T>(input: Resource<T>): Resource<T> {
  const derived = linkedSignal<ResourceSnapshot<T>, ResourceSnapshot<T>>({
    source: input.snapshot,
    computation: (snap, previous) => {
      if (snap.status === 'loading' && previous && previous.value.status !== 'error') {
        return { status: 'loading' as const, value: previous.value.value };
      }

      return snap;
    },
  });

  return resourceFromSnapshots(derived);
}

// Usage
user = withPreviousValue(httpResource(() => `/user/${this.userId()}`));
```

This pattern is useful for keeping stale data visible during refetches without flickering to a loading state.

## Reactive Data Fetching with `httpResource`

If you are using Angular's `HttpClient`, prefer using `httpResource`. It is a specialized wrapper that leverages the Angular HTTP stack (including interceptors) while providing the same signal-based resource API.

```ts
import { httpResource } from '@angular/common/http';

userResource = httpResource<User>(() => `/api/users/${this.userId()}`);
```

## RxJS-Based Resources with `rxResource`

`rxResource` (from `@angular/core/rxjs-interop`) is like `resource` but accepts an Observable-based `stream` function instead of a Promise-based `loader`. Use it when your data layer already returns Observables (e.g., HttpClient):

```ts
import { rxResource } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';

userResource = rxResource<User, { id: string }>({
  params: () => ({ id: this.userId() }),
  stream: ({ params }) => this.http.get<User>(`/api/users/${params.id}`),
});
```

The `stream` function receives `ResourceLoaderParams<R>` (with `params` and `abortSignal`) and must return an `Observable<T>`. The resource automatically unsubscribes from the previous Observable when params change.

> **API rename in v20:** Angular 19's `rxResource` used `request` and `loader`. Angular 20+ renamed these to `params` and `stream`. Do not use `request`/`loader` with `rxResource` in v20+ projects -- the compiler will reject them.
