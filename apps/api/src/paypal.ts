import { z } from 'zod';
import type { ApprovalSnapshot } from '@agree-first/shared';
import { AppError } from './errors.js';

const amountSchema = z.object({ currency_code: z.string(), value: z.string() });
export const paypalOrderSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  intent: z.string().optional(),
  purchase_units: z.array(z.object({
    reference_id: z.string(),
    custom_id: z.string().optional(),
    amount: amountSchema,
    payee: z.object({ merchant_id: z.string().min(1) }),
    payments: z.object({
      captures: z.array(z.object({
        id: z.string().min(1),
        status: z.string(),
        amount: amountSchema,
        final_capture: z.boolean().optional(),
      })).optional(),
    }).optional(),
  })),
});
export type PaypalOrder = z.infer<typeof paypalOrderSchema>;

export interface PaymentProvider {
  configured: boolean;
  clientId: string | null;
  merchantId?: string;
  createOrder(quoteId: string, approved: ApprovalSnapshot, requestId: string): Promise<PaypalOrder>;
  getOrder(orderId: string): Promise<PaypalOrder>;
  captureOrder(orderId: string, requestId: string): Promise<PaypalOrder>;
}

export function createPaypalProvider(environment: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const clientId = environment.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = environment.PAYPAL_CLIENT_SECRET?.trim();
  const merchantId = environment.PAYPAL_MERCHANT_ID?.trim() || undefined;
  const configured = Boolean(clientId && clientSecret);
  let accessToken: { value: string; expiresAt: number } | undefined;
  const baseUrl = 'https://api-m.sandbox.paypal.com';

  async function fetchSafe(url: string, options: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new AppError('PAYMENT_UNCERTAIN', 'PayPal has not confirmed the result. Retry this same payment to check it safely.', 502);
    }
  }

  async function token(): Promise<string> {
    if (!configured) {
      throw new AppError('PAYPAL_NOT_CONFIGURED', 'Sandbox checkout needs setup.', 503);
    }
    if (accessToken && accessToken.expiresAt > Date.now()) {
      return accessToken.value;
    }
    const response = await fetchSafe(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) {
      throw new AppError('PAYPAL_SETUP_ERROR', 'PayPal could not verify the sandbox setup.', 502);
    }
    const parsed = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).safeParse(await response.json());
    if (!parsed.success) {
      throw new AppError('PAYPAL_SETUP_ERROR', 'PayPal could not verify the sandbox setup.', 502);
    }
    accessToken = { value: parsed.data.access_token, expiresAt: Date.now() + Math.max(0, parsed.data.expires_in - 60) * 1000 };
    return accessToken.value;
  }

  async function orderRequest(path: string, method: 'POST' | 'GET', requestId?: string, body?: unknown): Promise<PaypalOrder> {
    const authorization = await token();
    const response = await fetchSafe(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${authorization}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
    if (!response.ok) {
      if (response.status === 401) {
        accessToken = undefined;
      }
      throw new AppError('PAYMENT_UNCERTAIN', 'PayPal has not confirmed the result. Retry this same payment to check it safely.', 502);
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new AppError('PAYMENT_UNCERTAIN', 'PayPal has not confirmed the result. Retry this same payment to check it safely.', 502);
    }
    if (path.endsWith('/capture')) {
      return orderRequest(path.slice(0, -8), 'GET');
    }
    const parsed = paypalOrderSchema.safeParse(value);
    if (!parsed.success) {
      throw new AppError('PAYMENT_UNCERTAIN', 'PayPal returned an incomplete payment result. Retry to check its status.', 502);
    }
    return parsed.data;
  }

  return {
    configured,
    clientId: configured ? clientId! : null,
    merchantId,
    createOrder(quoteId, approved, requestId) {
      return orderRequest('/v2/checkout/orders', 'POST', requestId, {
        intent: 'CAPTURE',
        payment_source: { paypal: { experience_context: {
          user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING',
        } } },
        purchase_units: [{
          reference_id: quoteId,
          custom_id: `${quoteId}:${approved.revision}`,
          description: 'Agree First sandbox quote',
          amount: { currency_code: approved.currency, value: (approved.priceCents / 100).toFixed(2) },
          ...(merchantId ? { payee: { merchant_id: merchantId } } : {}),
        }],
      });
    },
    getOrder: (orderId) => orderRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, 'GET'),
    captureOrder: (orderId, requestId) => orderRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, 'POST', requestId),
  };
}
