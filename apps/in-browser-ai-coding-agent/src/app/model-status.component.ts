import { Component, inject, OnInit, signal } from '@angular/core';
import {
  LanguageModelService,
  ModelAvailability,
} from './language-model.service';

@Component({
  selector: 'app-model-status',
  template: `
    <section class="model-status">
      <h2>On-Device AI Model</h2>

      @if (loading()) {
        <p data-testid="status-loading">Checking model availability...</p>
      } @else {
        <p data-testid="status-result" [attr.data-status]="availability()">
          @switch (availability()) {
            @case ('available') {
              Model is available and ready.
            }
            @case ('downloadable') {
              Model is available for download.
            }
            @case ('unavailable') {
              Model is not available in this browser.
            }
          }
        </p>
      }
    </section>
  `,
  styles: `
    .model-status {
      padding: 1rem;
    }

    [data-status='available'] {
      color: green;
    }

    [data-status='downloadable'] {
      color: orange;
    }

    [data-status='unavailable'] {
      color: red;
    }
  `,
})
export class ModelStatusComponent implements OnInit {
  private readonly languageModel = inject(LanguageModelService);

  protected readonly loading = signal(true);
  protected readonly availability = signal<ModelAvailability>('unavailable');

  async ngOnInit(): Promise<void> {
    const status = await this.languageModel.checkAvailability();
    this.availability.set(status);
    this.loading.set(false);
  }
}
