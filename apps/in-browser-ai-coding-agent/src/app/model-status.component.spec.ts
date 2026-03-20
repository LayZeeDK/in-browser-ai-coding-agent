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
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const statusEl = compiled.querySelector('[data-testid="status-result"]');

    expect(statusEl).toBeTruthy();
    expect(statusEl?.getAttribute('data-status')).toMatch(
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

  it('should show prompt input and submit button', async () => {
    const fixture = TestBed.createComponent(ModelStatusComponent);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('[data-testid="prompt-input"]')).toBeTruthy();
    expect(
      compiled.querySelector('[data-testid="prompt-submit"]'),
    ).toBeTruthy();
  });
});
