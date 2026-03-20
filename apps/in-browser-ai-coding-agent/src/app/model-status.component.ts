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

      <form (submit)="onSubmit($event)">
        <input
          data-testid="prompt-input"
          [value]="promptText()"
          (input)="promptText.set($any($event.target).value)"
          placeholder="Enter a prompt..."
        />
        <button type="submit" data-testid="prompt-submit">Send</button>
      </form>

      @if (prompting()) {
        <p data-testid="prompt-loading">Generating response...</p>
      }

      @if (error()) {
        <p data-testid="prompt-error">{{ error() }}</p>
      }

      @if (response()) {
        <p data-testid="prompt-response">{{ response() }}</p>
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
  protected readonly promptText = signal('');
  protected readonly prompting = signal(false);
  protected readonly response = signal('');
  protected readonly error = signal('');

  async ngOnInit(): Promise<void> {
    const status = await this.languageModel.checkAvailability();
    this.availability.set(status);
    this.loading.set(false);
  }

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const text = this.promptText().trim();

    if (!text) {
      return;
    }

    this.prompting.set(true);
    this.response.set('');
    this.error.set('');

    try {
      const result = await this.languageModel.prompt(text);
      this.response.set(result);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.prompting.set(false);
    }
  }
}
