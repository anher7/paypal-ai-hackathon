import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AppConfig, CheckoutRecovery, Quote } from '@agree-first/shared';
import { of, Subject, throwError } from 'rxjs';
import { QuoteApi } from './quote-api';
import { ReviewComponent } from './review.component';
import { exampleQuote } from './test-fixtures';
import { PAYPAL_SDK_LOADER, PayPalSdk } from './paypal-sdk';


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



describe('Private customer link review', () => {
  const token = 'a'.repeat(64);
  const api = { get: vi.fn(), config: vi.fn(), capture: vi.fn(), order: vi.fn(), recovery: vi.fn(), customer: vi.fn(), customerRecovery: vi.fn(), customerOrder: vi.fn(), customerCapture: vi.fn() };
  const loadSdk = vi.fn();
  let fragment: Subject<string | null>;
  let agreement: import('@agree-first/shared').AgreementView;
  beforeEach(async () => {
    vi.clearAllMocks();
    const quote = exampleQuote();
    agreement = { id: quote.id, status: 'ready', payment: null, approved: { revision: 2, title: quote.title, customerName: quote.customerName, included: quote.included, excluded: quote.excluded, needs: quote.needs, questions: [], priceCents: 45000, currency: 'EUR', approvedAt: quote.updatedAt } };
    fragment = new Subject();
    api.customer.mockReturnValue(of(agreement)); api.customerRecovery.mockReturnValue(of(null));
    api.config.mockReturnValue(of({ currency: 'EUR', paypalConfigured: false, paypalClientId: null, aiMode: 'examples', localOnly: false, customerSharing: true }));
    await TestBed.configureTestingModule({ imports: [ReviewComponent], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { data: { customer: true } }, fragment } }, { provide: PAYPAL_SDK_LOADER, useValue: loadSdk }, { provide: QuoteApi, useValue: api }] }).compileComponents();
  });

  it('loads the fragment capability through the customer API with no owner navigation or private input', async () => {
    const fixture = TestBed.createComponent(ReviewComponent);
    fragment.next(token);
    fixture.detectChanges(); await fixture.whenStable();
    expect(api.customer).toHaveBeenCalledWith(token);
    expect(api.customerRecovery).toHaveBeenCalledWith(token);
    expect(api.get).not.toHaveBeenCalled(); expect(api.recovery).not.toHaveBeenCalled();
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('a[href="/"]')).toBeNull();
    expect(page.querySelector('a[href^="/quotes/"]')).toBeNull();
    expect(page.textContent).toContain('You cannot change the work or price here.');
    expect(page.textContent).not.toContain(exampleQuote().request);
    expect(fixture.componentInstance.accepted()).toBe(false);
  });

  it('uses customer capture recovery and requires fresh consent', async () => {
    api.customerRecovery.mockReturnValue(of({ orderId: 'ORDER-CUSTOMER', approvedRevision: 2 }));
    api.customerCapture.mockReturnValue(of({ ...agreement, status: 'paid', payment: { orderId: 'ORDER-CUSTOMER', captureId: 'CAPTURE-CUSTOMER', priceCents: 45000, currency: 'EUR', paidAt: '2026-11-10T16:00:00Z' } }));
    const component = TestBed.createComponent(ReviewComponent).componentInstance;
    fragment.next(token);
    component.retryCapture();
    expect(api.customerCapture).not.toHaveBeenCalled();
    component.accepted.set(true); component.retryCapture(); await Promise.resolve();
    expect(api.customerCapture).toHaveBeenCalledWith(token, 'ORDER-CUSTOMER', 2);
    expect(api.capture).not.toHaveBeenCalled(); expect(api.order).not.toHaveBeenCalled();
    expect(component.quote()?.status).toBe('paid');
  });

  it('ignores old PayPal callbacks immediately after the customer fragment changes', async () => {
    api.config.mockReturnValue(of({ currency: 'EUR', paypalConfigured: true, paypalClientId: 'sandbox-client', aiMode: 'examples', localOnly: false, customerSharing: true }));
    let callbacks: Parameters<PayPalSdk['Buttons']>[0] | undefined;
    loadSdk.mockResolvedValue({ Buttons: (options: Parameters<PayPalSdk['Buttons']>[0]) => { callbacks = options; return { render: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) }; } });
    const fixture = TestBed.createComponent(ReviewComponent);
    fragment.next(token); fixture.componentInstance.accepted.set(true);
    fixture.detectChanges(); await fixture.whenStable();
    expect(callbacks).toBeDefined();
    const previousCallbacks = callbacks!;
    fragment.next('b'.repeat(64));
    fixture.componentInstance.accepted.set(true);
    await expect(previousCallbacks.createOrder()).rejects.toThrow('Confirm the agreement');
    await previousCallbacks.onApprove({ orderID: 'ORDER-OLD' });
    expect(api.customerOrder).not.toHaveBeenCalled();
    expect(api.customerCapture).not.toHaveBeenCalled();
    expect(fixture.componentInstance.pendingCapture()).toBeNull();
  });

  it('binds an in-flight PayPal order to the original fragment and rejects a late result', async () => {
    api.config.mockReturnValue(of({ currency: 'EUR', paypalConfigured: true, paypalClientId: 'sandbox-client', aiMode: 'examples', localOnly: false, customerSharing: true }));
    let callbacks: Parameters<PayPalSdk['Buttons']>[0] | undefined;
    loadSdk.mockResolvedValue({ Buttons: (options: Parameters<PayPalSdk['Buttons']>[0]) => { callbacks = options; return { render: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) }; } });
    const order = new Subject<import('@agree-first/shared').OrderResult>();
    api.customerOrder.mockReturnValue(order);
    const fixture = TestBed.createComponent(ReviewComponent);
    fragment.next(token); fixture.componentInstance.accepted.set(true);
    fixture.detectChanges(); await fixture.whenStable();
    const pending = callbacks!.createOrder();
    expect(api.customerOrder).toHaveBeenCalledWith(token, 2);
    fragment.next('b'.repeat(64)); fixture.componentInstance.accepted.set(true);
    const rejected = expect(pending).rejects.toThrow('agreement changed');
    order.next({ orderId: 'ORDER-ORIGINAL', revision: 2 }); order.complete();
    await rejected;
    expect(api.customerOrder).toHaveBeenCalledTimes(1);
  });

  it('rejects missing or malformed fragments without falling back to an owner quote', () => {
    const component = TestBed.createComponent(ReviewComponent).componentInstance;
    fragment.next(null); fragment.next('quote-example');
    expect(api.customer).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled();
    expect(component.quote()).toBeNull(); expect(component.message()).toContain('full link');
  });

  it('clears the old agreement when a link is closed and can recover after a new fragment arrives', () => {
    const component = TestBed.createComponent(ReviewComponent).componentInstance;
    fragment.next(token); component.accepted.set(true);
    api.customer.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    fragment.next('b'.repeat(64));
    expect(component.quote()).toBeNull(); expect(component.accepted()).toBe(false);
    expect(component.message()).toContain('Ask the freelancer for a new link');
    fragment.next('c'.repeat(64));
    expect(component.quote()?.id).toBe(agreement.id); expect(component.hasError()).toBe(false);
    expect(api.get).not.toHaveBeenCalled();
  });
});
