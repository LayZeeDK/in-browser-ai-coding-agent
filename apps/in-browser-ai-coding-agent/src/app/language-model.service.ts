import { Injectable } from '@angular/core';

export type ModelAvailability = 'available' | 'downloadable' | 'unavailable';

@Injectable({ providedIn: 'root' })
export class LanguageModelService {
  get isApiSupported(): boolean {
    return typeof LanguageModel !== 'undefined';
  }

  async checkAvailability(): Promise<ModelAvailability> {
    if (!this.isApiSupported) {
      return 'unavailable';
    }

    const status = await LanguageModel.availability();

    return status === 'available'
      ? 'available'
      : status === 'downloadable'
        ? 'downloadable'
        : 'unavailable';
  }
}
