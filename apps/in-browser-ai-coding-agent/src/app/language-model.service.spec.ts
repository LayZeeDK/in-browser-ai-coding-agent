import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
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
      'downloading',
      'downloadable',
      'unavailable',
    ];

    expect(validStatuses).toContain(status);
  });

  it('should have a model that is available, downloading, or downloadable', async () => {
    const status = await service.checkAvailability();

    expect(
      status,
      `Expected model to be available, downloading, or downloadable but got "${status}". ` +
        'Ensure the browser has the LanguageModel API enabled and the model profile is bootstrapped.',
    ).toMatch(/^(available|downloading|downloadable)$/);
  });

  it('should detect whether the LanguageModel API is supported', () => {
    // In branded browsers (Chrome Canary, Edge Dev) with feature flags,
    // the API should be defined. In bundled Chromium, it won't be.
    expect(typeof service.isApiSupported).toBe('boolean');
  });

  it('should respond to a prompt', async () => {
    const response = await service.prompt('Hello, World!');

    console.log(
      `[unit] Prompt: "Hello, World!" -> Response: "${response.trim()}"`,
    );

    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThan(0);
  }, 120_000);
});
