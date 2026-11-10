import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AppConfig, calculateWorkEstimateTotals, CustomerLink, parseEuroPrice, priceToInput, Quote, QuoteUpdate, ScopeQuestion, WorkEstimate } from '@agree-first/shared';
import { Observable, of, switchMap } from 'rxjs';
import { errorMessage, QuoteApi } from './quote-api';
import { EstimateComparisonComponent } from './estimate-comparison.component';
import { MessageComponent, MoneyPipe, SectionTitleComponent, StatusComponent } from './ui';

export interface RequestSegment { text: string; questionId: string | null; }

export function highlightRequest(request: string, questions: ScopeQuestion[]): RequestSegment[] {
  const matches = questions.map((question) => ({ question, start: request.toLowerCase().indexOf(question.sourcePhrase.toLowerCase()) }))
    .filter(({ question, start }) => start >= 0 && question.sourcePhrase.length > 0).sort((left, right) => left.start - right.start);
  const segments: RequestSegment[] = [];
  let cursor = 0;
  for (const { question, start } of matches) {
    if (start < cursor) { continue; }
    if (start > cursor) { segments.push({ text: request.slice(cursor, start), questionId: null }); }
    segments.push({ text: request.slice(start, start + question.sourcePhrase.length), questionId: question.id });
    cursor = start + question.sourcePhrase.length;
  }
  if (cursor < request.length) { segments.push({ text: request.slice(cursor), questionId: null }); }
  return segments;
}

@Component({
  selector: 'app-editor',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, StatusComponent, SectionTitleComponent, MessageComponent, MoneyPipe, EstimateComparisonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page editor-page"><a routerLink="/" class="back-link">← Your work</a>
      <div class="page-intro compact"><p class="eyebrow">Quote details</p><h1>Review the scope</h1><p class="intro-copy">Check what’s included, resolve the questions and set your price.</p></div>
      @if (message()) {<app-message [text]="message()" [error]="hasError()" />}
      @if (quote(); as current) {
        <div class="quote-context"><app-status [status]="current.status" /><span>Revision {{ current.revision }}</span><span>{{ draftLabel() }}</span></div>
        @if (current.status === 'paid') {<div class="paper"><h2>This quote is paid.</h2><p>The agreed work and price are now read-only.</p><a mat-flat-button [routerLink]="['/review', current.id]">View receipt →</a></div>}
        @else {
          <form [formGroup]="form" (ngSubmit)="saveQuote()">
            <fieldset [disabled]="busy()" class="editor-fieldset">
              <div class="editor-grid">
                <aside class="request-column">
                  <section class="request-note"><span class="eyebrow">Customer request</span><p class="request-quote">@for (segment of requestSegments(); track $index) {@if (segment.questionId) {<a [href]="'#question-' + segment.questionId" class="phrase-link" (click)="focusQuestion($event, segment.questionId)">{{ segment.text }}</a>} @else {<span>{{ segment.text }}</span>}}</p><p class="small-text">Highlighted words link to a question below.</p></section>
                  <div class="request-fields"><mat-form-field appearance="outline"><mat-label>Work title</mat-label><input matInput formControlName="title" maxlength="160"></mat-form-field><mat-form-field appearance="outline"><mat-label>Customer name</mat-label><input matInput formControlName="customerName" maxlength="160"></mat-form-field><mat-form-field appearance="outline"><mat-label>Customer request</mat-label><textarea matInput formControlName="request" rows="5" maxlength="10000"></textarea></mat-form-field></div>
                  <button mat-stroked-button type="button" (click)="draftQuote()" [disabled]="busy() || form.invalid">{{ config()?.aiMode === 'live' && config()?.aiConfigured ? 'Generate AI draft' : 'Try example drafting' }}</button><p class="small-text">{{ config()?.aiMode === 'live' && config()?.aiConfigured ? 'AI suggests a scope and follow-up questions. Check them before approving.' : 'Live AI needs setup. Predefined examples are available, and any request can be written by hand.' }}</p>
                </aside>
                <div class="scope-column paper">
                  <section class="scope-section"><app-section-title number="01" title="You’ll get" hint="One clear deliverable per line." /><mat-form-field appearance="outline"><mat-label>Included work</mat-label><textarea matInput formControlName="included" rows="5" placeholder="Five website pages"></textarea></mat-form-field></section>
                  <section class="scope-section"><app-section-title number="02" title="Not included" hint="List work that would need a separate quote." /><mat-form-field appearance="outline"><mat-label>Excluded work</mat-label><textarea matInput formControlName="excluded" rows="3" placeholder="Ongoing content updates"></textarea></mat-form-field></section>
                  <section class="scope-section"><app-section-title number="03" title="We need from you" hint="What must the customer provide?" /><mat-form-field appearance="outline"><mat-label>Customer inputs</mat-label><textarea matInput formControlName="needs" rows="3" placeholder="Final text and images"></textarea></mat-form-field></section>
                  <section class="scope-section questions-section"><app-section-title number="04" title="Questions to resolve" hint="Answer each question or write an assumption everyone can see." />
                    <div formArrayName="questions">@for (question of form.controls.questions.controls; track question; let index = $index) {
                      <article class="question-card" [formGroupName]="index" [id]="'question-' + question.controls.id.value" tabindex="-1">
                        <div class="question-top"><span class="question-index">QUESTION {{ index + 1 }}</span><button mat-button type="button" (click)="removeQuestion(index)" [attr.aria-label]="'Remove question ' + (index + 1)">Remove</button></div>
                        <mat-form-field appearance="outline"><mat-label>Words in the request</mat-label><input matInput formControlName="sourcePhrase" maxlength="200"></mat-form-field>
                        <mat-form-field appearance="outline"><mat-label>Question</mat-label><textarea matInput formControlName="prompt" rows="2" maxlength="500"></textarea></mat-form-field>
                        <label class="select-label" [for]="'resolution-' + index">How is it settled?</label><select [id]="'resolution-' + index" formControlName="resolution"><option value="unanswered">Still a question</option><option value="answer">We have an answer</option><option value="assumption">Make an assumption</option></select>
                        <mat-form-field appearance="outline"><mat-label>{{ question.controls.resolution.value === 'assumption' ? 'Assumption shown to the customer' : 'Answer or proposed assumption' }}</mat-label><textarea matInput formControlName="response" rows="2" maxlength="1000" placeholder="Write exactly what you are agreeing to"></textarea></mat-form-field>
                      </article>
                    }</div>
                    @if (form.controls.questions.length === 0) {<p class="small-text">No open questions added. Read the request once more before approving.</p>}
                    <button mat-stroked-button type="button" (click)="addQuestion()" [disabled]="form.controls.questions.length >= 30">+ Add a question</button>
                  </section>
                  <section class="scope-section price-section"><app-section-title number="05" title="Set your price" hint="Review suggestions, then choose one final total in EUR." /><mat-form-field appearance="outline" class="price-field"><mat-label>Hourly rate in EUR</mat-label><span matTextPrefix>€&nbsp;</span><input matInput formControlName="hourlyRate" inputmode="decimal" placeholder="Your rate" maxlength="20"><mat-hint>Optional. Used only for suggested price ranges.</mat-hint>@if (form.controls.hourlyRate.invalid) {<mat-error>Enter a positive rate, such as 50.00.</mat-error>}</mat-form-field><div class="estimate-start"><button mat-stroked-button type="button" (click)="estimateWork()" [disabled]="busy() || form.invalid || !form.controls.included.value.trim()">Estimate work</button><p class="small-text">Compare the same work with and without an AI agent. Saves your edits first.</p></div>@if (displayEstimate(); as estimate) {<app-estimate-comparison [estimate]="estimate" [stale]="estimateIsStale()" [hasRate]="parsedHourlyRate() !== null" [canUse]="canUseSuggestion()" (usePrice)="useSuggestedPrice($event)" />}<mat-form-field appearance="outline" class="price-field"><mat-label>Total price in EUR</mat-label><span matTextPrefix>€&nbsp;</span><input matInput formControlName="price" inputmode="decimal" placeholder="450.00" maxlength="20"><mat-hint>Use a dot for cents, for example 450.50.</mat-hint></mat-form-field><p class="approval-hint">{{ approvalHint() }}</p></section>
                </div>
              </div>
              <div class="approval-bar"><div><span class="eyebrow">AGREED TOTAL</span><strong>{{ parsedPrice() | money }}</strong><span class="small-text">{{ form.dirty ? 'Unsaved changes' : 'Changes saved' }}</span></div><div class="approval-actions"><button mat-stroked-button type="submit" [disabled]="busy() || form.invalid">Save quote</button><button mat-flat-button type="button" (click)="approveQuote()" [disabled]="busy() || !canApprove()">{{ busy() ? 'One moment…' : 'Approve scope & price →' }}</button>@if (current.approved && !form.dirty) {<a mat-button [routerLink]="['/review', current.id]">Customer view ↗</a>}</div></div>
            </fieldset>
          </form>
        }
        @if (config()?.customerSharing && current.approved && current.approved.revision === current.revision) {
          <section class="paper customer-sharing" aria-labelledby="customer-sharing-title">
            <h2 id="customer-sharing-title">Send the agreement to your customer</h2>
            <p>They can open it on their own device, review the approved work and price, and pay through PayPal.</p>
            @if (form.dirty) {<p class="small-text">Save your changes and approve the new revision before sharing it. A saved change closes the previous link.</p>}
            @else {
              <p class="small-text">Keep this link private. Anyone with it can view this agreement and its receipt. It expires after 7 days. Creating another link closes the previous one.</p>
              <div class="share-actions"><button mat-flat-button type="button" (click)="generateCustomerLink()" [disabled]="busy() || shareBusy()">{{ shareBusy() ? 'One moment…' : customerLinkUrl() ? 'Create replacement link' : 'Create customer link' }}</button><button mat-stroked-button type="button" (click)="revokeCustomerLink()" [disabled]="busy() || shareBusy()">Close customer link</button></div>
              @if (customerLinkUrl(); as url) {
                <label class="share-link-label" for="customer-link">Private customer link</label><div class="share-link-row"><input id="customer-link" type="text" [value]="url" readonly (focus)="selectCustomerLink($event)"><button mat-stroked-button type="button" (click)="copyCustomerLink()">Copy link</button></div><p class="small-text">{{ shareExpiryLabel() }}</p>
              }
            }
            @if (shareMessage()) {<app-message [text]="shareMessage()" [error]="shareError()" />}
          </section>
        }
      } @else if (!hasError()) {<p role="status">Opening your quote…</p>}
    </div>
  `,
})
export class EditorComponent {
  private readonly api = inject(QuoteApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly formBuilder = inject(FormBuilder);
  readonly quote = signal<Quote | null>(null);
  readonly config = signal<AppConfig | null>(null);
  readonly busy = signal(false);
  readonly message = signal('');
  readonly hasError = signal(false);
  readonly shareBusy = signal(false);
  readonly shareMessage = signal('');
  readonly shareError = signal(false);
  readonly customerLink = signal<CustomerLink | null>(null);
  private readonly formChange = signal(0);
  readonly form = this.formBuilder.nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(160)]], customerName: ['', [Validators.required, Validators.maxLength(160)]],
    request: ['', [Validators.required, Validators.maxLength(10000)]], included: [''], excluded: [''], needs: [''], price: [''],
    hourlyRate: ['', (control: { value: string }) => control.value.trim() === '' || parseEuroPrice(control.value) !== null ? null : { price: true }],
    questions: this.formBuilder.array<ReturnType<EditorComponent['questionForm']>>([]),
  });

  constructor() {
    this.api.config().pipe(takeUntilDestroyed()).subscribe({ next: (config) => this.config.set(config), error: () => this.config.set(null) });
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.formChange.update((value) => value + 1));
    this.route.paramMap.pipe(switchMap((params) => this.api.get(params.get('id') ?? '')), takeUntilDestroyed()).subscribe({ next: (quote) => this.acceptQuote(quote), error: (error: unknown) => this.fail(error) });
  }

  customerLinkUrl(): string | null {
    this.formChange();
    const link = this.customerLink();
    const quote = this.quote();
    return link && quote && !this.form.dirty && quote.approved?.revision === quote.revision && link.revision === quote.revision
      ? `${window.location.origin}/customer#${link.token}` : null;
  }
  shareExpiryLabel(): string {
    const expiresAt = this.customerLink()?.expiresAt;
    return expiresAt ? `Expires ${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(expiresAt))}.` : '';
  }
  selectCustomerLink(event: FocusEvent): void { (event.target as HTMLInputElement).select(); }
  async copyCustomerLink(): Promise<void> {
    const url = this.customerLinkUrl();
    if (!url) { return; }
    try {
      await navigator.clipboard.writeText(url);
      this.shareMessage.set('Customer link copied. Send it privately to your customer.'); this.shareError.set(false);
    } catch {
      this.shareMessage.set('Select the link above and copy it to send to your customer.'); this.shareError.set(false);
    }
  }
  generateCustomerLink(): void { this.changeCustomerLink('create'); }
  revokeCustomerLink(): void { this.changeCustomerLink('revoke'); }
  private changeCustomerLink(action: 'create' | 'revoke'): void {
    const quote = this.quote();
    if (!this.config()?.customerSharing || !quote?.approved || quote.approved.revision !== quote.revision || this.form.dirty || this.busy() || this.shareBusy()) { return; }
    this.shareBusy.set(true); this.shareMessage.set(''); this.shareError.set(false); this.customerLink.set(null);
    const request: Observable<CustomerLink | { revoked: true }> = action === 'create' ? this.api.share(quote.id, quote.revision) : this.api.revokeShare(quote.id, quote.revision);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.shareBusy.set(false);
        if (action === 'create' && 'token' in result && this.quote()?.revision === quote.revision) {
          this.customerLink.set(result);
          this.shareMessage.set('Customer link ready. Copy it and send it privately.');
        } else {
          this.customerLink.set(null); this.shareMessage.set('Customer link closed. Anyone with the old link can no longer open this agreement.');
        }
      },
      error: (error: unknown) => { this.shareBusy.set(false); this.shareError.set(true); this.shareMessage.set(errorMessage(error)); },
    });
  }

  private questionForm(question: ScopeQuestion) {
    return this.formBuilder.nonNullable.group({ id: [question.id], sourcePhrase: [question.sourcePhrase, [Validators.required, Validators.maxLength(200)]], prompt: [question.prompt, [Validators.required, Validators.maxLength(500)]], resolution: [question.resolution], response: [question.response, Validators.maxLength(1000)] });
  }

  focusQuestion(event: MouseEvent, questionId: string): void {
    event.preventDefault();
    const question = document.getElementById('question-' + questionId);
    question?.focus({ preventScroll: true });
    question?.scrollIntoView({ behavior: 'auto', block: 'center' });
  }

  addQuestion(): void {
    this.form.controls.questions.push(this.questionForm({ id: crypto.randomUUID(), sourcePhrase: '', prompt: '', resolution: 'unanswered', response: '' }));
    this.form.markAsDirty();
  }
  removeQuestion(index: number): void { this.form.controls.questions.removeAt(index); this.form.markAsDirty(); }
  requestSegments(): RequestSegment[] { this.formChange(); return highlightRequest(this.form.controls.request.value, this.form.controls.questions.getRawValue()); }
  parsedPrice(): number | null { this.formChange(); return parseEuroPrice(this.form.controls.price.value); }
  canApprove(): boolean {
    this.formChange();
    return this.form.valid && this.lines(this.form.controls.included.value).length > 0 && this.parsedPrice() !== null && this.form.controls.questions.getRawValue().every((question) => question.resolution !== 'unanswered' && question.response.trim().length > 0);
  }
  approvalHint(): string {
    this.formChange();
    const openQuestions = this.form.controls.questions.getRawValue().filter((question) => question.resolution === 'unanswered' || !question.response.trim()).length;
    if (openQuestions > 0) { return `Settle ${openQuestions} ${openQuestions === 1 ? 'question' : 'questions'} before approval.`; }
    if (!this.lines(this.form.controls.included.value).length) { return 'Add the work you will deliver before approval.'; }
    if (this.parsedPrice() === null) { return 'Enter a positive price before approval.'; }
    return 'Ready for your approval. The customer will see this scope and this exact price.';
  }

  draftLabel(): string {
    const source = this.quote()?.draftSource;
    if (source === 'ai') { return 'AI draft · review every word'; }
    if (source === 'example') { return 'Example draft · review every word'; }
    return this.config()?.aiMode === 'live' && this.config()?.aiConfigured ? 'Written by you · AI drafting available' : 'Written by you · live AI not connected';
  }
  parsedHourlyRate(): number | null { this.formChange(); return parseEuroPrice(this.form.controls.hourlyRate.value); }
  displayEstimate(): WorkEstimate | null {
    this.formChange();
    const estimate = this.quote()?.workEstimate;
    return estimate ? { ...estimate, totals: calculateWorkEstimateTotals(estimate.tasks, this.parsedHourlyRate()) } : null;
  }
  estimateIsStale(): boolean {
    this.formChange();
    const quote = this.quote();
    if (!quote?.workEstimate) { return false; }
    const values = this.form.getRawValue();
    const editedScope = { request: values.request.trim(), included: this.lines(values.included), excluded: this.lines(values.excluded), needs: this.lines(values.needs), questions: values.questions };
    const savedScope = { request: quote.request, included: quote.included, excluded: quote.excluded, needs: quote.needs, questions: quote.questions };
    return quote.workEstimate.stale || JSON.stringify(editedScope) !== JSON.stringify(savedScope);
  }
  canUseSuggestion(): boolean {
    this.formChange();
    return !this.busy() && this.form.valid && this.quote()?.status !== 'paid' && !this.estimateIsStale() && this.parsedHourlyRate() !== null && this.parsedHourlyRate() === this.quote()?.hourlyRateCents;
  }
  useSuggestedPrice(cents: number): void {
    if (!this.canUseSuggestion() || !Number.isSafeInteger(cents) || cents <= 0 || cents > 999999999) { return; }
    const estimate = this.displayEstimate();
    const suggestions = estimate ? Object.values(estimate.totals).flatMap((total) => [total.minPriceCents, total.maxPriceCents]) : [];
    if (!suggestions.includes(cents)) { return; }
    this.form.controls.price.setValue(priceToInput(cents));
    this.form.controls.price.markAsDirty();
    this.message.set('Suggested price copied. Review the final amount before approval.');
    this.hasError.set(false);
  }
  estimateWork(): void { if (this.lines(this.form.controls.included.value).length) { this.perform('estimate'); } }
  saveQuote(): void { this.perform('save'); }
  draftQuote(): void { this.perform('draft'); }
  approveQuote(): void { if (this.canApprove()) { this.perform('approve'); } }

  private perform(action: 'save' | 'draft' | 'approve' | 'estimate'): void {
    const quote = this.quote();
    this.form.markAllAsTouched();
    if (!quote || this.busy() || this.form.invalid) { return; }
    this.busy.set(true); this.message.set(''); this.hasError.set(false);
    this.savedQuote(quote, action === 'save').pipe(switchMap((saved) => {
      this.acceptQuote(saved);
      if (action === 'draft') { return this.api.draft(saved.id, saved.revision); }
      if (action === 'approve') { return this.api.approve(saved.id, saved.revision); }
      if (action === 'estimate') { return this.api.estimate(saved.id, saved.revision); }
      return of(saved);
    }), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => { this.acceptQuote(saved); this.busy.set(false); this.message.set(action === 'approve' ? 'Scope and price approved. Open Customer view to review the agreement.' : action === 'estimate' ? 'Work estimated. Review both options and their assumptions.' : action === 'draft' ? (saved.draftSource === 'ai' ? 'AI draft added. Review every line and settle the questions.' : 'Example draft added. Review every line and settle the questions.') : 'Quote saved.'); },
      error: (error: unknown) => this.fail(error),
    });
  }
  private savedQuote(quote: Quote, forceSave = false): Observable<Quote> {
    if (!this.form.dirty && !forceSave) { return of(quote); }
    const values = this.form.getRawValue();
    const update: QuoteUpdate = { ...values, expectedRevision: quote.revision, included: this.lines(values.included), excluded: this.lines(values.excluded), needs: this.lines(values.needs) };
    return this.api.update(quote.id, update);
  }
  private acceptQuote(quote: Quote): void {
    if (this.customerLink()?.revision !== quote.revision) { this.customerLink.set(null); this.shareMessage.set(''); }
    this.quote.set(quote);
    this.form.controls.questions.clear();
    for (const question of quote.questions) { this.form.controls.questions.push(this.questionForm(question)); }
    this.form.reset({ title: quote.title, customerName: quote.customerName, request: quote.request, included: quote.included.join('\n'), excluded: quote.excluded.join('\n'), needs: quote.needs.join('\n'), price: priceToInput(quote.priceCents), hourlyRate: priceToInput(quote.hourlyRateCents ?? null), questions: quote.questions });
  }
  private lines(value: string): string[] { return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
  private fail(error: unknown): void { this.busy.set(false); this.hasError.set(true); this.message.set(errorMessage(error)); }
}







