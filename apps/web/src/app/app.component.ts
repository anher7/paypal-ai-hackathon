import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="app-header">
      <a routerLink="/" class="wordmark" aria-label="Agree First home"><span class="brand-mark">af.</span> Agree First<span class="brand-period">.</span></a>
      <span class="header-note">CLEAR WORK. CLEAR PRICE.</span>
      <span class="sandbox-label"><span class="status-dot"></span> Sandbox only</span>
    </header>
    <main id="main" tabindex="-1"><router-outlet /></main>
    <footer class="app-footer"><span>Make the work clear before anyone pays.</span><span>Local workspace · EUR · No real charges</span></footer>
  `,
})
export class AppComponent {}
