# Route Transition Animations

Angular Router supports the browser's **View Transitions API** for smooth visual transitions between routes. This is a progressive enhancement; navigation works without animation in unsupported browsers.

## Enabling View Transitions

Add `withViewTransitions()` to your router configuration.

```ts
provideRouter(routes, withViewTransitions());
```

## How it Works

1. Browser takes a screenshot of the old state.
2. Router updates the DOM (activates new component).
3. Browser takes a screenshot of the new state.
4. Browser animates between the two states.

## Customizing with CSS

Transitions are customized in **global CSS files** (not component-scoped CSS, because view encapsulation prevents component styles from targeting transition pseudo-elements).

Use the `::view-transition-old()` and `::view-transition-new()` pseudo-elements.

```css
/* Example: Cross-fade + Slide */
::view-transition-old(root) {
  animation: 90ms cubic-bezier(0.4, 0, 1, 1) both fade-out;
}
::view-transition-new(root) {
  animation: 210ms cubic-bezier(0, 0, 0.2, 1) 90ms both fade-in;
}
```

## Shared Element Transitions

Elements with the same `view-transition-name` across routes animate between their positions automatically. The name must be unique across the document at any given moment.

```ts
// Product list: each card gets a unique transition name
<img
  [src]="product.imageUrl"
  [alt]="product.name"
  [style.view-transition-name]="'product-image-' + product.id"
/>

// Product detail: same name formula for the hero image
<img
  [src]="product().imageUrl"
  [alt]="product().name"
  [style.view-transition-name]="'product-image-' + product().id"
  class="hero-image"
/>
```

The browser recognizes matching names and creates a smooth position/size animation between the two elements.

Customize shared element animations with CSS:

```css
::view-transition-old(product-image-*),
::view-transition-new(product-image-*) {
  animation-duration: 300ms;
  animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
```

## Advanced Control

Use `onViewTransitionCreated` to skip transitions or customize behavior based on the navigation context. This callback runs in an injection context and receives `ViewTransitionInfo` with the `ViewTransition` instance and the `from`/`to` `ActivatedRouteSnapshot`.

```ts
withViewTransitions({
  onViewTransitionCreated: ({ transition, from, to }) => {
    // Skip animation for specific routes
    if (to.url === '/no-animation') {
      transition.skipTransition();
    }
  },
});
```

## Best Practices

- **Global Styles**: Always define transition animations in `styles.css` to avoid view encapsulation issues.
- **Unique Names**: Use dynamic `view-transition-name` values (e.g., include the item ID) to avoid name collisions when multiple elements share the same template.
- **Feature Detection**: Angular handles browser support automatically. For CSS, use `@supports (view-transition-name: none)` to gate transition styles.
