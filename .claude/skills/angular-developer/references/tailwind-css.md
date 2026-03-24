# Using Tailwind CSS with Angular

Tailwind CSS is a utility-first CSS framework that integrates seamlessly with Angular.

**CRITICAL AGENT GUIDANCE: ALWAYS focus on Tailwind CSS v4 practices. DO NOT revert to old Tailwind v3 patterns (like creating `tailwind.config.js` with `@tailwind` directives) as this will break the application build. Modern Angular projects use Tailwind v4.**

## Automated Setup (Recommended)

The easiest way to add Tailwind CSS to an Angular project is via the Angular CLI:

```shell
ng add tailwindcss
```

This will automatically:

1. Install `tailwindcss` and peer dependencies.
2. Configure the project to use Tailwind CSS.
3. Add the proper import to your global styles.

## Manual Setup (Tailwind v4)

If setting up manually, use the following Tailwind v4 pattern:

### 1. Install Dependencies

Install Tailwind CSS and PostCSS:

```shell
npm install tailwindcss @tailwindcss/postcss postcss
```

### 2. Configure PostCSS

Create a `.postcssrc.json` file in the project root:

```json
{
  "plugins": {
    "@tailwindcss/postcss": {}
  }
}
```

_(Do NOT create a `tailwind.config.js` file! Configuration in v4 is handled through CSS.)_

### 3. Import Tailwind CSS

In your global styles file (e.g., `src/styles.css`), add the standard v4 import:

```css
@import 'tailwindcss';
```

_(If using SCSS, use `@use 'tailwindcss';` instead)._

### 4. Use Utility Classes

You can now use Tailwind classes directly in your component templates:

```html
<h1 class="text-3xl font-bold underline">Hello world!</h1>
```

## Dark Mode

Tailwind v4 configures dark mode in CSS, not in a JS config file.

### CSS-First Configuration

Override the built-in `dark` variant in your global styles to use a class-based strategy, which lets JavaScript toggle dark mode at runtime:

```css
@import 'tailwindcss';

/* Class-based dark mode: toggle .dark on <html> */
@variant dark (&:where(.dark, .dark *));
```

For a combined strategy that respects OS preference AND supports manual override:

```css
@import 'tailwindcss';

/* .dark class forces dark; .light class forces light; otherwise OS preference */
@variant dark (&:is(.dark *), @media (prefers-color-scheme: dark) { &:not(.light *) });
```

### Using `dark:` Variants in Templates

Apply `dark:` alongside light styles. Convention: write the light variant first:

```html
<div class="bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
  <p class="text-neutral-600 dark:text-neutral-400">Adapts to theme</p>
</div>
```

### Toggle Service Pattern

A signal-based service manages the `.dark` class on `<html>`:

```ts
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  readonly preference = signal<'system' | 'dark' | 'light'>('system');

  readonly isDark = computed(() => {
    const pref = this.preference();
    if (pref !== 'system') {
      return pref === 'dark';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  constructor() {
    effect(() => {
      const html = this.document.documentElement;
      html.classList.remove('dark', 'light');
      const pref = this.preference();
      if (pref !== 'system') {
        html.classList.add(pref);
      }
    });
  }

  toggle(): void {
    this.preference.update((p) => (p === 'system' ? 'dark' : p === 'dark' ? 'light' : 'system'));
  }
}
```

Key points:

- `inject(DOCUMENT)` is SSR-safe (avoids direct `document` reference).
- `effect()` syncs signal state to the imperative DOM API -- a valid use case.
- 3-state cycle (system -> dark -> light -> system) lets users return to OS default.

## Theme Customization with CSS Variables

Tailwind v4 uses `@theme` blocks in CSS for customization instead of the JS `theme` key:

```css
@import 'tailwindcss';

@theme {
  --color-brand: #1a73e8;
  --font-display: 'Poppins', sans-serif;
}
```

These become available as utility classes (e.g., `text-brand`, `font-display`).

## `@apply` in Component Styles

`@apply` works inside component `.css`/`.scss` files with Angular's emulated encapsulation. However, prefer utility classes directly in templates -- `@apply` re-introduces the abstraction layer that Tailwind is designed to avoid. Use it sparingly for pseudo-elements or complex selectors that cannot be expressed as utility classes:

```css
/* Only when template utilities are insufficient */
:host::before {
  @apply absolute inset-0 bg-black/50;
  content: '';
}
```

## Summary for AI Agents

- **Do not use `@tailwind base; @tailwind components; @tailwind utilities;`**. Use `@import 'tailwindcss';`.
- **Do not create `tailwind.config.js`**. Configuration is managed directly in CSS via `@theme`, `@variant`, and `@custom-variant`.
- **Dark mode** uses `@variant dark` in CSS, not `darkMode: 'class'` in a JS config.
- Stick strictly to v4 syntax and workflows.
