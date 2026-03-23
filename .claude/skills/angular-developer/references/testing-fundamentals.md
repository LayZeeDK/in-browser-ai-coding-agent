# Testing Fundamentals

Unit testing in Angular 21+ with Vitest. Covers the async-first model, signal-based APIs, service testing, and resource/httpResource patterns.

## Table of Contents

1. [Async-First Testing](#async-first-testing)
2. [TestBed and ComponentFixture](#testbed-and-componentfixture)
3. [Testing Signal Inputs and Outputs](#testing-signal-inputs-and-outputs)
4. [Testing Computed Signals](#testing-computed-signals)
5. [Testing Services](#testing-services)
6. [Spy and Mock Patterns (Vitest)](#spy-and-mock-patterns-vitest)
7. [Testing resource()](#testing-resource)
8. [Testing httpResource()](#testing-httpresource)
9. [Async Utilities](#async-utilities)
10. [TestBed Error Behavior](#testbed-error-behavior)

## Async-First Testing

Modern Angular (especially zoneless) schedules state changes asynchronously. Follow the **Act / Wait / Assert** pattern:

1. **Act:** Update state (set an input, click a button, call a method).
2. **Wait:** `await fixture.whenStable()` — lets the framework process updates and render.
3. **Assert:** Verify the DOM or component state.

Use `await fixture.whenStable()` instead of `fixture.detectChanges()`. The latter is for zone-based apps only.

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

describe('MyComponent', () => {
  let fixture: ComponentFixture<MyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MyComponent);
  });

  it('should display the default title', async () => {
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Default Title');
  });
});
```

`compileComponents()` is only required for `@defer` blocks — harmless but unnecessary otherwise.

## TestBed and ComponentFixture

- **`TestBed.configureTestingModule({ imports, providers })`** — creates a test module. Standalone components go in `imports`.
- **`fixture.componentInstance`** — the component class instance.
- **`fixture.nativeElement`** — root DOM element. Use `.querySelector()`.
- **`fixture.debugElement`** — Angular wrapper: `fixture.debugElement.query(By.css('p'))`.
- **`fixture.componentRef`** — used for `setInput()` on signal inputs.

### Getting Injected Services

```ts
// From root injector (providedIn: 'root' or TestBed-level providers)
const service = TestBed.inject(MyService);

// From component injector (component-level providers)
const service = fixture.debugElement.injector.get(MyService);
```

## Testing Signal Inputs and Outputs

### Setting Signal Inputs with `componentRef.setInput()`

Components using `input()` / `input.required()` must receive values through the framework binding mechanism. Use `fixture.componentRef.setInput()`:

```ts
it('should display the user name', async () => {
  fixture.componentRef.setInput('name', 'Alice');

  await fixture.whenStable();

  expect(fixture.nativeElement.querySelector('h2').textContent).toContain('Alice');
});

it('should update when input changes', async () => {
  fixture.componentRef.setInput('name', 'Alice');
  await fixture.whenStable();

  fixture.componentRef.setInput('name', 'Bob');
  await fixture.whenStable();

  expect(fixture.nativeElement.querySelector('h2').textContent).toContain('Bob');
});
```

### Testing Output Emissions

Subscribe to the `output()` and assert after triggering the action:

```ts
it('should emit selected event on click', async () => {
  fixture.componentRef.setInput('name', 'Alice');
  await fixture.whenStable();

  let emitted: string | undefined;
  fixture.componentInstance.selected.subscribe((val: string) => (emitted = val));

  fixture.nativeElement.querySelector('button').click();

  expect(emitted).toBe('Alice');
});
```

### Test Host Pattern (Alternative)

Create a wrapper component that exercises bindings naturally:

```ts
@Component({
  imports: [UserCardComponent],
  template: `<app-user-card [name]="userName" (selected)="onSelected($event)" />`,
})
class TestHost {
  userName = 'Alice';
  selectedUser: string | undefined;
  onSelected(name: string) {
    this.selectedUser = name;
  }
}

it('should emit on click', async () => {
  const fixture = TestBed.createComponent(TestHost);
  await fixture.whenStable();

  fixture.nativeElement.querySelector('button').click();

  expect(fixture.componentInstance.selectedUser).toBe('Alice');
});
```

## Testing Computed Signals

Mutate source signals, await stability, assert derived value or its DOM effect:

```ts
it('should derive fullName from first and last', async () => {
  component.firstName.set('Jane');
  component.lastName.set('Doe');

  await fixture.whenStable();

  expect(fixture.nativeElement.textContent).toContain('Jane Doe');
});
```

## Testing Services

### No Dependencies

```ts
describe('Calculator', () => {
  it('should add two numbers', () => {
    const service = TestBed.inject(Calculator);

    expect(service.add(1, 2)).toBe(3);
  });
});
```

### With Mocked Dependencies

```ts
import { vi, type Mocked } from 'vitest';

const taxStub: Mocked<TaxCalculator> = { calculate: vi.fn() };

beforeEach(() => {
  taxStub.calculate.mockReturnValue(5);

  TestBed.configureTestingModule({
    providers: [{ provide: TaxCalculator, useValue: taxStub }],
  });
});

it('should include tax', () => {
  const service = TestBed.inject(OrderTotal);

  expect(service.total(100)).toBe(105);
  expect(taxStub.calculate).toHaveBeenCalledExactlyOnce();
});
```

### With HTTP Dependencies

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

let service: HeroService;
let httpTesting: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  service = TestBed.inject(HeroService);
  httpTesting = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  httpTesting.verify(); // no unexpected requests
});

it('should fetch heroes', () => {
  service.getHeroes().subscribe((heroes) => {
    expect(heroes).toEqual([{ id: 1, name: 'Hero' }]);
  });

  httpTesting.expectOne('/api/heroes').flush([{ id: 1, name: 'Hero' }]);
});
```

## Spy and Mock Patterns (Vitest)

### `vi.fn()` and `Mocked<T>` — Type-Safe Mocks

```ts
import { vi, type Mocked } from 'vitest';

const mock: Mocked<MyService> = {
  getData: vi.fn(),
  saveData: vi.fn(),
};
mock.getData.mockResolvedValue({ name: 'Test' });
```

### `vi.spyOn()` — Partial Mocking

```ts
const service = TestBed.inject(AuthService);
vi.spyOn(service, 'isAuthenticated').mockReturnValue(true);
```

### Provider Override Strategies

```ts
{ provide: MyService, useValue: serviceMock }   // object literal
{ provide: MyService, useClass: MyServiceStub }  // full stub class
{ provide: MyService, useFactory: () => new MyService(mockDep) }  // factory
```

## Testing resource()

`resource()` calls its loader when tracked signals change. Mock whatever the loader calls and control its responses.

```ts
describe('UserProfileComponent', () => {
  const fetchStub = { getUser: vi.fn() };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserProfileComponent],
      providers: [{ provide: UserFetchService, useValue: fetchStub }],
    }).compileComponents();
    fixture = TestBed.createComponent(UserProfileComponent);
  });

  it('should show loading while fetching', async () => {
    fetchStub.getUser.mockReturnValue(new Promise(() => {})); // never resolves
    fixture.componentRef.setInput('userId', 1);

    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.loading')).toBeTruthy();
  });

  it('should display user on success', async () => {
    fetchStub.getUser.mockResolvedValue({ name: 'Alice' });
    fixture.componentRef.setInput('userId', 1);

    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Alice');
  });

  it('should show error on failure', async () => {
    TestBed.configureTestingModule({ rethrowApplicationErrors: false });
    fetchStub.getUser.mockRejectedValue(new Error('Not found'));
    fixture.componentRef.setInput('userId', 1);

    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.error')).toBeTruthy();
  });

  it('should refetch when input changes', async () => {
    fetchStub.getUser.mockResolvedValue({ name: 'Alice' });
    fixture.componentRef.setInput('userId', 1);
    await fixture.whenStable();

    fetchStub.getUser.mockResolvedValue({ name: 'Bob' });
    fixture.componentRef.setInput('userId', 2);
    await fixture.whenStable();

    expect(fetchStub.getUser).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Bob');
  });
});
```

## Testing httpResource()

`httpResource()` uses `HttpClient` internally, so `HttpTestingController` intercepts its requests. **All HTTP operations in the service must use `HttpClient`** (not native `fetch`) to stay interceptable.

The URL parameter must be a function: `httpResource<T>(() => '/api/todos')`, not a bare string.

```ts
@Injectable({ providedIn: 'root' })
export class TodoService {
  private http = inject(HttpClient);

  readonly todos = httpResource<Todo[]>(() => '/api/todos');

  readonly completedCount = computed(() => this.todos.value()?.filter((t) => t.completed).length ?? 0);

  addTodo(title: string) {
    // Use HttpClient so HttpTestingController can intercept
    this.http.post('/api/todos', { title }).subscribe(() => {
      this.todos.reload();
    });
  }
}
```

```ts
let service: TodoService;
let httpTesting: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  service = TestBed.inject(TodoService);
  httpTesting = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  httpTesting.verify();
});

it('should fetch todos via httpResource', () => {
  const mockTodos: Todo[] = [{ id: 1, title: 'Test', completed: false }];

  // httpResource fires a GET automatically on creation
  httpTesting.expectOne('/api/todos').flush(mockTodos);

  expect(service.todos.value()).toEqual(mockTodos);
});

it('should compute completed count', () => {
  httpTesting.expectOne('/api/todos').flush([
    { id: 1, title: 'A', completed: true },
    { id: 2, title: 'B', completed: false },
  ]);

  expect(service.completedCount()).toBe(1);
});

it('should POST and reload on addTodo', () => {
  httpTesting.expectOne('/api/todos').flush([]); // initial GET

  service.addTodo('New item');

  const postReq = httpTesting.expectOne('/api/todos');
  expect(postReq.request.method).toBe('POST');
  expect(postReq.request.body).toEqual({ title: 'New item' });
  postReq.flush({ id: 1, title: 'New item', completed: false });

  // reload triggers another GET
  httpTesting.expectOne('/api/todos').flush([{ id: 1, title: 'New item', completed: false }]);

  expect(service.todos.value()?.length).toBe(1);
});

it('should handle errors', () => {
  TestBed.configureTestingModule({ rethrowApplicationErrors: false });

  httpTesting.expectOne('/api/todos').flush('Server error', {
    status: 500,
    statusText: 'Internal Server Error',
  });

  expect(service.todos.error()).toBeTruthy();
  expect(service.completedCount()).toBe(0);
});
```

## Async Utilities

### Vitest Fake Timers (Preferred for Zoneless)

```ts
it('should debounce search', async () => {
  vi.useFakeTimers();

  component.onSearchChange('angular');
  await vi.advanceTimersByTimeAsync(300);
  await fixture.whenStable();

  expect(component.searchResults().length).toBeGreaterThan(0);

  vi.useRealTimers();
});
```

Prefer `vi.advanceTimersByTimeAsync()` and `vi.runAllTimersAsync()` over sync counterparts when the code uses promises.

### `fakeAsync` and `tick` (Zone-Based Apps Only)

```ts
import { fakeAsync, tick } from '@angular/core/testing';

it('should debounce search input', fakeAsync(() => {
  component.onSearchChange('angular');
  tick(300);

  expect(component.searchResults().length).toBeGreaterThan(0);
}));
```

## TestBed Error Behavior

`TestBed` rethrows unhandled application errors as test failures by default. When testing error-handling code, disable this per test:

```ts
TestBed.configureTestingModule({
  rethrowApplicationErrors: false,
});
```
