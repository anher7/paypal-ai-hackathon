import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Quote } from '@agree-first/shared';
import type { PaymentAttempt } from '../../api/src/store.js';
import { openHostedStore, type HostedDatabase } from './store.js';
import { createQuoteService } from '../../api/src/service.js';
import type { PaymentProvider, PaypalOrder } from '../../api/src/paypal.js';
import { AppError } from '../../api/src/errors.js';

import { database } from './test-database.js';

function quote(id = 'quote-1'): Quote {
  return {
    id, title: 'Booking form', customerName: 'Test customer', request: 'Make a booking form.',
    included: [], excluded: [], needs: [], questions: [], draftSource: 'manual',
    priceCents: null, currency: 'EUR', revision: 1, status: 'draft', approved: null,
    payment: null, createdAt: '2026-11-10T12:00:00.000Z', updatedAt: '2026-11-10T12:00:00.000Z',
  };
}
function attempt(): PaymentAttempt {
  return {
    id: 'attempt-1', quoteId: 'quote-1', revision: 1, createRequestId: 'create-id',
    captureRequestId: 'capture-id', orderId: 'order-1', merchantId: 'merchant-1',
    state: 'capturing', createdAt: '2026-11-10T12:00:00.000Z', captureStartedAt: '2026-11-10T12:00:00.000Z',
  };
}
async function seed(db: HostedDatabase, workspace = 'workspace-a', id = 'quote-1') {
  const session = await openHostedStore(db, workspace, undefined, true);
  session.store.saveQuote(quote(id));
  await session.close();
}

afterEach(() => vi.restoreAllMocks());

describe('hosted quote persistence', () => {
  it('isolates listing, reads, updates and payment lookup by workspace', async () => {
    const { db } = database();
    await seed(db);
    await seed(db, 'workspace-b', 'quote-2');
    const owner = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    owner.store.saveAttempt(attempt());
    await owner.close();
    const other = await openHostedStore(db, 'workspace-b');
    expect(other.store.listQuotes().map((value) => value.id)).toEqual(['quote-2']);
    expect(other.store.getQuote('quote-1')).toBeUndefined();
    expect(other.store.getAttemptByOrder('order-1')).toBeUndefined();
    await expect(openHostedStore(db, 'workspace-b', 'quote-1', true)).rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND', status: 404 });
    const guessed = await openHostedStore(db, 'workspace-b', 'quote-1');
    expect(guessed.store.getQuote('quote-1')).toBeUndefined();
    await guessed.close();
    await other.close();
  });

  it('locks mutations across sessions and releases on close', async () => {
    const { db } = database();
    await seed(db);
    const first = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    await expect(openHostedStore(db, 'workspace-a', 'quote-1', true)).rejects.toMatchObject({ code: 'QUOTE_BUSY', status: 409 });
    await first.close();
    const next = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    await next.close();
  });

  it('checkpoints the capture intent before a provider call can fail', async () => {
    const { db } = database();
    await seed(db);
    const session = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    session.store.saveAttempt(attempt());
    await session.checkpoint();
    // A request can terminate after this point; its recovery intent is durable.
    const simultaneousRead = await openHostedStore(db, 'workspace-a', 'quote-1');
    expect(simultaneousRead.store.getAttempt('quote-1', 1)).toMatchObject({ state: 'capturing', captureRequestId: 'capture-id' });
    await simultaneousRead.close();
    await session.close();
    const recovery = await openHostedStore(db, 'workspace-a', 'quote-1');
    expect(recovery.store.getAttemptByOrder('order-1')?.state).toBe('capturing');
    await recovery.close();
  });

  it('uses durable payment intent to recover a successful capture after a provider timeout', async () => {
    const { db } = database();
    const approved = {
      ...quote(), included: ['One booking form'], priceCents: 100,
      approved: { ...quote(), included: ['One booking form'], revision: 1, priceCents: 100, approvedAt: '2026-11-10T12:00:00.000Z' },
      status: 'ready' as const,
    };
    const setup = await openHostedStore(db, 'workspace-a', undefined, true);
    setup.store.saveQuote(approved);
    await setup.close();
    let current: Awaited<ReturnType<typeof openHostedStore>>;
    let storedOrder: PaypalOrder;
    let captureCalls = 0;
    const provider: PaymentProvider = {
      configured: true, clientId: 'test-client', merchantId: 'merchant-1',
      async createOrder(id, snapshot) {
        await current.checkpoint();
        const read = await openHostedStore(db, 'workspace-a', 'quote-1');
        expect(read.store.getAttempt(id, 1)).toMatchObject({ state: 'creating', orderId: null });
        await read.close();
        storedOrder = {
          id: 'order-1', status: 'CREATED', intent: 'CAPTURE',
          purchase_units: [{ reference_id: id, custom_id: `${id}:1`,
            amount: { currency_code: 'EUR', value: (snapshot.priceCents / 100).toFixed(2) },
            payee: { merchant_id: 'merchant-1' } }],
        };
        return copyOrder();
      },
      async getOrder() {
        await current.checkpoint();
        return copyOrder();
      },
      async captureOrder(_id, requestId) {
        await current.checkpoint();
        const read = await openHostedStore(db, 'workspace-a', 'quote-1');
        expect(read.store.getAttemptByOrder('order-1')).toMatchObject({ state: 'capturing', captureRequestId: requestId });
        await read.close();
        captureCalls += 1;
        storedOrder.status = 'COMPLETED';
        storedOrder.purchase_units[0].payments = { captures: [{ id: 'capture-1', status: 'COMPLETED', final_capture: true,
          amount: { currency_code: 'EUR', value: '1.00' } }] };
        throw new AppError('PAYMENT_UNCERTAIN', 'Simulated lost response after capture.', 502);
      },
    };
    function copyOrder() { return structuredClone(storedOrder); }
    const drafting = { async draft() { return null; } };
    current = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    await createQuoteService(current.store, drafting, provider).createOrder('quote-1', 1);
    await current.close();
    storedOrder!.status = 'APPROVED';
    current = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    await expect(createQuoteService(current.store, drafting, provider).capture('quote-1', 'order-1', 1))
      .rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    await current.close();
    current = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    const recovery = createQuoteService(current.store, drafting, provider);
    expect(recovery.recovery('quote-1')).toEqual({ orderId: 'order-1', approvedRevision: 1 });
    const paid = await recovery.capture('quote-1', 'order-1', 1);
    expect(paid.payment?.captureId).toBe('capture-1');
    await current.close();
    expect(captureCalls).toBe(1);
    const saved = await openHostedStore(db, 'workspace-a', 'quote-1');
    expect(saved.store.getQuote('quote-1')?.status).toBe('paid');
    expect(saved.store.getAttemptByOrder('order-1')?.state).toBe('paid');
    await saved.close();
  });

  it('commits receipt and payment attempt together and rolls back failed transactions', async () => {
    const { db } = database();
    await seed(db);
    const session = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    expect(() => session.store.transaction(() => {
      session.store.saveQuote({ ...quote(), status: 'paid' });
      session.store.saveAttempt({ ...attempt(), state: 'paid' });
      throw new Error('Simulated failure');
    })).toThrow('Simulated failure');
    await session.checkpoint();
    const unchanged = await openHostedStore(db, 'workspace-a', 'quote-1');
    expect(unchanged.store.getQuote('quote-1')?.status).toBe('draft');
    expect(unchanged.store.getAttempt('quote-1', 1)).toBeUndefined();
    await unchanged.close();
    session.store.transaction(() => {
      session.store.saveQuote({ ...quote(), status: 'paid' });
      session.store.saveAttempt({ ...attempt(), state: 'paid' });
    });
    await session.close();
    const paid = await openHostedStore(db, 'workspace-a', 'quote-1');
    expect(paid.store.getQuote('quote-1')?.status).toBe('paid');
    expect(paid.store.getAttempt('quote-1', 1)?.state).toBe('paid');
    await paid.close();
  });

  it('fences an expired worker from overwriting data or releasing the new owner lock', async () => {
    const { db } = database();
    await seed(db);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const stale = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    stale.store.saveQuote({ ...quote(), title: 'Stale update' });
    clock.mockReturnValue(1_180_001);
    const current = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    current.store.saveQuote({ ...quote(), title: 'Current update' });
    await current.checkpoint();
    await expect(stale.close()).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    await expect(openHostedStore(db, 'workspace-a', 'quote-1', true)).rejects.toMatchObject({ code: 'QUOTE_BUSY' });
    await current.close();
    const saved = await openHostedStore(db, 'workspace-a', 'quote-1');
    expect(saved.store.getQuote('quote-1')?.title).toBe('Current update');
    await saved.close();
  });

  it('fences stale grant rotation and revocation after a newer worker takes the quote lease', async () => {
    const { db, connection } = database();
    await seed(db);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const stale = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    clock.mockReturnValue(1_180_001);
    const current = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    await current.saveCustomerGrant({ tokenHash: 'current-token-hash', approvedRevision: 1, expiresAt: 9_000_000 });
    await expect(stale.saveCustomerGrant({ tokenHash: 'stale-token-hash', approvedRevision: 1, expiresAt: 9_000_000 }))
      .rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    await expect(stale.revokeCustomerGrant()).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    expect(connection.prepare('SELECT token_hash FROM hosted_customer_grants').get()).toEqual({ token_hash: 'current-token-hash' });
    await expect(stale.close()).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    await current.close();
  });

  it('enforces the 20 quote limit atomically for two concurrent create sessions', async () => {
    const { db, connection } = database();
    for (let index = 0; index < 19; index += 1) await seed(db, 'workspace-a', `quote-${index}`);
    const a = await openHostedStore(db, 'workspace-a', undefined, true);
    const b = await openHostedStore(db, 'workspace-a', undefined, true);
    a.store.saveQuote(quote('new-a'));
    b.store.saveQuote(quote('new-b'));
    await a.close();
    await expect(b.close()).rejects.toMatchObject({ code: 'WORKSPACE_FULL', status: 429 });
    expect(connection.prepare('SELECT COUNT(*) AS count FROM hosted_quotes').get()).toEqual({ count: 20 });
    await seed(db, 'workspace-b', 'other-workspace');
  });

  it('rejects oversized UTF-8 payloads without losing the saved quote or leaking its lock', async () => {
    const { db } = database();
    await seed(db);
    const session = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    session.store.saveQuote({ ...quote(), request: '€'.repeat(180_000) });
    await expect(session.close()).rejects.toMatchObject({ code: 'QUOTE_TOO_LARGE', status: 413 });
    const next = await openHostedStore(db, 'workspace-a', 'quote-1', true);
    expect(next.store.getQuote('quote-1')?.request).toBe('Make a booking form.');
    await next.close();
  });

  it('prevents unintended writes through reads, list/create sessions, and object references', async () => {
    const { db } = database();
    await seed(db);
    const read = await openHostedStore(db, 'workspace-a');
    const loaded = read.store.getQuote('quote-1')!;
    loaded.title = 'Unsaved mutation';
    expect(read.store.getQuote('quote-1')?.title).toBe('Booking form');
    expect(() => read.store.saveQuote(quote())).toThrow('This request cannot change quotes.');
    await read.close();
    const create = await openHostedStore(db, 'workspace-a', undefined, true);
    expect(() => create.store.saveQuote({ ...quote(), title: 'Unexpected update' })).toThrow();
    create.store.saveQuote(quote('new-a'));
    expect(() => create.store.saveQuote(quote('new-b'))).toThrow();
    create.store.saveQuote({ ...quote('new-a'), title: 'Updated before insert' });
    await create.close();
    const saved = await openHostedStore(db, 'workspace-a', 'new-a');
    expect(saved.store.getQuote('new-a')?.title).toBe('Updated before insert');
    await saved.close();
  });
});
