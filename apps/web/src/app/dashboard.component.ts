import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { AppConfig, ExampleRequest, Quote } from '@agree-first/shared';
import { switchMap } from 'rxjs';
import { errorMessage, QuoteApi } from './quote-api';
import { MessageComponent, MoneyPipe, SectionTitleComponent, StatusComponent } from './ui';

@Component({
  selector: 'app-dashboard',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, StatusComponent, MoneyPipe, SectionTitleComponent, MessageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page dashboard-page">
      <div class="page-intro"><p class="eyebrow">For freelancers and small studios</p><h1>Get the scope agreed before you get paid.</h1><p class="intro-copy">Turn a customer request into a quote that spells out the work, the price and what’s not included.</p></div>
      @if (message()) {<app-message [text]="message()" [error]="hasError()" />}
      <div class="dashboard-grid">
        <section class="paper new-quote-panel">
          <app-section-title number="01" title="Create a quote" hint="Start with the customer’s request. Set the price after reviewing the scope." />
          <form [formGroup]="form" (ngSubmit)="createQuote()">
            <mat-form-field appearance="outline"><mat-label>Work title</mat-label><input matInput formControlName="title" maxlength="160" placeholder="A website for a local studio">@if (form.controls.title.invalid) {<mat-error>Add a short title.</mat-error>}</mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Customer name</mat-label><input matInput formControlName="customerName" maxlength="160" placeholder="Who is asking?">@if (form.controls.customerName.invalid) {<mat-error>Add a customer name.</mat-error>}</mat-form-field>
            <mat-form-field appearance="outline"><mat-label>Customer request</mat-label><textarea matInput formControlName="request" rows="5" maxlength="10000" placeholder="We need a website with a booking form…"></textarea>@if (form.controls.request.invalid) {<mat-error>Paste or write a request.</mat-error>}</mat-form-field>
            <button mat-flat-button type="submit" [disabled]="busy()">{{ busy() ? 'Opening your quote…' : 'New quote →' }}</button>
          </form>
        </section>
        <aside class="example-panel">
          <span class="example-tab">Try an example</span><p class="eyebrow">Sample request</p>
          <h2>What does “booking form” include?</h2>
          <p>An email form and a live booking calendar are different jobs. Clear up the difference before agreeing on a price.</p>
          @for (example of examples(); track example.id) {
            <blockquote>{{ example.request }}</blockquote><p class="small-text">{{ example.description }}</p>
            <button mat-stroked-button type="button" (click)="useExample(example)" [disabled]="busy()">Use this example →</button>
          }
          <div class="example-note"><span>↳</span><p>Example drafting is available.<br>{{ config()?.aiMode === 'live' && config()?.aiConfigured ? 'Live AI drafting is available for new requests.' : 'Live AI needs setup. Write any request by hand.' }}</p></div>
        </aside>
      </div>
      <section class="saved-work">
        <div class="work-heading"><app-section-title number="02" title="Your saved quotes" /><span class="small-text">{{ quotes().length }} {{ quotes().length === 1 ? 'quote' : 'quotes' }}</span></div>
        @if (loading()) {<p role="status" class="empty-state">Loading quotes…</p>}
        @else if (quotes().length === 0) {<div class="empty-state"><span class="empty-symbol">↗</span><div><h3>No quotes yet.</h3><p>Create a quote above or try the sample request.</p></div></div>}
        @else {<div class="quote-list">@for (quote of quotes(); track quote.id) {
          <a [routerLink]="quote.status === 'paid' ? ['/review', quote.id] : ['/quotes', quote.id]" class="quote-row"><div><span class="small-text">{{ quote.customerName }}</span><h3>{{ quote.title }}</h3></div><app-status [status]="quote.status" /><strong class="quote-price">{{ quote.priceCents | money }}</strong><span class="row-arrow" aria-hidden="true">↗</span></a>
        }</div>}
      </section>
    </div>
  `,
})
export class DashboardComponent {
  private readonly api = inject(QuoteApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  readonly form = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(160)]],
    customerName: ['', [Validators.required, Validators.maxLength(160)]],
    request: ['', [Validators.required, Validators.maxLength(10000)]],
  });
  readonly quotes = signal<Quote[]>([]);
  readonly examples = signal<ExampleRequest[]>([]);
  readonly config = signal<AppConfig | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly hasError = signal(false);

  constructor() {
    this.api.config().pipe(takeUntilDestroyed()).subscribe({ next: (config) => this.config.set(config), error: () => this.config.set(null) });
    this.api.list().pipe(takeUntilDestroyed()).subscribe({ next: (quotes) => { this.quotes.set(quotes); this.loading.set(false); }, error: (error: unknown) => { this.fail(error); this.loading.set(false); } });
    this.api.examples().pipe(takeUntilDestroyed()).subscribe({ next: (examples) => this.examples.set(examples), error: (error: unknown) => this.fail(error) });
  }

  createQuote(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.busy()) { return; }
    this.busy.set(true);
    this.api.create(this.form.getRawValue()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (quote) => void this.router.navigate(['/quotes', quote.id]),
      error: (error: unknown) => this.fail(error),
    });
  }

  useExample(example: ExampleRequest): void {
    if (this.busy()) { return; }
    this.busy.set(true);
    this.api.create({ title: example.title, customerName: example.customerName, request: example.request }).pipe(
      switchMap((quote) => this.api.draft(quote.id, quote.revision)), takeUntilDestroyed(this.destroyRef),
    ).subscribe({ next: (quote) => void this.router.navigate(['/quotes', quote.id]), error: (error: unknown) => this.fail(error) });
  }

  private fail(error: unknown): void {
    this.busy.set(false);
    this.hasError.set(true);
    this.message.set(errorMessage(error));
  }
}


