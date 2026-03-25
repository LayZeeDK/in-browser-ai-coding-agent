# Reactive data fetching with httpResource • Angular

> Source: [https://angular.dev/guide/http/http-resource](https://angular.dev/guide/http/http-resource)
> Author: Angular Team

---
**IMPORTANT:** [`httpResource`](/api/common/http/httpResource) is [experimental](reference/releases#experimental). It's ready for you to try, but it might change before it is stable.

[`httpResource`](/api/common/http/httpResource) is a reactive wrapper around [`HttpClient`](/api/common/http/HttpClient) that gives you the request status and response as signals. You can thus use these signals with [`computed`](/api/core/computed), [`effect`](/api/core/effect), [`linkedSignal`](/api/core/linkedSignal), or any other reactive API. Because it's built on top of [`HttpClient`](/api/common/http/HttpClient), [`httpResource`](/api/common/http/httpResource) supports all the same features, such as interceptors.

For more about Angular's [`resource`](/api/core/resource) pattern, see [Async reactivity with](/guide/signals/resource) [`resource`](/api/core/resource).

## [`Using httpResource`](#using-httpresource)

You can define an HTTP resource by returning a url:

```
userId = input.required<string>();user = httpResource(() => `/api/user/${userId()}`); // A reactive function as argument
```

[`httpResource`](/api/common/http/httpResource) is reactive, meaning that whenever one of the signal it depends on changes (like `userId`), the resource will emit a new http request. If a request is already pending, the resource cancels the outstanding request before issuing a new one.

**HELPFUL:** [`httpResource`](/api/common/http/httpResource) differs from the [`HttpClient`](/api/common/http/HttpClient) as it initiates the request _eagerly_. In contrast, the [`HttpClient`](/api/common/http/HttpClient) only initiates requests upon subscription to the returned `Observable`.

For more advanced requests, you can define a request object similar to the request taken by [`HttpClient`](/api/common/http/HttpClient). Each property of the request object that should be reactive should be composed by a signal.

```
user = httpResource(() => ({  url: `/api/user/${userId()}`,  method: 'GET',  headers: {    'X-Special': 'true',  },  params: {    'fast': 'yes',  },  reportProgress: true,  transferCache: true,  keepalive: true,  mode: 'cors',  redirect: 'error',  priority: 'high',  cache: 'force-cache',  credentials: 'include',  referrer: 'no-referrer',  integrity: 'sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GhEXAMPLEKEY=',  referrerPolicy: 'no-referrer',}));
```

**TIP:** Avoid using [`httpResource`](/api/common/http/httpResource) for _mutations_ like `POST` or `PUT`. Instead, prefer directly using the underlying [`HttpClient`](/api/common/http/HttpClient) APIs.

The signals of the [`httpResource`](/api/common/http/httpResource) can be used in the template to control which elements should be displayed.

```
@if(user.hasValue()) {  <user-details [user]="user.value()">} @else if (user.error()) {  <div>Could not load user information</div>} @else if (user.isLoading()) {  <div>Loading user info...</div>}
```

**HELPFUL:** Reading the `value` signal on a [`resource`](/api/core/resource) that is in error state throws at runtime. It is recommended to guard `value` reads with `hasValue()`.

### [Response types](#response-types)

By default, [`httpResource`](/api/common/http/httpResource) returns and parses the response as JSON. However, you can specify alternate return with additional functions on [`httpResource`](/api/common/http/httpResource):

```
httpResource.text(() => ({ … })); // returns a string in value()httpResource.blob(() => ({ … })); // returns a Blob object in value()httpResource.arrayBuffer(() => ({ … })); // returns an ArrayBuffer in value()
```

## [Response parsing and validation](#response-parsing-and-validation)

When fetching data, you may want to validate responses against a predefined schema, often using popular open-source libraries like [Zod](https://zod.dev) or [Valibot](https://valibot.dev). You can integrate validation libraries like this with [`httpResource`](/api/common/http/httpResource) by specifying a `parse` option. The return type of the `parse` function determines the type of the resource's `value`.

The following example uses Zod to parse and validate the response from the [StarWars API](https://swapi.info/). The resource is then typed the same as the output type of Zod’s parsing.

```
const starWarsPersonSchema = z.object({  name: z.string(),  height: z.number({coerce: true}),  edited: z.string().datetime(),  films: z.array(z.string()),});export class CharacterViewer {  id = signal(1);  swPersonResource = httpResource(() => `https://swapi.info/api/people/${this.id()}`, {    parse: starWarsPersonSchema.parse,  });}
```

## [Testing an httpResource](#testing-an-httpresource)

Because [`httpResource`](/api/common/http/httpResource) is a wrapper around [`HttpClient`](/api/common/http/HttpClient), you can test [`httpResource`](/api/common/http/httpResource) with the exact same APIs as [`HttpClient`](/api/common/http/HttpClient). See [HttpClient Testing](/guide/http/testing) for details.

The following example shows a unit test for code using [`httpResource`](/api/common/http/httpResource).
