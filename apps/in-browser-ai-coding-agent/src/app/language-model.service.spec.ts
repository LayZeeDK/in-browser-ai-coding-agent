import { TestBed } from '@angular/core/testing';
import {
  LanguageModelService,
  ModelAvailability,
} from './language-model.service';

describe('LanguageModelService', () => {
  let service: LanguageModelService;

  beforeEach(() => {
    service = TestBed.inject(LanguageModelService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should return a valid availability status', async () => {
    const status = await service.checkAvailability();
    const validStatuses: ModelAvailability[] = [
      'available',
      'downloadable',
      'unavailable',
    ];

    expect(validStatuses).toContain(status);
  });

  it('should detect whether the LanguageModel API is supported', () => {
    // In branded browsers (Chrome Canary, Edge Dev) with feature flags,
    // the API should be defined. In bundled Chromium, it won't be.
    expect(typeof service.isApiSupported).toBe('boolean');
  });

  it('should respond to a prompt', async () => {
    const response = await service.prompt('Hi!');

    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(0);
  }, 60_000);
});
