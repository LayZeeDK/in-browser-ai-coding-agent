import { Injectable } from '@angular/core';

export type ModelAvailability =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

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

    if (
      status === 'available' ||
      status === 'downloadable' ||
      status === 'downloading'
    ) {
      return status;
    }

    return 'unavailable';
  }

  async downloadModel(
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    if (!this.isApiSupported) {
      throw new Error('LanguageModel API is not available');
    }

    const session = await LanguageModel.create({
      monitor: (monitor) => {
        if (onProgress) {
          monitor.addEventListener('downloadprogress', (event) => {
            onProgress(event.loaded, event.total);
          });
        }
      },
    });

    session.destroy();
  }

  async prompt(text: string): Promise<string> {
    if (!this.isApiSupported) {
      throw new Error('LanguageModel API is not available');
    }

    const session = await LanguageModel.create();

    try {
      return await session.prompt(text);
    } finally {
      session.destroy();
    }
  }
}
