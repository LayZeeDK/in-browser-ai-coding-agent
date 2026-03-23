# Security

Angular includes built-in protections against common web vulnerabilities. This reference covers Angular-specific security features and best practices.

For the full guide, see the [Angular Security documentation](https://angular.dev/best-practices/security).

## Cross-Site Scripting (XSS) Prevention

Angular treats all values as untrusted by default. Template bindings and interpolations are automatically sanitized.

### Security Contexts

| Context      | Used When                                         |
| :----------- | :------------------------------------------------ |
| HTML         | Binding to `innerHTML`                            |
| Style        | Binding CSS into the `style` property             |
| URL          | URL properties such as `<a href>`                 |
| Resource URL | URLs loaded and executed as code (`<script src>`) |

### Sanitization

Angular sanitizes untrusted values for HTML and URLs automatically. Resource URLs cannot be sanitized because they contain arbitrary code.

```ts
// Angular sanitizes this automatically — the <script> tag is stripped
@Component({
  template: `<p [innerHTML]="htmlSnippet"></p>`,
})
export class MyComponent {
  htmlSnippet = 'Hello <script>alert("xss")</script> <b>World</b>';
  // Renders: Hello <b>World</b>
}
```

### Trusting Safe Values

When you need to bypass sanitization (e.g., embedding an iframe), use `DomSanitizer`:

```ts
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

export class VideoPlayer {
  private sanitizer = inject(DomSanitizer);
  trustedUrl: SafeResourceUrl;

  updateVideoUrl(id: string) {
    const url = 'https://www.youtube.com/embed/' + id;
    this.trustedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
}
```

Available bypass methods:

- `bypassSecurityTrustHtml`
- `bypassSecurityTrustScript`
- `bypassSecurityTrustStyle`
- `bypassSecurityTrustUrl`
- `bypassSecurityTrustResourceUrl`

**Warning:** Only use these when you have verified the value is safe. These methods are flagged as security-sensitive in Angular's API documentation.

## Content Security Policy (CSP)

The minimal CSP for an Angular application:

```
default-src 'self'; style-src 'self' 'nonce-randomNonceGoesHere'; script-src 'self' 'nonce-randomNonceGoesHere';
```

### Providing the Nonce

Three approaches, in order of preference:

1. **`autoCsp` option** in `angular.json` (simplest):

   ```json
   { "build": { "options": { "security": { "autoCsp": true } } } }
   ```

2. **`ngCspNonce` attribute** on the root element (when you have server-side templating):

   ```html
   <app ngCspNonce="randomNonceGoesHere"></app>
   ```

3. **`CSP_NONCE` injection token** (when the nonce is available at runtime):

   ```ts
   import { bootstrapApplication, CSP_NONCE } from '@angular/core';

   bootstrapApplication(AppComponent, {
     providers: [{ provide: CSP_NONCE, useValue: globalThis.myRandomNonceValue }],
   });
   ```

## Trusted Types

Enable [Trusted Types](https://w3c.github.io/trusted-types/dist/spec/) for an extra layer of XSS protection:

```
Content-Security-Policy: trusted-types angular; require-trusted-types-for 'script';
```

Additional policies as needed:

| Policy                   | When Required                                    |
| :----------------------- | :----------------------------------------------- |
| `angular`                | Always required for Angular to function          |
| `angular#bundler`        | When using lazy-loaded chunks                    |
| `angular#unsafe-bypass`  | When using `bypassSecurityTrust*` methods        |
| `angular#unsafe-jit`     | When running in JIT mode                         |
| `angular#unsafe-upgrade` | When using `@angular/upgrade` (AngularJS hybrid) |

## XSRF / CSRF Protection

Angular's `HttpClient` includes built-in XSRF protection. By default, it reads a token from the `XSRF-TOKEN` cookie and sends it as the `X-XSRF-TOKEN` header on mutating requests (POST, PUT, DELETE).

### Custom Configuration

```ts
import { provideHttpClient, withXsrfConfiguration } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(
      withXsrfConfiguration({
        cookieName: 'CUSTOM_XSRF_TOKEN',
        headerName: 'X-Custom-Xsrf-Header',
      }),
    ),
  ],
};
```

### Disabling (Not Recommended)

```ts
import { provideHttpClient, withNoXsrfProtection } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [provideHttpClient(withNoXsrfProtection())],
};
```

## SSRF Prevention (SSR)

Angular validates `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-Prefix`, and `X-Forwarded-Port` headers. Configure allowed hosts in `angular.json`:

```json
{
  "build": {
    "options": {
      "security": {
        "allowedHosts": ["example.com", "*.example.com"]
      }
    }
  }
}
```

## AOT Compiler

Always use the AOT (Ahead-of-Time) template compiler in production. It prevents template injection vulnerabilities by compiling templates at build time. The Angular CLI uses AOT by default.

## Best Practices

1. Keep Angular libraries up to date.
2. Do not alter your copy of Angular.
3. Avoid APIs marked as "Security Risk" in the documentation.
4. Never construct Angular templates from user input.
5. Use the AOT compiler in all production deployments.
