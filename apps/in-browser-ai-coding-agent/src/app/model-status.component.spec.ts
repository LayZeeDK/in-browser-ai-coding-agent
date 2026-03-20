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
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const statusEl = await waitForElement(
      compiled,
      '[data-testid="status-result"]',
      10_000,
    );

    expect(statusEl.getAttribute('data-status')).toMatch(
      /^(available|downloadable|unavailable)$/,
    );
  });

  it('should show loading state initially', () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    // Don't call whenStable — check the initial state
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const loadingEl = compiled.querySelector('[data-testid="status-loading"]');

    expect(loadingEl).toBeTruthy();
    expect(loadingEl?.textContent?.trim()).toBe(
      'Checking model availability...',
    );
  });

  it('should download model if needed and respond to a prompt', async () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const statusEl = await waitForElement(
      compiled,
      '[data-testid="status-result"]',
      10_000,
    );

    // If model is downloadable, click download and wait for it to become available
    if (statusEl.getAttribute('data-status') === 'downloadable') {
      const downloadBtn = compiled.querySelector(
        '[data-testid="download-button"]',
      ) as HTMLButtonElement;

      downloadBtn.click();

      await waitForElement(compiled, '[data-status="available"]', 300_000);
    }

    // Submit a prompt
    const input = compiled.querySelector(
      '[data-testid="prompt-input"]',
    ) as HTMLInputElement;
    const submitBtn = compiled.querySelector(
      '[data-testid="prompt-submit"]',
    ) as HTMLButtonElement;

    input.value = 'Hi!';
    input.dispatchEvent(new Event('input'));
    submitBtn.click();

    // Wait for response — no error should appear
    const responseEl = await waitForElement(
      compiled,
      '[data-testid="prompt-response"]',
      55_000,
    );

    expect(responseEl.textContent?.trim().length).toBeGreaterThan(0);

    const errorEl = compiled.querySelector('[data-testid="prompt-error"]');

    expect(errorEl).toBeFalsy();
  }, 600_000);
});

async function waitForElement(
  root: HTMLElement,
  selector: string,
  timeoutMs: number,
): Promise<HTMLElement> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const el = root.querySelector(selector) as HTMLElement | null;

    if (el) {
      return el;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Element "${selector}" not found within ${timeoutMs}ms`);
}
