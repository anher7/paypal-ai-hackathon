import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AppConfig, Quote } from '@agree-first/shared';
import { catchError, EMPTY, firstValueFrom, of, switchMap, tap } from 'rxjs';
import { errorCode, errorMessage, QuoteApi } from './quote-api';
import { loadPayPalSdk, PayPalButtons } from './paypal-sdk';
import { MessageComponent, MoneyPipe, SectionTitleComponent, StatusComponent } from './ui';

@Component({
  selector: 'app-review',
  imports: [RouterLink, MatButtonModule, StatusComponent, SectionTitleComponent, MessageComponent, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page review-page"><a routerLink="/" class="back-link">← Your work</a>
      <div class="page-intro compact"><p class="eyebrow">Your agreement</p><h1>Review your agreement</h1><p class="intro-copy">Check the work and price below before paying.</p></div>
      @if (message()) {<app-message [text]="message()" [error]="hasError()" />}
      @if (quote(); as current) {
        @if (current.approved; as approved) {
          <div class="review-grid">
            <article class="paper agreement-paper"><p class="print-only">Agree First · Sandbox prototype · Test money only</p><div class="agreement-top"><p class="eyebrow">AGREEMENT / {{ approved.revision.toString().padStart(2, '0') }}</p><app-status [status]="current.status" /></div><h2 class="agreement-title">{{ approved.title }}</h2><p class="customer-line">Prepared for <strong>{{ approved.customerName }}</strong></p><div class="agreement-rule"></div>
              <section class="scope-section"><app-section-title number="01" title="You’ll get" /><ul class="scope-list">@for (item of approved.included; track $index) {<li>{{ item }}</li>}</ul></section>
              <section class="scope-section"><app-section-title number="02" title="Not included" />@if (approved.excluded.length) {<ul class="scope-list">@for (item of approved.excluded; track $index) {<li>{{ item }}</li>}</ul>} @else {<p class="small-text">No exclusions listed.</p>}</section>
              <section class="scope-section"><app-section-title number="03" title="We need from you" />@if (approved.needs.length) {<ul class="scope-list">@for (item of approved.needs; track $index) {<li>{{ item }}</li>}</ul>} @else {<p class="small-text">No customer inputs listed.</p>}</section>
              <section class="scope-section"><app-section-title number="04" title="Answers and assumptions" />@for (question of approved.questions; track question.id) {<div class="settled-question"><span class="settled-label" [class.assumption]="question.resolution === 'assumption'">{{ question.resolution === 'assumption' ? 'ASSUMPTION' : 'ANSWER' }}</span><h3>{{ question.prompt }}</h3><p>{{ question.response }}</p><span class="small-text">From “{{ question.sourcePhrase }}”</span></div>} @empty {<p class="small-text">No extra questions were added to this agreement.</p>}</section>
              <button mat-stroked-button type="button" class="print-agreement" (click)="printAgreement()">Print / save agreement</button>
              <div class="agreement-signoff"><span class="handwritten-mark" aria-hidden="true">✓</span><p>Scope and price approved by the freelancer.<br><span class="small-text">Revision {{ approved.revision }} · Changes need a new approval.</span></p></div>
            </article>
            <aside class="checkout-panel"><p class="eyebrow">Total price</p><p class="total-price">{{ approved.priceCents | money }}</p><p class="small-text">EUR · The checkout amount matches this total.</p><hr>
              @if (current.status === 'paid' && current.payment; as receipt) {
                <div class="paid-note"><span class="receipt-check" aria-hidden="true">✓</span><h2>Payment received.</h2><p>PayPal confirmed this sandbox payment.</p><dl class="receipt"><dt>Amount</dt><dd>{{ receipt.priceCents | money }}</dd><dt>Capture reference</dt><dd>{{ receipt.captureId }}</dd><dt>Order reference</dt><dd>{{ receipt.orderId }}</dd></dl></div>
              } @else {
                <div class="checkout-actions"><h2>Confirm and pay</h2><p>Check the work, exclusions, and assumptions above before continuing.</p>
                <label class="scope-confirmation"><input type="checkbox" [checked]="accepted()" (change)="setAccepted($event)" [disabled]="capturing()"><span>I agree to this scope, its assumptions, and the total price.</span></label>
                @if (!recoveryChecked()) {<p role="status" class="small-text">Checking previous checkout…</p>}
                @else if (!config()) {<p role="status" class="small-text">Checking sandbox checkout…</p>}
                @else if (!config()?.paypalConfigured) {<div class="checkout-setup"><strong>Sandbox checkout needs setup</strong><p>Add the sandbox credentials to the server environment to enable PayPal.</p></div>}
                @else if (pendingCapture()) {<p class="small-text">PayPal approved this order. Check its payment status below.</p>}
                @else if (accepted()) {<div #paypalContainer class="paypal-container" aria-label="PayPal sandbox checkout"></div>@if (checkoutLoading()) {<p role="status" class="small-text">Loading sandbox checkout…</p>}}
                @else {<p class="small-text">Confirm the agreement to open sandbox checkout.</p>}
                @if (pendingCapture()) {<button mat-stroked-button type="button" (click)="retryCapture()" [disabled]="capturing() || !accepted()">{{ capturing() ? 'Checking payment…' : 'Check payment again' }}</button><p class="small-text">This checks the same PayPal order. It does not create another payment.</p>}
                <p class="sandbox-footnote"><span class="status-dot"></span> Test money only. No real charges.</p></div>
              }
              @if (current.status !== 'paid') {<a mat-button [routerLink]="['/quotes', current.id]" class="edit-link">← Back to editing</a>}
            </aside>
          </div>
        } @else {<div class="paper"><h2>This quote needs your approval.</h2><p>The customer view opens after the freelancer settles the questions and approves the price.</p><a mat-flat-button [routerLink]="['/quotes', current.id]">Review the draft →</a></div>}
      } @else if (!hasError()) {<p role="status">Opening the agreement…</p>}
    </div>
  `,
})
export class ReviewComponent {
  private readonly api = inject(QuoteApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly paypalContainer = viewChild<ElementRef<HTMLElement>>('paypalContainer');
  readonly quote = signal<Quote | null>(null);
  readonly config = signal<AppConfig | null>(null);
  readonly accepted = signal(false);
  readonly capturing = signal(false);
  readonly pendingCapture = signal<{ orderId: string; revision: number } | null>(null);
  readonly checkoutLoading = signal(false);
  readonly recoveryChecked = signal(false);
  readonly message = signal('');
  readonly hasError = signal(false);

  constructor() {
    this.route.paramMap.pipe(
      switchMap((params) => {
        this.accepted.set(false); this.pendingCapture.set(null); this.recoveryChecked.set(false); this.quote.set(null);
        return this.api.get(params.get('id') ?? '').pipe(switchMap((quote) => {
          this.quote.set(quote);
          const recovery = quote.status === 'paid' || !quote.approved ? of(null) : this.api.recovery(quote.id);
          return recovery.pipe(tap((pending) => {
            if (pending) { this.pendingCapture.set({ orderId: pending.orderId, revision: pending.approvedRevision }); }
            this.recoveryChecked.set(true);
          }), catchError((error: unknown) => { this.fail(error); return EMPTY; }));
        }));
      }), takeUntilDestroyed(),
    ).subscribe({ error: (error: unknown) => this.fail(error) });
    this.api.config().pipe(takeUntilDestroyed()).subscribe({ next: (config) => this.config.set(config), error: (error: unknown) => this.fail(error) });
    effect((onCleanup) => {
      const container = this.paypalContainer()?.nativeElement;
      const config = this.config();
      const quote = this.quote();
      const accepted = this.accepted();
      if (!container || !config?.paypalConfigured || !config.paypalClientId || !quote?.approved || quote.status === 'paid' || !accepted) { return; }
      let disposed = false;
      let buttons: PayPalButtons | null = null;
      const approvedRevision = quote.approved.revision;
      this.checkoutLoading.set(true);
      onCleanup(() => { disposed = true; if (buttons) { void buttons.close().catch(() => undefined); } });
      void loadPayPalSdk(config.paypalClientId).then(async (paypal) => {
        if (disposed) { return; }
        buttons = paypal.Buttons({
          style: { layout: 'vertical', shape: 'rect', label: 'pay' },
          createOrder: async () => {
            if (disposed || !this.accepted()) { throw new Error('Confirm the agreement before checkout.'); }
            this.message.set(''); this.hasError.set(false);
            try {
              const order = await firstValueFrom(this.api.order(quote.id, approvedRevision).pipe(takeUntilDestroyed(this.destroyRef)));
              return order.orderId;
            } catch (error: unknown) {
              if (errorCode(error) === 'QUOTE_PAID' && !disposed) {
                const paid = await firstValueFrom(this.api.get(quote.id).pipe(takeUntilDestroyed(this.destroyRef)));
                if (!disposed) { this.quote.set(paid); this.message.set('PayPal has already confirmed payment. Your receipt is up to date.'); this.hasError.set(false); }
              }
              throw error;
            }
          },
          onApprove: async ({ orderID }) => {
            if (disposed) { return; }
            this.pendingCapture.set({ orderId: orderID, revision: approvedRevision });
            await this.capturePayment(quote.id, orderID, approvedRevision);
          },
          onCancel: () => { if (!disposed) { this.hasError.set(false); this.message.set('Checkout cancelled. Your quote is still unpaid and ready when you are.'); } },
          onError: (error: unknown) => { if (!disposed && this.quote()?.status !== 'paid') { this.fail(error); } },
        });
        await buttons.render(container);
        if (!disposed) { this.checkoutLoading.set(false); }
      }).catch((error: unknown) => { if (!disposed) { this.checkoutLoading.set(false); this.fail(error); } });
    });
  }

  printAgreement(): void { window.print(); }

  retryCapture(): void {
    const quote = this.quote();
    const pending = this.pendingCapture();
    if (!quote || !pending || !this.accepted() || this.capturing()) { return; }
    void this.capturePayment(quote.id, pending.orderId, pending.revision);
  }

  private async capturePayment(quoteId: string, orderId: string, revision: number): Promise<void> {
    this.capturing.set(true);
    try {
      const paid = await firstValueFrom(this.api.capture(quoteId, orderId, revision).pipe(takeUntilDestroyed(this.destroyRef)));
      if (this.destroyRef.destroyed || this.quote()?.id !== quoteId) { return; }
      this.quote.set(paid); this.pendingCapture.set(null);
      this.message.set('PayPal confirmed the sandbox payment.'); this.hasError.set(false);
    } catch (error: unknown) {
      if (!this.destroyRef.destroyed && this.quote()?.id === quoteId) { this.fail(error); }
    } finally {
      if (!this.destroyRef.destroyed) { this.capturing.set(false); }
    }
  }
  setAccepted(event: Event): void { this.accepted.set((event.target as HTMLInputElement).checked); }
  private fail(error: unknown): void { this.hasError.set(true); this.message.set(errorMessage(error)); }
}



