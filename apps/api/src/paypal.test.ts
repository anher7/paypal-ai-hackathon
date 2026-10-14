import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPaypalProvider, type PaypalOrder } from './paypal.js';
import type { ApprovalSnapshot } from '@agree-first/shared';

const approved: ApprovalSnapshot = {
  revision: 2, title: 'A website', customerName: 'Mira Studio', request: 'A website',
  included: ['A website.'], excluded: [], needs: [], questions: [],
  priceCents: 45005, currency: 'EUR', approvedAt: new Date().toISOString(),
};
const order: PaypalOrder = {
  id: 'ORDER-TEST', status: 'COMPLETED', intent: 'CAPTURE',
  purchase_units: [{
    reference_id: 'quote-one', custom_id: 'quote-one:2',
    amount: { currency_code: 'EUR', value: '450.05' }, payee: { merchant_id: 'merchant-test' },
    payments: { captures: [{ id: 'CAPTURE-TEST', status: 'COMPLETED', final_capture: true,
      amount: { currency_code: 'EUR', value: '450.05' } }] },
  }],
};

afterEach(() => vi.unstubAllGlobals());

describe('PayPal sandbox transport', () => {
  it('uses sandbox only, server-approved cents, and the stable request ID', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'test-only-token', expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ ...order, status: 'CREATED' }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createPaypalProvider({ PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret' });
    await provider.createOrder('quote-one', approved, 'stable-request-id');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    const [url, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders');
    expect((options.headers as Record<string, string>)['PayPal-Request-Id']).toBe('stable-request-id');
    const payload = JSON.parse(options.body as string);
    expect(payload.purchase_units[0].amount).toEqual({ currency_code: 'EUR', value: '450.05' });
    expect(payload.payment_source.paypal.experience_context).toEqual({
      user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING',
    });
    expect(payload.purchase_units[0].shipping).toBeUndefined();
  });
  it('reads full order details after a sparse successful capture response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: 'test-only-token', expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ id: 'ORDER-TEST', status: 'COMPLETED' }))
      .mockResolvedValueOnce(Response.json(order));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createPaypalProvider({ PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret' });
    expect(await provider.captureOrder('ORDER-TEST', 'capture-request-id')).toEqual(order);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-TEST/capture');
    expect(fetchMock.mock.calls[2][0]).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-TEST');
    expect((fetchMock.mock.calls[2][1] as RequestInit).method).toBe('GET');
  });
  it('hides provider details in setup and timeout errors', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('private-provider-debug-id', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createPaypalProvider({ PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret' });
    await expect(provider.getOrder('ORDER-TEST')).rejects.toMatchObject({ code: 'PAYPAL_SETUP_ERROR', message: 'PayPal could not verify the sandbox setup.' });
    fetchMock.mockRejectedValueOnce(new Error('private-network-details'));
    await expect(provider.getOrder('ORDER-TEST')).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
  });
});
