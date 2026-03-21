import { TestBed } from '@angular/core/testing';
import { ModelStatusComponent } from './model-status.component';

describe('ModelStatusComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModelStatusComponent],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should display a status result after checking availability', async () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    const compiled = fixture.nativeElement as HTMLElement;

    const statusEl = await waitForElement(
      compiled,
      '[data-testid="status-result"]',
    );

    expect(statusEl.getAttribute('data-status')).toMatch(
      /^(available|downloading|downloadable|unavailable)$/,
    );
  }, 30_000);

  it('should show loading state initially', () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const loadingEl = compiled.querySelector('[data-testid="status-loading"]');

    expect(loadingEl).toBeTruthy();
    expect(loadingEl?.textContent?.trim()).toBe(
      'Checking model availability...',
    );
  });

  it('should show prompt input and submit button', async () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    const compiled = fixture.nativeElement as HTMLElement;

    await waitForElement(compiled, '[data-testid="prompt-input"]');

    expect(compiled.querySelector('[data-testid="prompt-input"]')).toBeTruthy();
    expect(
      compiled.querySelector('[data-testid="prompt-submit"]'),
    ).toBeTruthy();
  }, 30_000);

  it('should respond when a prompt is submitted', async () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    const compiled = fixture.nativeElement as HTMLElement;

    // Wait for model to be ready (submit button becomes enabled)
    await waitForElement(
      compiled,
      '[data-testid="prompt-submit"]:not([disabled])',
    );

    const input = compiled.querySelector(
      '[data-testid="prompt-input"]',
    ) as HTMLInputElement;
    const submitBtn = compiled.querySelector(
      '[data-testid="prompt-submit"]',
    ) as HTMLButtonElement;

    input.value = 'Hi!';
    input.dispatchEvent(new Event('input'));
    submitBtn.click();

    const responseEl = await waitForElement(
      compiled,
      '[data-testid="prompt-response"]',
      120_000,
    );

    const responseText = responseEl.textContent?.trim() ?? '';

    console.log(
      `[unit] Component prompt: "Hi!" -> Response: "${responseText}"`,
    );

    expect(responseText.length).toBeGreaterThan(0);

    const errorEl = compiled.querySelector('[data-testid="prompt-error"]');

    expect(errorEl).toBeFalsy();
  }, 300_000);
});

async function waitForElement(
  root: HTMLElement,
  selector: string,
  timeoutMs = 10_000,
): Promise<HTMLElement> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const el = root.querySelector(selector) as HTMLElement | null;

    if (el) {
      return el;
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`Element "${selector}" not found within ${timeoutMs}ms`);
}
