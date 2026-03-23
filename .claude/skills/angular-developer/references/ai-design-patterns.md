# AI Design Patterns

Angular signals and the `resource` API provide patterns for building AI-powered features with LLM APIs — managing async operations, streaming responses, and building responsive UIs for slow or unreliable requests.

For the full guide, see the [Angular AI Design Patterns documentation](https://angular.dev/ai/design-patterns).

## Triggering Requests with Signals

Separate the user's live input from the submitted value that triggers the API call:

```ts
@Component({
  template: `
    <textarea [(ngModel)]="promptInput"></textarea>
    <button (click)="submitPrompt()">Send</button>
  `,
})
export class ChatComponent {
  // 1. User's live input as they type
  protected promptInput = signal('');

  // 2. Submitted value that triggers the API call
  private submittedPrompt = signal('');

  // 3. Resource only fires when submittedPrompt changes, not on every keystroke
  protected response = resource({
    params: () => this.submittedPrompt(),
    loader: async ({ params: prompt }) => {
      const res = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      });

      return res.json();
    },
  });

  submitPrompt() {
    this.submittedPrompt.set(this.promptInput());
  }
}
```

You can include additional signal parameters (e.g., `sessionId`, `userId`) in the `loader` that are read at call time without re-triggering the resource.

## Preparing LLM Data for Templates

### Typed Resources

Configure LLM APIs to return structured data and type your `resource` accordingly:

```ts
interface StoryData {
  title: string;
  storyParts: string[];
  imageUrl: string;
}

storyResource = resource<StoryData>({
  defaultValue: { title: '', storyParts: [], imageUrl: '' },
  params: () => this.storyInput(),
  loader: async ({ params }): Promise<StoryData> => {
    // Call your LLM API
    return fetchStory(params);
  },
});
```

### Building History with `linkedSignal`

Use `linkedSignal` to accumulate data across multiple LLM responses (e.g., chat history, incremental story parts):

```ts
storyParts = linkedSignal<string[], string[]>({
  // Re-triggers when storyResource returns new data
  source: () => this.storyResource.value().storyParts,
  computation: (newParts, previous) => {
    const existing = previous?.value ?? [];

    // Append new parts to existing history
    return [...existing, ...newParts];
  },
});
```

This preserves previous data while LLMs generate new content — useful for chat interfaces and multi-turn conversations.

## Performance and User Experience

LLM APIs are slower and more error-prone than conventional APIs. Use these patterns:

### Scoped Loading

Place the `resource` in the component that directly uses the data, not in a parent. This limits change detection cycles (especially in zoneless apps) and avoids blocking other parts of the UI:

```ts
// Place in the component that renders the AI content, not in AppComponent
@Component({
  /* ... */
})
export class AiChatPanel {
  protected response = resource({
    /* ... */
  });
}
```

If data needs to be shared, provide the resource from a service.

### Loading and Error States

Use `resource` status to build responsive UIs:

```html
@if (imgResource.isLoading()) {
<div class="placeholder">
  <mat-spinner [diameter]="50" />
</div>
} @else if (imgResource.hasValue()) {
<img [src]="imgResource.value()" alt="AI-generated image" />
} @else {
<div class="placeholder" (click)="imgResource.reload()">
  <mat-icon fontIcon="refresh" />
  <p>Failed to load. Click to retry.</p>
</div>
}
```

Key resource status methods:

- `isLoading()` — request in flight (initial load or reload)
- `hasValue()` — data available
- `error()` — the error if the request failed
- `reload()` — retry failed requests

### SSR with Deferred AI Content

Use SSR with incremental hydration to render the page shell quickly, deferring AI content:

```html
@defer (on viewport) {
<app-ai-chat-panel />
} @placeholder {
<p>Chat loading...</p>
}
```

## Streaming Chat Responses

Display partial results incrementally as LLM response data arrives using the `resource` `stream` property:

```ts
protected chatResponse = resource({
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

Display streaming content in the template:

```html
@if (chatResponse.isLoading()) {
<p>Thinking...</p>
} @else if (chatResponse.hasValue()) {
<div class="response">{{ chatResponse.value() }}</div>
} @else {
<p>Error: {{ chatResponse.error() }}</p>
}
```

The `stream` property accepts an async function that returns a signal of `ResourceStreamItem<T>`. Updates to this signal are reflected in the template as data arrives.

**Import:** `ResourceStreamItem` is imported from `@angular/core`:

```ts
import { resource, signal } from '@angular/core';
import type { ResourceStreamItem } from '@angular/core';
```

Many AI SDKs provide helper methods for streaming. For example, the Genkit client library exposes `streamFlow` for calling Genkit flows, which you can use inside the `stream` function instead of raw `fetch`.

## Keeping Previous Data During Refetch

Use `ResourceSnapshot` and `resourceFromSnapshots` to keep stale data visible while new data loads — avoiding the flash-to-loading-spinner pattern common in AI UIs:

```ts
import { linkedSignal, resourceFromSnapshots, Resource, ResourceSnapshot } from '@angular/core';

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
```

## Summary of Patterns

| Pattern                        | Use Case                               | Angular API                        |
| :----------------------------- | :------------------------------------- | :--------------------------------- |
| Separate input from submission | Prevent requests on every keystroke    | Two signals + `resource.params`    |
| Typed resource                 | Type-safe LLM responses                | `resource<T>` with typed `loader`  |
| Accumulated history            | Chat history, multi-turn conversations | `linkedSignal` with `computation`  |
| Loading/error/retry UI         | Responsive UX for slow APIs            | `resource` status + `reload()`     |
| Deferred AI content            | Fast initial page load                 | `@defer` + SSR hydration           |
| Streaming responses            | Incremental display of LLM output      | `resource.stream` + signal updates |
