import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AppConfig, CheckoutRecovery, Quote } from '@agree-first/shared';
import { of, Subject, throwError } from 'rxjs';
import { QuoteApi } from './quote-api';
import { ReviewComponent } from './review.component';
import { exampleQuote } from './test-fixtures';

describe('Customer review', () => {
  const api = { get: vi.fn(), config: vi.fn(), capture: vi.fn(), order: vi.fn(), recovery: vi.fn() };
  let component: ReviewComponent;
  let ready: Quote;
  beforeEach(async () => {
    vi.clearAllMocks();
    const quote = exampleQuote();
    ready = { ...quote, status: 'ready', priceCents: 45000, approved: { revision: 2, title: quote.title, customerName: quote.customerName, request: quote.request, included: quote.included, excluded: quote.excluded, needs: quote.needs, questions: [], priceCents: 45000, currency: 'EUR', approvedAt: quote.updatedAt } };
    const config: AppConfig = { currency: 'EUR', paypalConfigured: false, paypalClientId: null, aiMode: 'examples', localOnly: true };
    api.get.mockReturnValue(of(ready)); api.config.mockReturnValue(of(config)); api.recovery.mockReturnValue(of(null));
    await TestBed.configureTestingModule({ imports: [ReviewComponent], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: quote.id })) } }, { provide: QuoteApi, useValue: api }] }).compileComponents();
    component = TestBed.createComponent(ReviewComponent).componentInstance;
  });

  it('retains a failed capture for another check without creating a new order', async () => {
    component.accepted.set(true);
    component.pendingCapture.set({ orderId: 'ORDER-1', revision: 2 });
    api.capture.mockReturnValue(throwError(() => new Error('Payment could not be confirmed yet.')));
    component.retryCapture();
    await Promise.resolve();
    expect(component.pendingCapture()).toEqual({ orderId: 'ORDER-1', revision: 2 });
    expect(component.quote()?.status).toBe('ready');
    expect(api.order).not.toHaveBeenCalled();
    const paid = { ...ready, status: 'paid', payment: { orderId: 'ORDER-1', captureId: 'CAPTURE-1', priceCents: 45000, currency: 'EUR', paidAt: ready.updatedAt } };
    api.capture.mockReturnValue(of(paid));
    component.retryCapture();
    await Promise.resolve();
    expect(api.capture).toHaveBeenLastCalledWith(ready.id, 'ORDER-1', 2);
    expect(component.quote()?.status).toBe('paid');
    expect(component.pendingCapture()).toBeNull();
  });

  it('does not retry capture without customer consent', () => {
    component.pendingCapture.set({ orderId: 'ORDER-1', revision: 2 });
    component.retryCapture();
    expect(api.capture).not.toHaveBeenCalled();
  });
  it('restores an uncertain capture from the server after reload and asks for consent again', async () => {
    api.recovery.mockReturnValue(of({ orderId: 'ORDER-PREVIOUS', approvedRevision: 2 }));
    const restored = TestBed.createComponent(ReviewComponent).componentInstance;
    expect(api.recovery).toHaveBeenCalledWith(ready.id);
    expect(restored.pendingCapture()).toEqual({ orderId: 'ORDER-PREVIOUS', revision: 2 });
    expect(restored.recoveryChecked()).toBe(true);
    expect(restored.accepted()).toBe(false);
    restored.retryCapture();
    expect(api.capture).not.toHaveBeenCalled();
    restored.accepted.set(true);
    api.capture.mockReturnValue(throwError(() => new Error('Still checking the same order.')));
    restored.retryCapture();
    await Promise.resolve();
    expect(api.capture).toHaveBeenCalledWith(ready.id, 'ORDER-PREVIOUS', 2);
    expect(api.order).not.toHaveBeenCalled();
  });

  it('waits for the recovery check before allowing a new checkout', () => {
    const recovery = new Subject<CheckoutRecovery | null>();
    api.recovery.mockReturnValue(recovery);
    const restored = TestBed.createComponent(ReviewComponent).componentInstance;
    restored.accepted.set(true);
    expect(restored.recoveryChecked()).toBe(false);
    expect(restored.quote()?.id).toBe(ready.id);
    recovery.next(null);
    recovery.complete();
    expect(restored.recoveryChecked()).toBe(true);
    expect(restored.pendingCapture()).toBeNull();
  });
});


