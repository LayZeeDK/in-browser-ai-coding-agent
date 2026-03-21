import { TestBed } from '@angular/core/testing';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ModelStatusComponent } from './model-status.component';

describe('ModelStatusComponent', () => {
  // Warm up the model so cold-start latency doesn't eat into individual test timeouts
  beforeAll(async () => {
    if (typeof LanguageModel !== 'undefined') {
      const session = await LanguageModel.create();
      session.destroy();
    }
  }, 300_000);

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

  it('should have a model that is available, downloading, or downloadable', async () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    const compiled = fixture.nativeElement as HTMLElement;

    const statusEl = await waitForElement(
      compiled,
      '[data-testid="status-result"]',
    );
    const status = statusEl.getAttribute('data-status');

    expect(
      status,
      `Expected model to be available, downloading, or downloadable but got "${status}". ` +
        'Ensure the browser has the LanguageModel API enabled and the model profile is bootstrapped.',
    ).toMatch(/^(available|downloading|downloadable)$/);
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

    input.value = 'Hello, World!';
    input.dispatchEvent(new Event('input'));
    submitBtn.click();

    // Wait for either a response or an error — whichever appears first
    const resultEl = await waitForElement(
      compiled,
      '[data-testid="prompt-response"], [data-testid="prompt-error"]',
      120_000,
    );

    const testId = resultEl.getAttribute('data-testid');

    if (testId === 'prompt-error') {
      expect.fail(`Prompt failed with error: ${resultEl.textContent?.trim()}`);
    }

    const responseText = resultEl.textContent?.trim() ?? '';

    console.log(
      `[unit] Component prompt: "Hello, World!" -> Response: "${responseText}"`,
    );

    expect(responseText.length).toBeGreaterThan(0);
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
