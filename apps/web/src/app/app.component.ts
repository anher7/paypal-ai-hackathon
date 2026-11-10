import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { QuoteApi } from './quote-api';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="app-header">
      <a routerLink="/" class="wordmark" aria-label="Agree First home"><span class="brand-mark">af.</span> Agree First</a>
      <span class="header-note">Quotes for freelancers</span>
      <span class="sandbox-label"><span class="status-dot"></span> Sandbox only</span>
    </header>
    <main id="main" tabindex="-1"><router-outlet /></main>
    <footer class="app-footer"><span>Agree on the work before payment.</span><span>{{ hosted() ? 'Private demo workspace' : 'Local workspace' }} · EUR · No real charges</span></footer>
  `,
})
export class AppComponent {
  readonly hosted = signal(false);
  constructor() { inject(QuoteApi).config().subscribe({ next: (config) => this.hosted.set(!config.localOnly), error: () => undefined }); }
}
