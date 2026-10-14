import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { parseEuroPrice, quoteUpdateSchema, type Quote, type QuoteUpdate } from '@agree-first/shared';
import { createStore, type QuoteStore } from './store.js';
import { createQuoteService } from './service.js';
import { exampleDraftProvider, examples } from './drafting.js';
import { createPaypalProvider, type PaymentProvider, type PaypalOrder } from './paypal.js';
import { AppError } from './errors.js';
import { createApp } from './app.js';

const stores: QuoteStore[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function fakePayments() {
  const orders = new Map<string, PaypalOrder>();
  const provider: PaymentProvider = {
    configured: true,
    clientId: 'sandbox-test-client',
    merchantId: 'merchant-one',
    createOrder: vi.fn(async (quoteId, approved, _requestId) => {
      const order: PaypalOrder = {
        id: `ORDER-${orders.size + 1}`, status: 'CREATED', intent: 'CAPTURE',
        purchase_units: [{
          reference_id: quoteId, custom_id: `${quoteId}:${approved.revision}`,
          amount: { currency_code: 'EUR', value: (approved.priceCents / 100).toFixed(2) },
          payee: { merchant_id: 'merchant-one' },
        }],
      };
      orders.set(order.id, order);
      return structuredClone(order);
    }),
    getOrder: vi.fn(async (orderId) => structuredClone(orders.get(orderId)!)),
    captureOrder: vi.fn(async (orderId, _requestId) => {
      const order = orders.get(orderId)!;
      order.status = 'COMPLETED';
      order.purchase_units[0].payments = { captures: [{
        id: `CAPTURE-${orderId}`, status: 'COMPLETED', final_capture: true,
        amount: { ...order.purchase_units[0].amount },
      }] };
      return structuredClone(order);
    }),
  };
  return { provider, orders };
}

function setup() {
  const store = createStore(':memory:');
  stores.push(store);
  const { provider, orders } = fakePayments();
  const service = createQuoteService(store, exampleDraftProvider, provider);
  return { store, service, provider, orders };
}

function edit(quote: Quote, changes: Partial<QuoteUpdate> = {}): QuoteUpdate {
  return {
    title: quote.title, customerName: quote.customerName, request: quote.request,
    expectedRevision: quote.revision, included: ['A five-page website.'], excluded: [], needs: [],
    questions: [], price: '450.05', ...changes,
  };
}

async function ready(fixture: ReturnType<typeof setup>) {
  const draft = fixture.service.create(examples[0]);
  const edited = await fixture.service.update(draft.id, edit(draft));
  return fixture.service.approve(edited.id, edited.revision);
}

async function checkout(fixture: ReturnType<typeof setup>) {
  const quote = await ready(fixture);
  const result = await fixture.service.createOrder(quote.id, quote.revision);
  fixture.orders.get(result.orderId)!.status = 'APPROVED';
  return { quote, result };
}

describe('human prices', () => {
  it.each([['450', 45000], ['450.05', 45005], ['0.01', 1], ['12.3', 1230], ['9999999.99', 999999999]])('parses %s exactly', (price, cents) => {
    expect(parseEuroPrice(price as string)).toBe(cents);
  });
  it.each(['0', '-10', '1e3', '10,50', '10.005', '10000000', 'NaN', ''])('rejects invalid price %s', (price) => {
    expect(parseEuroPrice(price)).toBeNull();
  });
  it('rejects duplicate question identifiers', () => {
    const quote = setup().service.create(examples[0]);
    const question = { id: 'same', sourcePhrase: 'booking form', prompt: 'Which kind?', resolution: 'answer' as const, response: 'Inquiry.' };
    expect(quoteUpdateSchema.safeParse(edit(quote, { questions: [question, question] })).success).toBe(false);
  });
});

describe('quote revisions and drafting', () => {
  it('starts empty, labels the example and rejects unknown drafting without changing the quote', async () => {
    const fixture = setup();
    expect(fixture.service.list()).toEqual([]);
    const quote = fixture.service.create(examples[0]);
    const drafted = await fixture.service.draft(quote.id, 1);
    expect(drafted.draftSource).toBe('example');
    expect(drafted.questions[0].sourcePhrase).toBe('booking form');
    expect(drafted.priceCents).toBeNull();
    const manual = fixture.service.create({ title: 'Other job', customerName: 'Test', request: 'Draw a logo.' });
    await expect(fixture.service.draft(manual.id, 1)).rejects.toMatchObject({ code: 'AI_NOT_CONNECTED' });
    expect(fixture.service.get(manual.id).revision).toBe(1);
  });
  it('requires scope, price and every question resolution before approval', async () => {
    const fixture = setup();
    const quote = fixture.service.create(examples[0]);
    await expect(fixture.service.approve(quote.id, 1)).rejects.toMatchObject({ code: 'QUOTE_INCOMPLETE' });
    const drafted = await fixture.service.draft(quote.id, 1);
    const unresolved = await fixture.service.update(quote.id, edit(drafted, { questions: drafted.questions }));
    await expect(fixture.service.approve(quote.id, unresolved.revision)).rejects.toMatchObject({ code: 'QUESTIONS_UNRESOLVED' });
    const resolved = await fixture.service.update(quote.id, edit(unresolved, {
      questions: unresolved.questions.map((question) => ({ ...question, resolution: 'assumption', response: 'An inquiry form.' })),
    }));
    const approved = await fixture.service.approve(quote.id, resolved.revision);
    expect(approved.approved?.questions[0].response).toBe('An inquiry form.');
    expect(approved.approved?.priceCents).toBe(45005);
  });
  it('rejects stale saves and invalidates approval after any edit', async () => {
    const fixture = setup();
    const quote = await ready(fixture);
    await expect(fixture.service.update(quote.id, edit(quote, { expectedRevision: 1 }))).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    const changed = await fixture.service.update(quote.id, edit(quote, { price: '500' }));
    expect(changed.status).toBe('draft');
    expect(changed.approved).toBeNull();
    expect(quote.approved?.priceCents).toBe(45005);
    await expect(fixture.service.createOrder(quote.id, quote.revision)).rejects.toMatchObject({ code: 'APPROVAL_CHANGED' });
  });
  it('persists quotes, approval snapshots, and attempts across restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agree-first-test-'));
    directories.push(directory);
    const path = join(directory, 'quotes.sqlite');
    const fixture = setup();
    const firstStore = createStore(path);
    const service = createQuoteService(firstStore, exampleDraftProvider, fixture.provider);
    const quote = service.create(examples[0]);
    const edited = await service.update(quote.id, edit(quote));
    const approved = await service.approve(quote.id, edited.revision);
    const order = await service.createOrder(quote.id, approved.revision);
    firstStore.close();
    const reopened = createStore(path);
    stores.push(reopened);
    expect(reopened.getQuote(quote.id)).toEqual(approved);
    expect(reopened.getAttemptByOrder(order.orderId)?.quoteId).toBe(quote.id);
  });
});

describe('sandbox payment correctness', () => {
  it('shows missing setup without making any provider request', async () => {
    const fixture = setup();
    fixture.provider.configured = false;
    const quote = await ready(fixture);
    await expect(fixture.service.createOrder(quote.id, quote.revision)).rejects.toMatchObject({ code: 'PAYPAL_NOT_CONFIGURED' });
    expect(fixture.provider.createOrder).not.toHaveBeenCalled();
    expect(createPaypalProvider({}).clientId).toBeNull();
  });
  it('records completed payment once and makes paid quotes read-only', async () => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    const paid = await fixture.service.capture(quote.id, result.orderId, quote.revision);
    expect(paid.payment?.priceCents).toBe(45005);
    expect(paid.status).toBe('paid');
    expect(await fixture.service.capture(quote.id, result.orderId, quote.revision)).toEqual(paid);
    expect(fixture.provider.captureOrder).toHaveBeenCalledTimes(1);
    await expect(fixture.service.update(quote.id, edit(paid))).rejects.toMatchObject({ code: 'QUOTE_PAID' });
    await expect(fixture.service.draft(quote.id, paid.revision)).rejects.toMatchObject({ code: 'QUOTE_PAID' });
  });
  it('rejects old checkout orders and orders belonging to another quote', async () => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    const revised = await fixture.service.update(quote.id, edit(quote));
    await fixture.service.approve(quote.id, revised.revision);
    await expect(fixture.service.capture(quote.id, result.orderId, quote.revision)).rejects.toMatchObject({ code: 'APPROVAL_CHANGED' });
    await expect(fixture.service.capture(quote.id, result.orderId, revised.revision)).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    const other = await ready(fixture);
    await expect(fixture.service.capture(other.id, result.orderId, other.revision)).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    expect(fixture.provider.captureOrder).not.toHaveBeenCalled();
  });
  it.each(['amount', 'currency', 'merchant', 'revision'] as const)('rejects a %s mismatch before capture', async (mismatch) => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    const unit = fixture.orders.get(result.orderId)!.purchase_units[0];
    if (mismatch === 'amount') unit.amount.value = '450.06';
    if (mismatch === 'currency') unit.amount.currency_code = 'USD';
    if (mismatch === 'merchant') unit.payee.merchant_id = 'merchant-two';
    if (mismatch === 'revision') unit.custom_id = `${quote.id}:99`;
    await expect(fixture.service.capture(quote.id, result.orderId, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
    expect(fixture.provider.captureOrder).not.toHaveBeenCalled();
    expect(fixture.service.get(quote.id).status).toBe('ready');
  });
  it('reuses an order awaiting buyer action and captures only after approval', async () => {
    const fixture = setup();
    const quote = await ready(fixture);
    const createNormally = vi.mocked(fixture.provider.createOrder).getMockImplementation()!;
    vi.mocked(fixture.provider.createOrder).mockImplementationOnce(async (...arguments_) => {
      const order = await createNormally(...arguments_);
      order.status = 'PAYER_ACTION_REQUIRED';
      fixture.orders.set(order.id, structuredClone(order));
      return order;
    });
    const result = await fixture.service.createOrder(quote.id, quote.revision);
    expect(await fixture.service.createOrder(quote.id, quote.revision)).toEqual(result);
    expect(fixture.provider.createOrder).toHaveBeenCalledTimes(1);
    expect(fixture.service.get(quote.id).status).toBe('ready');
    await expect(fixture.service.capture(quote.id, result.orderId, quote.revision))
      .rejects.toMatchObject({ code: 'CUSTOMER_APPROVAL_NEEDED' });
    expect(fixture.provider.captureOrder).not.toHaveBeenCalled();
    fixture.orders.get(result.orderId)!.status = 'APPROVED';
    expect((await fixture.service.capture(quote.id, result.orderId, quote.revision)).status).toBe('paid');
    expect(fixture.provider.captureOrder).toHaveBeenCalledTimes(1);
  });
  it.each(['CREATED', 'PAYER_ACTION_REQUIRED'])('does not capture a %s checkout', async (status) => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    fixture.orders.get(result.orderId)!.status = status;
    await expect(fixture.service.capture(quote.id, result.orderId, quote.revision)).rejects.toMatchObject({ code: 'CUSTOMER_APPROVAL_NEEDED' });
    expect(fixture.provider.captureOrder).not.toHaveBeenCalled();
  });
  it('uses the persisted create request ID after a timeout and across service restart', async () => {
    const fixture = setup();
    const quote = await ready(fixture);
    const create = vi.mocked(fixture.provider.createOrder);
    create.mockRejectedValueOnce(new AppError('PAYMENT_UNCERTAIN', 'Retry.', 502));
    await expect(fixture.service.createOrder(quote.id, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    const restarted = createQuoteService(fixture.store, exampleDraftProvider, fixture.provider);
    const result = await restarted.createOrder(quote.id, quote.revision);
    expect(create.mock.calls[0][2]).toBe(create.mock.calls[1][2]);
    expect(await restarted.createOrder(quote.id, quote.revision)).toEqual(result);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('reconciles an uncertain capture without charging again and blocks edits until checked', async () => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    const capture = vi.mocked(fixture.provider.captureOrder);
    const captureNormally = capture.getMockImplementation()!;
    capture.mockImplementationOnce(async (...arguments_) => {
      await captureNormally(...arguments_);
      throw new AppError('PAYMENT_UNCERTAIN', 'Retry.', 502);
    });
    await expect(fixture.service.capture(quote.id, result.orderId, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    await expect(fixture.service.update(quote.id, edit(quote))).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    const restarted = createQuoteService(fixture.store, exampleDraftProvider, fixture.provider);
    expect((await restarted.capture(quote.id, result.orderId, quote.revision)).status).toBe('paid');
    expect(capture).toHaveBeenCalledTimes(1);
  });
  it('retries capture with the same persisted identifier when it has not completed', async () => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    const capture = vi.mocked(fixture.provider.captureOrder);
    capture.mockRejectedValueOnce(new AppError('PAYMENT_UNCERTAIN', 'Retry.', 502));
    await expect(fixture.service.capture(quote.id, result.orderId, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    await fixture.service.capture(quote.id, result.orderId, quote.revision);
    expect(capture.mock.calls[0][1]).toBe(capture.mock.calls[1][1]);
  });
  it('does not record pending or mismatched captures as paid', async () => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    vi.mocked(fixture.provider.captureOrder).mockImplementationOnce(async (orderId) => {
      const order = structuredClone(fixture.orders.get(orderId)!);
      order.status = 'COMPLETED';
      order.purchase_units[0].payments = { captures: [{
        id: 'wrong-capture', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '1.00' },
      }] };
      return order;
    });
    await expect(fixture.service.capture(quote.id, result.orderId, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_NOT_COMPLETED' });
    expect(fixture.service.get(quote.id).payment).toBeNull();
  });
  it('guards against concurrent edits while order creation is in progress', async () => {
    const fixture = setup();
    const quote = await ready(fixture);
    const original = vi.mocked(fixture.provider.createOrder).getMockImplementation()!;
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(fixture.provider.createOrder).mockImplementationOnce(async (...arguments_) => {
      await pending;
      return original(...arguments_);
    });
    const creating = fixture.service.createOrder(quote.id, quote.revision);
    await expect(fixture.service.update(quote.id, edit(quote))).rejects.toMatchObject({ code: 'QUOTE_BUSY' });
    release();
    await creating;
  });
});

describe('saved payment recovery', () => {
  it('returns only the current uncertain checkout and hides completed payments', async () => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    expect(fixture.service.recovery(quote.id)).toBeNull();
    vi.mocked(fixture.provider.captureOrder).mockRejectedValueOnce(new AppError('PAYMENT_UNCERTAIN', 'Retry.', 502));
    await expect(fixture.service.capture(quote.id, result.orderId, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    expect(fixture.service.recovery(quote.id)).toEqual({ orderId: result.orderId, approvedRevision: quote.revision });
    await fixture.service.capture(quote.id, result.orderId, quote.revision);
    expect(fixture.service.recovery(quote.id)).toBeNull();
  });
  it('restores recovery metadata after SQLite closes and reopens without a provider request', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agree-first-recovery-'));
    directories.push(directory);
    const path = join(directory, 'quotes.sqlite');
    const { provider, orders } = fakePayments();
    const originalStore = createStore(path);
    const original = createQuoteService(originalStore, exampleDraftProvider, provider);
    const created = original.create(examples[0]);
    const edited = await original.update(created.id, edit(created));
    const quote = await original.approve(created.id, edited.revision);
    const result = await original.createOrder(quote.id, quote.revision);
    orders.get(result.orderId)!.status = 'APPROVED';
    vi.mocked(provider.captureOrder).mockRejectedValueOnce(new AppError('PAYMENT_UNCERTAIN', 'Retry.', 502));
    await expect(original.capture(quote.id, result.orderId, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    originalStore.close();
    const reopened = createStore(path);
    stores.push(reopened);
    const restarted = createQuoteService(reopened, exampleDraftProvider, provider);
    vi.mocked(provider.getOrder).mockClear();
    vi.mocked(provider.createOrder).mockClear();
    vi.mocked(provider.captureOrder).mockClear();
    expect(restarted.recovery(quote.id)).toEqual({ orderId: result.orderId, approvedRevision: quote.revision });
    expect(provider.getOrder).not.toHaveBeenCalled();
    expect(provider.createOrder).not.toHaveBeenCalled();
    expect(provider.captureOrder).not.toHaveBeenCalled();
  });
  it('does not expose attempts from stale revisions or unapproved drafts', async () => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    const attempt = fixture.store.getAttemptByOrder(result.orderId)!;
    fixture.store.saveAttempt({ ...attempt, state: 'capturing' });
    fixture.store.saveQuote({ ...quote, revision: quote.revision + 1 });
    expect(fixture.service.recovery(quote.id)).toBeNull();
    fixture.store.saveQuote({ ...quote, status: 'draft', approved: null });
    expect(fixture.service.recovery(quote.id)).toBeNull();
  });
  it('accepts a highlighted phrase with different capitalization', async () => {
    const fixture = setup();
    const quote = fixture.service.create(examples[0]);
    const edited = await fixture.service.update(quote.id, edit(quote, {
      questions: [{ id: 'booking', sourcePhrase: 'BOOKING FORM', prompt: 'Which kind?', resolution: 'answer', response: 'Inquiry.' }],
    }));
    expect(edited.questions[0].sourcePhrase).toBe('BOOKING FORM');
  });
  it('does not send another capture while PayPal reports a pending capture', async () => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    const order = fixture.orders.get(result.orderId)!;
    order.purchase_units[0].payments = { captures: [{ id: 'pending-capture', status: 'PENDING', amount: { ...order.purchase_units[0].amount } }] };
    await expect(fixture.service.capture(quote.id, result.orderId, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_NOT_COMPLETED' });
    expect(fixture.provider.captureOrder).not.toHaveBeenCalled();
  });

  it('checks saved orders and explains how to recover an expired unpaid checkout', async () => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    fixture.orders.get(result.orderId)!.status = 'VOIDED';
    await expect(fixture.service.createOrder(quote.id, quote.revision)).rejects.toMatchObject({ code: 'CHECKOUT_EXPIRED' });
    expect(fixture.provider.createOrder).toHaveBeenCalledTimes(1);
    const revised = await fixture.service.update(quote.id, edit(quote));
    await fixture.service.approve(quote.id, revised.revision);
    const replacement = await fixture.service.createOrder(quote.id, revised.revision);
    expect(replacement.orderId).not.toBe(result.orderId);
  });
  it('reconciles a completed saved order before trying checkout again', async () => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    await fixture.provider.captureOrder(result.orderId, 'provider-test');
    await expect(fixture.service.createOrder(quote.id, quote.revision)).rejects.toMatchObject({ code: 'QUOTE_PAID' });
    expect(fixture.service.get(quote.id).status).toBe('paid');
    expect(fixture.provider.createOrder).toHaveBeenCalledTimes(1);
  });
  it('clears a capture uncertainty only when PayPal confirms an unpaid voided order', async () => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    vi.mocked(fixture.provider.captureOrder).mockRejectedValueOnce(new AppError('PAYMENT_UNCERTAIN', 'Retry.', 502));
    await expect(fixture.service.capture(quote.id, result.orderId, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    fixture.orders.get(result.orderId)!.status = 'VOIDED';
    await expect(fixture.service.capture(quote.id, result.orderId, quote.revision)).rejects.toMatchObject({ code: 'CHECKOUT_EXPIRED' });
    expect((await fixture.service.update(quote.id, edit(quote))).revision).toBe(quote.revision + 1);
  });
  it('does not clear capture uncertainty when a voided order contains a capture', async () => {
    const fixture = setup();
    const { quote, result } = await checkout(fixture);
    vi.mocked(fixture.provider.captureOrder).mockRejectedValueOnce(new AppError('PAYMENT_UNCERTAIN', 'Retry.', 502));
    await expect(fixture.service.capture(quote.id, result.orderId, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    const order = fixture.orders.get(result.orderId)!;
    order.status = 'VOIDED';
    order.purchase_units[0].payments = { captures: [{ id: 'pending-capture', status: 'PENDING', amount: { ...order.purchase_units[0].amount } }] };
    await expect(fixture.service.createOrder(quote.id, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    await expect(fixture.service.update(quote.id, edit(quote))).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
  });
  it('refuses to reuse uncertain retry keys after their safe retry window', async () => {
    const fixture = setup();
    const quote = await ready(fixture);
    vi.mocked(fixture.provider.createOrder).mockRejectedValueOnce(new AppError('PAYMENT_UNCERTAIN', 'Retry.', 502));
    await expect(fixture.service.createOrder(quote.id, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    const attempt = fixture.store.getAttempt(quote.id, quote.revision)!;
    fixture.store.saveAttempt({ ...attempt, createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() });
    await expect(fixture.service.createOrder(quote.id, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_REVIEW_NEEDED' });
    expect(fixture.provider.createOrder).toHaveBeenCalledTimes(1);
  });
});

describe('local API boundaries', () => {
  it('validates scope confirmation and rejects cross-origin requests', async () => {
    const fixture = setup();
    const allowedPorts: number[] = [];
    const app = createApp({ store: fixture.store, payments: fixture.provider, allowedPorts });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as AddressInfo).port;
    allowedPorts.push(port);
    const url = `http://127.0.0.1:${port}`;
    try {
      const crossOrigin = await fetch(`${url}/api/quotes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
        body: JSON.stringify(examples[0]),
      });
      expect(crossOrigin.status).toBe(403);
      const quote = await ready(fixture);
      const unaccepted = await fetch(`${url}/api/quotes/${quote.id}/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedRevision: quote.revision, scopeAccepted: false }),
      });
      expect(unaccepted.status).toBe(400);
      expect(fixture.provider.createOrder).not.toHaveBeenCalled();
      const config = await fetch(`${url}/api/config`).then((response) => response.json()) as Record<string, unknown>;
      expect(config.paypalClientId).toBe('sandbox-test-client');
      expect(config).not.toHaveProperty('paypalClientSecret');
      const badJson = await fetch(`${url}/api/quotes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
      });
      expect(badJson.status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
