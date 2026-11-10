// Test-only provider fixture. Never imported by the application or production build.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApp } from '../../apps/api/src/app.js';
import { createStore } from '../../apps/api/src/store.js';
import { exampleDraftProvider } from '../../apps/api/src/drafting.js';
import { AppError } from '../../apps/api/src/errors.js';
import type { PaymentProvider, PaypalOrder } from '../../apps/api/src/paypal.js';

const orders = new Map<string, PaypalOrder>();
const uncertain = new Set<string>();
const mismatched = new Set<string>();
const store = createStore(resolve(`work/payment-e2e-${process.pid}.sqlite`));
const payments: PaymentProvider = {
  configured: true, clientId: 'test-only-client', merchantId: 'test-only-merchant',
  async createOrder(quoteId, approved) {
    const order: PaypalOrder = {
      id: `TEST-ORDER-${randomUUID()}`, status: 'APPROVED', intent: 'CAPTURE',
      purchase_units: [{ reference_id: quoteId, custom_id: `${quoteId}:${approved.revision}`,
        amount: { currency_code: 'EUR', value: (approved.priceCents / 100).toFixed(2) },
        payee: { merchant_id: 'test-only-merchant' } }],
    };
    orders.set(order.id, order);
    if (approved.title.includes('[uncertain]')) uncertain.add(order.id);
    if (approved.title.includes('[mismatch]')) mismatched.add(order.id);
    return structuredClone(order);
  },
  async getOrder(orderId) {
    const order = orders.get(orderId);
    if (!order) throw new AppError('NOT_FOUND', 'Test order not found.', 404);
    return structuredClone(order);
  },
  async captureOrder(orderId) {
    if (uncertain.delete(orderId)) throw new AppError('PAYMENT_UNCERTAIN', 'Controlled provider timeout. Check the same payment again.', 502);
    const order = orders.get(orderId)!;
    order.status = 'COMPLETED';
    order.purchase_units[0].payments = { captures: [{
      id: `TEST-CAPTURE-${orderId}`, status: 'COMPLETED', final_capture: true,
      amount: mismatched.has(orderId) ? { currency_code: 'EUR', value: '0.01' } : { ...order.purchase_units[0].amount },
    }] };
    return structuredClone(order);
  },
};
const app = createApp({ store, payments, drafting: exampleDraftProvider,
  allowedPorts: [3002], frontendDirectory: resolve('apps/web/dist/agree-first/browser') });
const server = app.listen(3002, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
