# Setting up HttpClient • Angular

> Source: [https://angular.dev/guide/http/setup](https://angular.dev/guide/http/setup)
> Author: Angular Team

---
Before you can use [`HttpClient`](/api/common/http/HttpClient) in your app, you must configure it using [dependency injection](guide/di).

## [Providing `HttpClient` through dependency injection](#providing-httpclient-through-dependency-injection)

[`HttpClient`](/api/common/http/HttpClient) is provided using the [`provideHttpClient`](/api/common/http/provideHttpClient) helper function, which most apps include in the application `providers` in `app.config.ts`.

If your app is using NgModule-based bootstrap instead, you can include [`provideHttpClient`](/api/common/http/provideHttpClient) in the providers of your app's NgModule:

You can then inject the [`HttpClient`](/api/common/http/HttpClient) service as a dependency of your components, services, or other classes:

```
@Injectable({providedIn: 'root'})export class ConfigService {  private http = inject(HttpClient);  // This service can now make HTTP requests via `this.http`.}
```

## [Configuring features of `HttpClient`](#configuring-features-of-httpclient)

[`provideHttpClient`](/api/common/http/provideHttpClient) accepts a list of optional feature configurations, to enable or configure the behavior of different aspects of the client. This section details the optional features and their usages.

### [`withFetch`](#withfetch)

By default, [`HttpClient`](/api/common/http/HttpClient) uses the [`XMLHttpRequest`](https://developer.mozilla.org/docs/Web/API/XMLHttpRequest) API to make requests. The [`withFetch`](/api/common/http/withFetch) feature switches the client to use the [`fetch`](https://developer.mozilla.org/docs/Web/API/Fetch_API) API instead.

`fetch` is a more modern API and is available in a few environments where `XMLHttpRequest` is not supported. It does have a few limitations, such as not producing upload progress events.

### [`withInterceptors(...)`](#withinterceptors)

[`withInterceptors`](/api/common/http/withInterceptors) configures the set of interceptor functions which will process requests made through [`HttpClient`](/api/common/http/HttpClient). See the [interceptor guide](guide/http/interceptors) for more information.

### [`withInterceptorsFromDi()`](#withinterceptorsfromdi)

[`withInterceptorsFromDi`](/api/common/http/withInterceptorsFromDi) includes the older style of class-based interceptors in the [`HttpClient`](/api/common/http/HttpClient) configuration. See the [interceptor guide](guide/http/interceptors) for more information.

**HELPFUL:** Functional interceptors (through [`withInterceptors`](/api/common/http/withInterceptors)) have more predictable ordering and we recommend them over DI-based interceptors.

### [`withRequestsMadeViaParent()`](#withrequestsmadeviaparent)

By default, when you configure [`HttpClient`](/api/common/http/HttpClient) using [`provideHttpClient`](/api/common/http/provideHttpClient) within a given injector, this configuration overrides any configuration for [`HttpClient`](/api/common/http/HttpClient) which may be present in the parent injector.

When you add [`withRequestsMadeViaParent()`](/api/common/http/withRequestsMadeViaParent), [`HttpClient`](/api/common/http/HttpClient) is configured to instead pass requests up to the [`HttpClient`](/api/common/http/HttpClient) instance in the parent injector, once they've passed through any configured interceptors at this level. This is useful if you want to _add_ interceptors in a child injector, while still sending the request through the parent injector's interceptors as well.

**CRITICAL:** You must configure an instance of [`HttpClient`](/api/common/http/HttpClient) above the current injector, or this option is not valid and you'll get a runtime error when you try to use it.

### [`withJsonpSupport()`](#withjsonpsupport)

Including [`withJsonpSupport`](/api/common/http/withJsonpSupport) enables the `.jsonp()` method on [`HttpClient`](/api/common/http/HttpClient), which makes a GET request via the [JSONP convention](https://en.wikipedia.org/wiki/JSONP) for cross-domain loading of data.

**HELPFUL:** Prefer using [CORS](https://developer.mozilla.org/docs/Web/HTTP/CORS) to make cross-domain requests instead of JSONP when possible.

### [`withXsrfConfiguration(...)`](#withxsrfconfiguration)

Including this option allows for customization of [`HttpClient`](/api/common/http/HttpClient)'s built-in XSRF security functionality. See the [security guide](best-practices/security) for more information.

### [`withNoXsrfProtection()`](#withnoxsrfprotection)

Including this option disables [`HttpClient`](/api/common/http/HttpClient)'s built-in XSRF security functionality. See the [security guide](best-practices/security) for more information.

## [`HttpClientModule`\-based configuration](#httpclientmodule-based-configuration)

Some applications may configure [`HttpClient`](/api/common/http/HttpClient) using the older API based on NgModules.

This table lists the NgModules available from `@angular/common/http` and how they relate to the provider configuration functions above.

| **NgModule** | [`provideHttpClient()`](/api/common/http/provideHttpClient) equivalent |
| --- | --- |
| [`HttpClientModule`](/api/common/http/HttpClientModule) | `provideHttpClient(withInterceptorsFromDi())` |
| [`HttpClientJsonpModule`](/api/common/http/HttpClientJsonpModule) | [`withJsonpSupport()`](/api/common/http/withJsonpSupport) |
| `HttpClientXsrfModule.withOptions(...)` | `withXsrfConfiguration(...)` |
| [`HttpClientXsrfModule.disable()`](/api/common/http/HttpClientXsrfModule#disable) | [`withNoXsrfProtection()`](/api/common/http/withNoXsrfProtection) |

### Use caution when using HttpClientModule in multiple injectors

When [`HttpClientModule`](/api/common/http/HttpClientModule) is present in multiple injectors, the behavior of interceptors is poorly defined and depends on the exact options and provider/import ordering.

Prefer [`provideHttpClient`](/api/common/http/provideHttpClient) for multi-injector configurations, as it has more stable behavior. See the [`withRequestsMadeViaParent`](/api/common/http/withRequestsMadeViaParent) feature above.
