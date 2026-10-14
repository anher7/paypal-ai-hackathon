import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { errorCode, errorMessage, QuoteApi } from './quote-api';
import { exampleQuote } from './test-fixtures';

describe('QuoteApi', () => {
  let api: QuoteApi;
  let requests: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(QuoteApi);
    requests = TestBed.inject(HttpTestingController);
  });
  afterEach(() => requests.verify());

  it('sends the approved revision and scope consent without a client amount', async () => {
    const response = firstValueFrom(api.order('quote-example', 3));
    const request = requests.expectOne('/api/quotes/quote-example/orders');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ approvedRevision: 3, scopeAccepted: true });
    request.flush({ orderId: 'ORDER-1', revision: 3 });
    await expect(response).resolves.toEqual({ orderId: 'ORDER-1', revision: 3 });
  });

  it('requests work estimates for the saved revision without providing suggested or final amounts', async () => {
    const response = firstValueFrom(api.estimate('quote-example', 4));
    const request = requests.expectOne('/api/quotes/quote-example/estimate');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ expectedRevision: 4 });
    request.flush(exampleQuote());
    await expect(response).resolves.toHaveProperty('id', 'quote-example');
  });

  it('retries capture using the same order reference', async () => {
    const response = firstValueFrom(api.capture('quote-example', 'ORDER-1', 3));
    const request = requests.expectOne('/api/quotes/quote-example/orders/ORDER-1/capture');
    expect(request.request.body).toEqual({ approvedRevision: 3, scopeAccepted: true });
    request.flush(exampleQuote());
    await expect(response).resolves.toHaveProperty('id', 'quote-example');
  });

  it('keeps server guidance and conflict codes available to the interface', async () => {
    const response = firstValueFrom(api.get('quote-example')).catch((error: unknown) => error);
    requests.expectOne('/api/quotes/quote-example').flush({ error: { code: 'REVISION_CONFLICT', message: 'Reload the quote before saving.' } }, { status: 409, statusText: 'Conflict' });
    const error = await response;
    expect(errorMessage(error)).toBe('Reload the quote before saving.');
    expect(errorCode(error)).toBe('REVISION_CONFLICT');
  });
  it('reads persisted capture recovery without creating or capturing an order', async () => {
    const response = firstValueFrom(api.recovery('quote-example'));
    const request = requests.expectOne('/api/quotes/quote-example/checkout-recovery');
    expect(request.request.method).toBe('GET');
    request.flush({ orderId: 'ORDER-PREVIOUS', approvedRevision: 3 });
    await expect(response).resolves.toEqual({ orderId: 'ORDER-PREVIOUS', approvedRevision: 3 });
  });
});



