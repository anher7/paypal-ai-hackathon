import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import type { AgreementView, CustomerLink, Quote } from '@agree-first/shared';
import type { PaypalOrder } from '../../api/src/paypal.js';
import worker, { type HostedEnvironment } from './index.js';
import { openHostedStore, type HostedDatabase } from './store.js';
import { database } from './test-database.js';

const origin = 'https://agree-first.example';
const hash = async (value: string) => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
async function setup() {
  const { db, connection } = database();
  const env: HostedEnvironment = { DB: db, PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret', PAYPAL_MERCHANT_ID: 'merchant-one' };
  const page = await worker.fetch(new Request(origin), env);
  const cookie = page.headers.get('set-cookie')!.split(';')[0];
  const workspace = await hash(cookie.slice(cookie.indexOf('=') + 1));
  const id = crypto.randomUUID();
  const quote: Quote = {
    id, title: 'One booking form', customerName: 'Customer', request: 'Build a booking form. Private customer notes: confidential@example.test',
    included: ['One inquiry form'], excluded: ['Live calendar'], needs: ['Customer supplies content'],
    questions: [{ id: 'question-1', sourcePhrase: 'booking form', prompt: 'What should the form do?', resolution: 'answer', response: 'Inquiry only' }],
    draftSource: 'ai', hourlyRateCents: 12345, workEstimate: null, priceCents: 123, currency: 'EUR', revision: 3,
    status: 'ready', payment: null, createdAt: '2026-11-10T12:00:00.000Z', updatedAt: '2026-11-10T12:00:00.000Z',
    approved: { revision: 3, title: 'One booking form', customerName: 'Customer', request: 'Build a booking form. Private customer notes: confidential@example.test',
      included: ['One inquiry form'], excluded: ['Live calendar'], needs: ['Customer supplies content'],
      questions: [{ id: 'question-1', sourcePhrase: 'booking form', prompt: 'What should the form do?', resolution: 'answer', response: 'Inquiry only' }],
      priceCents: 123, currency: 'EUR', approvedAt: '2026-11-10T12:00:00.000Z' },
  };
  const session = await openHostedStore(db, workspace, undefined, true);
  session.store.saveQuote(quote);
  await session.close();
  const owner = (path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) => worker.fetch(new Request(`${origin}${path}`, {
    method, headers: { cookie, 'cf-connecting-ip': '203.0.113.1', ...(body ? { 'content-type': 'application/json' } : {}), ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
  const customer = (token: string | undefined, path = '/api/customer', method = 'GET', body?: unknown, extra: Record<string, string> = {}) => worker.fetch(new Request(`${origin}${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'cf-connecting-ip': '203.0.113.2',
      ...(body ? { 'content-type': 'application/json' } : {}), ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
  const share = async (revision = 3) => {
    const response = await owner(`/api/quotes/${id}/share`, 'POST', { expectedRevision: revision });
    expect(response.status).toBe(200);
    return response.json() as Promise<CustomerLink>;
  };
  return { env, db, connection, id, workspace, quote, owner, customer, share };
}
function edit(quote: Quote, price = '2.00') {
  return { title: quote.title, customerName: quote.customerName, request: quote.request,
    included: quote.included, excluded: quote.excluded, needs: quote.needs, questions: quote.questions,
    hourlyRate: '123.45', price, expectedRevision: quote.revision };
}
function sandbox(id: string) {
  let order: PaypalOrder = {
    id: 'ORDER-ONE', status: 'CREATED', intent: 'CAPTURE', purchase_units: [{ reference_id: id, custom_id: `${id}:3`,
      amount: { currency_code: 'EUR', value: '1.23' }, payee: { merchant_id: 'merchant-one' } }],
  };
  let readGate: (() => Promise<void>) | undefined;
  let loseCaptureResponse = false;
  const fetchMock = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'test-token', expires_in: 3600 });
    if (url.endsWith('/orders') && options?.method === 'POST') {
      const payload = JSON.parse(String(options.body));
      expect(payload.purchase_units[0].amount).toEqual({ currency_code: 'EUR', value: '1.23' });
      expect(payload.purchase_units[0].custom_id).toBe(`${id}:3`);
      return Response.json(order);
    }
    if (url.endsWith('/capture')) {
      order = { ...order, status: 'COMPLETED', purchase_units: [{ ...order.purchase_units[0], payments: { captures: [{
        id: 'CAPTURE-ONE', status: 'COMPLETED', final_capture: true, amount: { currency_code: 'EUR', value: '1.23' },
      }] } }] };
      if (loseCaptureResponse) { loseCaptureResponse = false; throw new Error('Lost response after capture'); }
      return Response.json({ id: order.id, status: 'COMPLETED' });
    }
    if (readGate) await readGate();
    return Response.json(order);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    approve: () => { order.status = 'APPROVED'; },
    loseNextCaptureResponse: () => { loseCaptureResponse = true; },
    blockReads: (callback: () => Promise<void>) => { readGate = callback; },
  };
}
const checkout = { approvedRevision: 3, scopeAccepted: true };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('customer agreement grants', () => {
  it('shares a seven-day grant stored only as a digest and exposes the approved agreement without owner cookies', async () => {
    const fixture = await setup();
    const link = await fixture.share();
    expect(link.token).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(link.expiresAt) - Date.now()).toBeGreaterThan(7 * 86400000 - 5000);
    expect(link.revision).toBe(3);
    const row = fixture.connection.prepare('SELECT * FROM hosted_customer_grants').get() as { token_hash: string };
    expect(row.token_hash).toBe(await hash(link.token));
    expect(JSON.stringify(row)).not.toContain(link.token);
    const response = await fixture.customer(link.token);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const agreement = await response.json() as AgreementView;
    expect(Object.keys(agreement).sort()).toEqual(['approved', 'id', 'payment', 'status']);
    expect(agreement.approved).toMatchObject({ priceCents: 123, revision: 3, included: ['One inquiry form'] });
    expect(agreement.approved).not.toHaveProperty('request');
    expect(JSON.stringify(agreement)).not.toContain('confidential@example.test');
    expect(agreement).not.toHaveProperty('hourlyRateCents');
    expect(agreement).not.toHaveProperty('workEstimate');
    expect(agreement).not.toHaveProperty('workspace_id');
    expect((await (await fixture.owner('/api/config')).json())).toMatchObject({ customerSharing: true });
  });

  it('rotates and revokes links, and never accepts a token in a query string', async () => {
    const fixture = await setup();
    const first = await fixture.share();
    const second = await fixture.share();
    expect(second.token).not.toBe(first.token);
    expect((await fixture.customer(first.token)).status).toBe(401);
    expect((await fixture.customer(second.token)).status).toBe(200);
    expect((await fixture.customer(undefined, `/api/customer?token=${second.token}`)).status).toBe(401);
    const revoked = await fixture.owner(`/api/quotes/${fixture.id}/share/revoke`, 'POST', { expectedRevision: 3 });
    expect(await revoked.json()).toEqual({ revoked: true });
    expect((await fixture.customer(second.token)).status).toBe(401);
    expect(fixture.connection.prepare('SELECT COUNT(*) AS count FROM hosted_customer_grants').get()).toEqual({ count: 0 });
  });

  it('expires links and invalidates the old revision after editing and reapproval', async () => {
    const fixture = await setup();
    const first = await fixture.share();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(first.expiresAt));
    expect((await fixture.customer(first.token)).status).toBe(401);
    clock.mockRestore();
    const edited = await (await fixture.owner(`/api/quotes/${fixture.id}`, 'PUT', edit(fixture.quote))).json() as Quote;
    expect(edited.revision).toBe(4);
    expect((await fixture.customer(first.token)).status).toBe(401);
    expect((await fixture.owner(`/api/quotes/${fixture.id}/share`, 'POST', { expectedRevision: 4 })).status).toBe(409);
    expect((await fixture.owner(`/api/quotes/${fixture.id}/approve`, 'POST', { expectedRevision: 4 })).status).toBe(200);
    expect((await fixture.customer(first.token)).status).toBe(401);
    const current = await fixture.share(4);
    expect((await fixture.customer(current.token)).status).toBe(200);
    expect((await fixture.owner(`/api/quotes/${fixture.id}/share`, 'POST', { expectedRevision: 3 })).status).toBe(409);
  });

  it('grants no owner editing, listing, drafting or approval authority', async () => {
    const fixture = await setup();
    const link = await fixture.share();
    for (const path of ['/api/quotes', `/api/quotes/${fixture.id}`, `/api/quotes/${fixture.id}/draft`,
      `/api/quotes/${fixture.id}/approve`, `/api/quotes/${fixture.id}/share`]) {
      expect((await fixture.customer(link.token, path, path.endsWith('/quotes') || path.endsWith(fixture.id) ? 'GET' : 'POST',
        path.endsWith('/quotes') || path.endsWith(fixture.id) ? undefined : { expectedRevision: 3 })).status).toBe(403);
    }
    expect((await fixture.customer(link.token, '/api/customer/draft', 'POST', { expectedRevision: 3 })).status).toBe(404);
    expect((await fixture.customer(link.token, '/api/customer', 'PUT', {})).status).toBe(405);
    expect((await fixture.customer(link.token, '/api/customer/orders', 'POST', checkout, { origin: 'https://attacker.example' })).status).toBe(403);
  });

  it('checks customer consent and exact grant revision before any external payment call', async () => {
    const fixture = await setup();
    const link = await fixture.share();
    const payments = sandbox(fixture.id);
    expect((await fixture.customer(link.token, '/api/customer/orders', 'POST', { ...checkout, approvedRevision: 4 })).status).toBe(409);
    expect((await fixture.customer(link.token, '/api/customer/orders', 'POST', { ...checkout, scopeAccepted: false })).status).toBe(400);
    expect((await fixture.customer(link.token, '/api/customer/orders/WRONG/capture', 'POST', checkout)).status).toBe(409);
    expect(payments.fetchMock).not.toHaveBeenCalled();
  });

  it('completes sandbox checkout against the stored agreement and returns only its receipt view', async () => {
    const fixture = await setup();
    const link = await fixture.share();
    const payments = sandbox(fixture.id);
    const created = await fixture.customer(link.token, '/api/customer/orders', 'POST', checkout);
    expect(await created.json()).toEqual({ orderId: 'ORDER-ONE', revision: 3 });
    payments.approve();
    const captured = await fixture.customer(link.token, '/api/customer/orders/ORDER-ONE/capture', 'POST', checkout);
    expect(captured.status).toBe(200);
    const view = await captured.json() as AgreementView;
    expect(view).toMatchObject({ status: 'paid', payment: { orderId: 'ORDER-ONE', captureId: 'CAPTURE-ONE', priceCents: 123 } });
    expect(JSON.stringify(view)).not.toContain('confidential@example.test');
    expect(Object.keys(view).sort()).toEqual(['approved', 'id', 'payment', 'status']);
    expect((await (await fixture.customer(link.token)).json() as AgreementView).payment).toEqual(view.payment);
    const receiptLink = await fixture.share();
    expect((await fixture.customer(receiptLink.token)).status).toBe(200);
    expect((await fixture.customer(link.token)).status).toBe(401);
  });

  it('recovers an uncertain customer capture without creating another payment', async () => {
    const fixture = await setup();
    const link = await fixture.share();
    const payments = sandbox(fixture.id);
    await fixture.customer(link.token, '/api/customer/orders', 'POST', checkout);
    payments.approve();
    payments.loseNextCaptureResponse();
    expect((await fixture.customer(link.token, '/api/customer/orders/ORDER-ONE/capture', 'POST', checkout)).status).toBe(502);
    const recovery = await fixture.customer(link.token, '/api/customer/checkout-recovery');
    expect(recovery.status).toBe(200);
    expect(await recovery.json()).toEqual({ orderId: 'ORDER-ONE', approvedRevision: 3 });
    const recovered = await fixture.customer(link.token, '/api/customer/orders/ORDER-ONE/capture', 'POST', checkout);
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ status: 'paid', payment: { captureId: 'CAPTURE-ONE', priceCents: 123 } });
    expect(payments.fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/capture'))).toHaveLength(1);
    expect(await (await fixture.customer(link.token, '/api/customer/checkout-recovery')).json()).toBeNull();
  });

  it('serializes capture against owner edits, link rotation and revocation', async () => {
    const fixture = await setup();
    const link = await fixture.share();
    const payments = sandbox(fixture.id);
    await fixture.customer(link.token, '/api/customer/orders', 'POST', checkout);
    payments.approve();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    payments.blockReads(async () => { entered(); await gate; });
    const capture = fixture.customer(link.token, '/api/customer/orders/ORDER-ONE/capture', 'POST', checkout);
    await started;
    for (const response of [
      await fixture.owner(`/api/quotes/${fixture.id}`, 'PUT', edit(fixture.quote)),
      await fixture.owner(`/api/quotes/${fixture.id}/share`, 'POST', { expectedRevision: 3 }),
      await fixture.owner(`/api/quotes/${fixture.id}/share/revoke`, 'POST', { expectedRevision: 3 }),
    ]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: 'QUOTE_BUSY' } });
    }
    release();
    expect((await capture).status).toBe(200);
  });

  it('rechecks a grant revoked after its first lookup but before the payment lease', async () => {
    const fixture = await setup();
    const link = await fixture.share();
    const payments = sandbox(fixture.id);
    let intercept = true;
    const wrapped: HostedDatabase = {
      prepare(sql) {
        const statement = fixture.db.prepare(sql);
        const result: ReturnType<HostedDatabase['prepare']> = {
          bind(...values) { statement.bind(...values); return result; },
          first: <T>() => statement.first<T>(), all: <T>() => statement.all<T>(),
          async run() {
            if (intercept && sql.startsWith('UPDATE hosted_quotes SET lock_token = ?')) {
              intercept = false;
              const revoked = await fixture.owner(`/api/quotes/${fixture.id}/share/revoke`, 'POST', { expectedRevision: 3 });
              expect(revoked.status).toBe(200);
            }
            return statement.run();
          },
        };
        return result;
      },
    };
    fixture.env.DB = wrapped;
    const response = await fixture.customer(link.token, '/api/customer/orders', 'POST', checkout);
    expect(response.status).toBe(401);
    expect(payments.fetchMock).not.toHaveBeenCalled();
  });
});
