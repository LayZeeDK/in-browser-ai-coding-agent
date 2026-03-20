import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ModelStatusComponent } from './model-status.component';

@Component({
  imports: [ModelStatusComponent, RouterModule],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected title = 'in-browser-ai-coding-agent';
}
