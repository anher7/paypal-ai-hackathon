import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { QuoteApi } from './quote-api';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="app-header">
      @if (customerMode()) {<span class="wordmark"><span class="brand-mark">af.</span> Agree First</span>}
      @else {<a routerLink="/" class="wordmark" aria-label="Agree First home"><span class="brand-mark">af.</span> Agree First</a>}
      <span class="header-note">{{ customerMode() ? 'Your customer agreement' : 'Quotes for freelancers' }}</span>
      <span class="sandbox-label"><span class="status-dot"></span> Sandbox only</span>
    </header>
    <main id="main" tabindex="-1"><router-outlet /></main>
    <footer class="app-footer"><span>Agree on the work before payment.</span><span>{{ customerMode() ? 'Private customer link' : hosted() ? 'Private demo workspace' : 'Local workspace' }} · EUR · No real charges</span></footer>
  `,
})
export class AppComponent {
  private readonly router = inject(Router);
  readonly customerMode = signal(this.router.url.split(/[?#]/)[0] === '/customer');
  readonly hosted = signal(false);
  constructor() {
    inject(QuoteApi).config().subscribe({ next: (config) => this.hosted.set(!config.localOnly), error: () => undefined });
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => this.customerMode.set(this.router.url.split(/[?#]/)[0] === '/customer'));
  }
}
