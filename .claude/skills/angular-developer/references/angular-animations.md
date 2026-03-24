# Angular Animations

When animating elements in Angular, **first analyze the project's Angular version** in `package.json`.
For modern applications (**Angular v20.2 and above**), prefer using native CSS with `animate.enter` and `animate.leave`. For older applications, you may need to use the deprecated `@angular/animations` package.

## 1. Native CSS Animations (v20.2+ Recommended)

Modern Angular provides `animate.enter` and `animate.leave` to animate elements as they enter or leave the DOM. They apply CSS classes at the appropriate times.

### `animate.enter` and `animate.leave`

Use these directly on elements to apply CSS classes during the enter or leave phase. Angular automatically removes the enter classes when the animation completes. For `animate.leave`, Angular waits for the animation to finish before removing the element from the DOM.

`animate.enter` example:

```html
@if (isShown()) {
<div class="enter-container" animate.enter="enter-animation">
  <p>The box is entering.</p>
</div>
}
```

```css
.enter-animation {
  animation: slide-fade 1s;
}
@keyframes slide-fade {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### `animate.leave`

Use `animate.leave` to animate elements as they _leave_ the DOM. Angular adds the CSS class and **waits for the animation to finish** before removing the element.

```html
@if (isShown()) {
<div animate.enter="enter-anim" animate.leave="leave-anim">Content</div>
}
```

```css
.leave-anim {
  animation: fade-slide-out 0.5s ease-in;
}
@keyframes fade-slide-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(20px);
  }
}
```

**Important:** `animate.enter` and `animate.leave` only fire when elements enter or leave the DOM (via `@if`, `@for`, etc.). They do NOT fire for show/hide toggles where the element stays in the DOM -- use CSS transitions with class bindings for that.

### Attribute vs Event Binding

There are two forms -- do not mix both on the same element:

- **Attribute** `animate.leave="css-class"` -- Angular applies the CSS class and waits for the CSS animation to finish automatically. Use for CSS-driven animations.
- **Event** `(animate.leave)="handler($event)"` -- Angular calls your function and waits for `animationComplete()`. Use for JS-driven animations (GSAP, Web Animations API).

### Event Bindings for Third-party Libraries

Bind `(animate.leave)` to run JS animations. `AnimationCallbackEvent` does not expose the element -- get it via `viewChild()`.

```html
@if(show()) {
<div #dialog (animate.leave)="onLeave($event)">...</div>
}
```

```ts
import { AnimationCallbackEvent, viewChild, ElementRef } from '@angular/core';

private readonly dialogEl = viewChild<ElementRef>('dialog');

onLeave(event: AnimationCallbackEvent) {
  const el = this.dialogEl()!.nativeElement;
  el.animate(
    [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.9)', opacity: 0 }],
    { duration: 300, easing: 'ease-in' }
  ).finished.then(() => event.animationComplete());
  // CRITICAL: always call animationComplete() or the element is never removed!
}
```

## 2. Advanced CSS Patterns

### Animating State Changes

Toggle CSS classes via property binding to trigger transitions.

```html
<div [class.open]="isOpen">...</div>
```

```css
div {
  transition: height 0.3s ease-out;
  height: 100px;
}
div.open {
  height: 200px;
}
```

### Animating Auto Height

Use `css-grid` to animate to auto height: set `grid-template-rows: 0fr` (closed) / `1fr` (open) with a `transition` on the container, and `overflow: hidden` on the child.

### Staggering List Items with `animate.enter` / `animate.leave`

For lists rendered with `@for`, bind `[style.animation-delay]` per item using the loop index:

```html
@for (item of items(); track item.id; let i = $index) {
<div animate.enter="item-enter" animate.leave="item-leave" [style.animation-delay]="(Math.min(i, 9) * 60) + 'ms'">{{ item.name }}</div>
}
```

```css
.item-enter {
  animation: fade-slide-in 300ms ease-out both;
}
.item-leave {
  animation: fade-slide-out 250ms ease-in both;
}
```

Key points:

- `animation-fill-mode: both` holds the `from` state during the delay, preventing a flash of the final state.
- Cap the index (e.g., `Math.min(i, 9)`) to avoid excessive delays when adding many items at once.
- The delay applies to both enter and leave since the same `[style.animation-delay]` binding is used.

### Parallel Animations

Apply multiple animations in the `animation` shorthand (e.g., `animation: rotate 3s, fade-in 2s;`).

### Programmatic Control

Retrieve animations directly using standard Web APIs:

```ts
const animations = element.getAnimations();
animations.forEach((anim) => anim.pause());
```

## 3. Legacy Animations DSL (Deprecated)

For older projects (pre v20.2), you use `@angular/animations` with `provideAnimationsAsync()`. Do not mix legacy animations and `animate.enter`/`leave` in the same component.

For **route transition animations**, see [route-animations.md](route-animations.md) (`withViewTransitions()`).

```ts
// Setup: bootstrapApplication(App, { providers: [provideAnimationsAsync()] });
import { trigger, state, style, animate, transition } from '@angular/animations';

@Component({
  animations: [trigger('openClose', [state('open', style({ opacity: 1 })), state('closed', style({ opacity: 0 })), transition('open <=> closed', [animate('0.5s')])])],
  template: `<div [@openClose]="isOpen() ? 'open' : 'closed'">...</div>`,
})
export class OpenClose {
  isOpen = signal(true);
}
```
