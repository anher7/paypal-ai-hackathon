import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Quote, WorkEstimate } from '@agree-first/shared';
import { of, Subject } from 'rxjs';
import { EditorComponent, highlightRequest } from './editor.component';
import { QuoteApi } from './quote-api';
import { exampleQuote } from './test-fixtures';

describe('Scope editor', () => {
  const api = { get: vi.fn(), update: vi.fn(), approve: vi.fn(), config: vi.fn(), draft: vi.fn(), estimate: vi.fn() };
  const workEstimate: WorkEstimate = { source: 'ai', model: 'dummy-model', generatedAt: '2026-10-14T10:00:00.000Z', stale: false, tasks: [{ name: 'Build and test a form', withoutAgent: { minMinutes: 180, maxMinutes: 300 }, withAgent: { minMinutes: 120, maxMinutes: 360 }, agentHelp: 'Draft form code.', humanWork: 'Review, correct and test the result.' }], assumptions: ['Customer provides form fields.'], totals: { withoutAgent: { minMinutes: 180, maxMinutes: 300, minPriceCents: 15000, maxPriceCents: 25000 }, withAgent: { minMinutes: 120, maxMinutes: 360, minPriceCents: 10000, maxPriceCents: 30000 } } };
  let component: EditorComponent;
  let fixture: ComponentFixture<EditorComponent>;
  beforeEach(async () => {
    vi.clearAllMocks();
    const quote = exampleQuote();
    api.get.mockReturnValue(of(quote));
    api.config.mockReturnValue(of({ aiMode: 'examples', currency: 'EUR', paypalConfigured: false, paypalClientId: null, localOnly: true }));
    await TestBed.configureTestingModule({
      imports: [EditorComponent], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: quote.id })) } }, { provide: QuoteApi, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(EditorComponent);
    component = fixture.componentInstance;
  });

  it('shows live drafting honestly and leaves the entered price unchanged', () => {
    component.config.set({ aiMode: 'live', aiConfigured: true, aiModel: 'dummy-model', currency: 'EUR', paypalConfigured: false, paypalClientId: null, localOnly: true });
    api.draft.mockReturnValue(of({ ...exampleQuote(), draftSource: 'ai', priceCents: 45000 }));
    component.draftQuote();
    expect(api.draft).toHaveBeenCalledWith('quote-example', 2);
    expect(component.draftLabel()).toBe('AI draft · review every word');
    expect(component.form.controls.price.value).toBe('450.00');
    expect(component.message()).toContain('AI draft added');
  });

  it('saves edited scope and rate before estimating without overwriting answers or price', () => {
    const edited: Quote = { ...exampleQuote(), revision: 3, priceCents: 45000, hourlyRateCents: 5000, questions: [{ ...exampleQuote().questions[0]!, resolution: 'answer', response: 'An inquiry form only.' }] };
    api.update.mockReturnValue(of(edited));
    api.estimate.mockReturnValue(of({ ...edited, revision: 4, workEstimate }));
    component.form.patchValue({ hourlyRate: '50.00', price: '450.00' });
    component.form.controls.questions.at(0).patchValue({ resolution: 'answer', response: 'An inquiry form only.' });
    component.form.markAsDirty();
    component.estimateWork();
    expect(api.update).toHaveBeenCalledWith('quote-example', expect.objectContaining({ hourlyRate: '50.00', price: '450.00' }));
    expect(api.estimate).toHaveBeenCalledWith('quote-example', 3);
    expect(component.form.controls.price.value).toBe('450.00');
    expect(component.form.controls.questions.at(0).controls.response.value).toBe('An inquiry form only.');
    expect(component.canUseSuggestion()).toBe(true);
  });

  it('adopts only an explicit current suggestion and never approves automatically', () => {
    component.quote.set({ ...exampleQuote(), hourlyRateCents: 5000, workEstimate });
    component.form.controls.hourlyRate.setValue('50.00');
    component.useSuggestedPrice(10000);
    expect(component.form.controls.price.value).toBe('100.00');
    expect(component.form.dirty).toBe(true);
    expect(api.approve).not.toHaveBeenCalled();
    component.useSuggestedPrice(999);
    expect(component.form.controls.price.value).toBe('100.00');
    component.form.controls.price.setValue('700.00');
    expect(component.estimateIsStale()).toBe(false);
    component.form.controls.questions.at(0).controls.response.setValue('New detail.');
    expect(component.estimateIsStale()).toBe(true);
    component.useSuggestedPrice(30000);
    expect(component.form.controls.price.value).toBe('700.00');
  });

  it('previews rate changes but requires a saved rate before adopting prices', () => {
    component.quote.set({ ...exampleQuote(), hourlyRateCents: 5000, workEstimate });
    component.form.controls.hourlyRate.setValue('60.00');
    expect(component.displayEstimate()?.totals.withoutAgent.minPriceCents).toBe(18000);
    expect(component.canUseSuggestion()).toBe(false);
    expect(component.estimateIsStale()).toBe(false);
    component.form.controls.hourlyRate.setValue('');
    expect(component.form.controls.hourlyRate.valid).toBe(true);
    expect(component.displayEstimate()?.totals.withAgent.minPriceCents).toBeNull();
    component.form.controls.hourlyRate.setValue('not money');
    expect(component.form.controls.hourlyRate.invalid).toBe(true);
  });

  it('does not claim live drafting is available when gateway setup is incomplete', () => {
    component.quote.set({ ...exampleQuote(), draftSource: 'manual' });
    component.config.set({ aiMode: 'live', aiConfigured: false, currency: 'EUR', paypalConfigured: false, paypalClientId: null, localOnly: true });
    expect(component.draftLabel()).toBe('Written by you · live AI not connected');
  });

  it('loads old quotes with a blank optional hourly rate', () => {
    expect(component.form.controls.hourlyRate.value).toBe('');
    expect(component.displayEstimate()).toBeNull();
    expect(component.form.valid).toBe(true);
  });
  it('links the exact request phrase to its question, preserving the remaining words', () => {
    const quote = exampleQuote();
    const segments = highlightRequest(quote.request, quote.questions);
    expect(segments.map((segment) => segment.text).join('')).toBe(quote.request);
    expect(segments.find((segment) => segment.questionId === 'booking')?.text).toBe('booking form');
  });

  it('requires a settled question, included work, and a human price', () => {
    expect(component.canApprove()).toBe(false);
    component.form.controls.price.setValue('450.50');
    expect(component.canApprove()).toBe(false);
    component.form.controls.questions.at(0).patchValue({ resolution: 'assumption', response: 'A simple inquiry form.' });
    expect(component.canApprove()).toBe(true);
    expect(component.parsedPrice()).toBe(45050);
    component.form.controls.included.setValue('');
    expect(component.canApprove()).toBe(false);
  });

  it('saves dirty scope before approving the returned revision', () => {
    const changed: Quote = { ...exampleQuote(), revision: 3, priceCents: 45050, questions: [{ ...exampleQuote().questions[0]!, resolution: 'answer', response: 'An inquiry form.' }] };
    api.update.mockReturnValue(of(changed));
    api.approve.mockReturnValue(of({ ...changed, status: 'ready' }));
    component.form.controls.price.setValue('450.50');
    component.form.controls.questions.at(0).patchValue({ resolution: 'answer', response: 'An inquiry form.' });
    component.form.markAsDirty();
    component.approveQuote();
    expect(api.update).toHaveBeenCalledWith('quote-example', expect.objectContaining({ expectedRevision: 2, price: '450.50' }));
    expect(api.approve).toHaveBeenCalledWith('quote-example', 3);
    expect(component.form.dirty).toBe(false);
    expect(component.message()).toContain('approved');
  });
  it('explicitly saves an unchanged quote so expired checkout can receive a new revision', () => {
    api.update.mockReturnValue(of({ ...exampleQuote(), revision: 3 }));
    expect(component.form.dirty).toBe(false);
    component.saveQuote();
    expect(api.update).toHaveBeenCalledWith('quote-example', expect.objectContaining({ expectedRevision: 2 }));
    expect(component.quote()?.revision).toBe(3);
  });
  it('focuses a linked question without navigating away from the editor route', () => {
    const target = document.createElement('article');
    target.id = 'question-booking';
    target.tabIndex = -1;
    target.scrollIntoView = vi.fn();
    document.body.append(target);
    const click = new MouseEvent('click', { cancelable: true });
    component.focusQuestion(click, 'booking');
    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(target);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    target.remove();
  });

  it('keeps rendered question edits bound to current controls after saving', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const savedResponse = new Subject<Quote>();
    api.update.mockReturnValue(savedResponse);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    savedResponse.next({ ...exampleQuote(), revision: 3, priceCents: 45000 });
    savedResponse.complete();
    fixture.detectChanges();
    await fixture.whenStable();

    const resolution = fixture.nativeElement.querySelector('select[formcontrolname="resolution"]') as HTMLSelectElement;
    resolution.value = 'answer';
    resolution.dispatchEvent(new Event('change', { bubbles: true }));
    const response = fixture.nativeElement.querySelector('textarea[formcontrolname="response"]') as HTMLTextAreaElement;
    response.value = 'An inquiry form only; no live calendar.';
    response.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.form.controls.questions.getRawValue()[0]).toEqual(expect.objectContaining({
      resolution: 'answer', response: 'An inquiry form only; no live calendar.',
    }));
    expect(component.canApprove()).toBe(true);
    expect(component.approvalHint()).toContain('Ready for your approval');
    const approveButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.includes('Approve scope & price'));
    expect(approveButton?.disabled).toBe(false);

    const resolved: Quote = { ...exampleQuote(), revision: 4, priceCents: 45000,
      questions: [{ ...exampleQuote().questions[0]!, resolution: 'answer', response: response.value }] };
    api.update.mockReturnValue(of(resolved));
    api.approve.mockReturnValue(of({ ...resolved, status: 'ready' }));
    component.approveQuote();
    expect(api.update).toHaveBeenLastCalledWith('quote-example', expect.objectContaining({
      questions: [expect.objectContaining({ resolution: 'answer', response: 'An inquiry form only; no live calendar.' })],
    }));
    expect(api.approve).toHaveBeenCalledWith('quote-example', 4);
  });

});








