import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { currency, quoteCreateSchema, quoteUpdateSchema, revisionSchema, checkoutSchema, type AppConfig, type AgreementView, type CustomerLink, type Quote } from '@agree-first/shared';
import { createQuoteService } from '../../api/src/service.js';
import { createAiDraftProvider } from '../../api/src/ai.js';
import { createPaypalProvider } from '../../api/src/paypal.js';
import { examples, exampleDraftProvider } from '../../api/src/drafting.js';
import { AppError } from '../../api/src/errors.js';
import { openHostedStore, type HostedDatabase } from './store.js';
import assets from './assets.generated.json' with { type: 'json' };

export interface HostedEnvironment extends Record<string, unknown> {
  DB: HostedDatabase;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_MERCHANT_ID?: string;
  ASTRO_GATEWAY_URL?: string;
  ASTRO_GATEWAY_API_KEY?: string;
  ASTRO_GATEWAY_EXPIRES_AT?: string;
  MODEL_DEFAULT?: string;
  HOSTED_AI_DAILY_LIMIT?: string;
  HOSTED_AI_IP_DAILY_LIMIT?: string;
  HOSTED_AI_IP_BURST_LIMIT?: string;
  HOSTED_AI_TOTAL_LIMIT?: string;
}
const cookieName = '__Host-agree-first';
const sessionPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9-]{36}$/;
const responseHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
};
async function digest(value: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
}
function session(request: Request) {
  const token = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const isNew = !token || !sessionPattern.test(token);
  const value = isNew ? Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex') : token;
  return { value, isNew, cookie: `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` };
}
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: responseHeaders });
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const checked = schema.safeParse(value);
  if (!checked.success) throw new AppError('INVALID_INPUT', checked.error.issues[0]?.message ?? 'Check the information and try again.');
  return checked.data;
}
async function requestBody(request: Request): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new AppError('JSON_REQUIRED', 'Send this request as JSON.', 415);
  if (Number(request.headers.get('content-length') ?? 0) > 65536) throw new AppError('REQUEST_TOO_LARGE', 'Shorten this request and try again.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('INVALID_JSON', 'Check the JSON request and try again.');
  let length = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 65536) { await reader.cancel(); throw new AppError('REQUEST_TOO_LARGE', 'Shorten this request and try again.', 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('INVALID_JSON', 'Check the JSON request and try again.'); }
}
async function consume(db: HostedDatabase, key: string, maximum: number, expiresAt: number, message = 'This demo has reached its usage limit. Please try again later.') {
  const result = await db.prepare(`INSERT INTO hosted_limits (id, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count`).bind(key, expiresAt, maximum).first();
  if (!result) throw new AppError('DEMO_LIMIT', message, 429);
}
function boundedLimit(value: string | undefined, fallback: number, maximum: number): number {
  const numeric = value?.trim() ? Number(value) : NaN;
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(1, Math.floor(numeric))) : fallback;
}
function safeEnvironment(env: HostedEnvironment): NodeJS.ProcessEnv {
  const keys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID', 'ASTRO_GATEWAY_URL', 'ASTRO_GATEWAY_API_KEY', 'ASTRO_GATEWAY_EXPIRES_AT', 'MODEL_DEFAULT'];
  return Object.fromEntries(keys.map((key) => [key, typeof env[key] === 'string' ? env[key] as string : undefined]));
}

interface CustomerGrant {
  quote_id: string;
  workspace_id: string;
  token_hash: string;
  approved_revision: number;
  expires_at: number;
}
const unavailableLink = () => new AppError('CUSTOMER_LINK_UNAVAILABLE', 'This customer link has expired or is no longer available. Ask the freelancer for a new link.', 401);
function agreementView(quote: Quote): AgreementView {
  const approved = quote.approved;
  return {
    id: quote.id, status: quote.status,
    payment: quote.payment ? {
      orderId: quote.payment.orderId, captureId: quote.payment.captureId,
      priceCents: quote.payment.priceCents, currency: quote.payment.currency, paidAt: quote.payment.paidAt,
    } : null,
    approved: approved ? {
      revision: approved.revision, title: approved.title, customerName: approved.customerName,
      included: approved.included, excluded: approved.excluded, needs: approved.needs, questions: approved.questions,
      priceCents: approved.priceCents, currency: approved.currency, approvedAt: approved.approvedAt,
    } : null,
  };
}
function requireApprovedRevision(quote: Quote, revision: number): void {
  if (!quote.approved || quote.status === 'draft' || quote.revision !== revision || quote.approved.revision !== revision) {
    throw new AppError('APPROVAL_CHANGED', 'This quote needs approval again before sharing or checkout.', 409);
  }
}
async function lookupGrant(db: HostedDatabase, tokenHash: string): Promise<CustomerGrant> {
  const grant = await db.prepare('SELECT quote_id, workspace_id, token_hash, approved_revision, expires_at FROM hosted_customer_grants WHERE token_hash = ?')
    .bind(tokenHash).first<CustomerGrant>();
  if (!grant || grant.expires_at <= Date.now()) throw unavailableLink();
  return grant;
}
async function writeLimit(request: Request, env: HostedEnvironment): Promise<void> {
  const client = await digest(request.headers.get('cf-connecting-ip') ?? 'unknown');
  await consume(env.DB, `write:${client}:${Math.floor(Date.now() / 60000)}`, 40, Date.now() + 2 * 86400000);
}
async function handleShare(request: Request, env: HostedEnvironment, workspaceId: string, quoteId: string, revoke: boolean): Promise<Response> {
  if (!idPattern.test(quoteId)) throw new AppError('QUOTE_NOT_FOUND', 'This quote could not be found.', 404);
  if (request.method !== 'POST') throw new AppError('METHOD_NOT_ALLOWED', 'This action is not available.', 405);
  const { expectedRevision } = parse(revisionSchema, await requestBody(request));
  await writeLimit(request, env);
  const session = await openHostedStore(env.DB, workspaceId, quoteId, true);
  try {
    const quote = session.store.getQuote(quoteId)!;
    if (quote.revision !== expectedRevision) throw new AppError('QUOTE_CHANGED', 'This quote changed. Reload it before continuing.', 409);
    if (revoke) {
      await session.revokeCustomerGrant();
      return json({ revoked: true });
    }
    requireApprovedRevision(quote, expectedRevision);
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
    const expiresAt = Date.now() + 7 * 86400000;
    await session.saveCustomerGrant({ tokenHash: await digest(token), approvedRevision: expectedRevision, expiresAt });
    const link: CustomerLink = { token, expiresAt: new Date(expiresAt).toISOString(), revision: expectedRevision };
    return json(link);
  } finally { await session.close(); }
}
async function handleCustomer(request: Request, env: HostedEnvironment, path: string): Promise<Response> {
  const route = /^\/api\/customer(?:\/(checkout-recovery|orders)(?:\/([A-Za-z0-9-]{1,128})\/(capture))?)?$/.exec(path);
  if (!route) throw new AppError('NOT_FOUND', 'This action could not be found.', 404);
  const [, action, orderId, capture] = route;
  if ((orderId && action !== 'orders') || request.method !== (action === 'orders' ? 'POST' : 'GET')) {
    throw new AppError('METHOD_NOT_ALLOWED', 'This action is not available.', 405);
  }
  const bearer = /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get('authorization') ?? '');
  if (!bearer) throw unavailableLink();
  const tokenHash = await digest(bearer[1]);
  const initialGrant = await lookupGrant(env.DB, tokenHash);
  const checkout = action === 'orders' ? parse(checkoutSchema, await requestBody(request)) : undefined;
  if (checkout) await writeLimit(request, env);
  const session = await openHostedStore(env.DB, initialGrant.workspace_id, initialGrant.quote_id, Boolean(checkout));
  try {
    // Re-read after taking the quote lease: revoke/rotate/edit may have run
    // between the initial token lookup and acquisition of the mutation lock.
    const validateGrant = async () => {
      const grant = await lookupGrant(env.DB, tokenHash);
      const quote = session.store.getQuote(initialGrant.quote_id);
      if (!quote || grant.quote_id !== initialGrant.quote_id || grant.workspace_id !== initialGrant.workspace_id ||
        grant.approved_revision !== initialGrant.approved_revision || quote.status === 'draft' ||
        quote.revision !== grant.approved_revision || quote.approved?.revision !== grant.approved_revision) throw unavailableLink();
      return quote;
    };
    const quote = await validateGrant();
    if (checkout && checkout.approvedRevision !== initialGrant.approved_revision) {
      throw new AppError('APPROVAL_CHANGED', 'This customer link does not match the approved quote.', 409);
    }
    const payments = createPaypalProvider(safeEnvironment(env));
    const beforePayment = async () => { await session.checkpoint(); await validateGrant(); };
    const paymentProvider = {
      ...payments,
      createOrder: async (...args: Parameters<typeof payments.createOrder>) => { await beforePayment(); return payments.createOrder(...args); },
      getOrder: async (...args: Parameters<typeof payments.getOrder>) => { await beforePayment(); return payments.getOrder(...args); },
      captureOrder: async (...args: Parameters<typeof payments.captureOrder>) => { await beforePayment(); return payments.captureOrder(...args); },
    };
    const service = createQuoteService(session.store, exampleDraftProvider, paymentProvider);
    if (!action) return json(agreementView(quote));
    if (action === 'checkout-recovery') return json(service.recovery(quote.id));
    if (capture) return json(agreementView(await service.capture(quote.id, orderId!, checkout!.approvedRevision)));
    return json(await service.createOrder(quote.id, checkout!.approvedRevision));
  } finally { await session.close(); }
}

export async function handleApi(request: Request, env: HostedEnvironment, workspaceId: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  const method = request.method;
  const origin = request.headers.get('origin');
  if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new AppError('SAME_ORIGIN_REQUIRED', 'Open Agree First directly to continue.', 403);
  if (!['GET', 'POST', 'PUT'].includes(method)) throw new AppError('METHOD_NOT_ALLOWED', 'This action is not available.', 405);
  const environment = safeEnvironment(env);
  const drafting = createAiDraftProvider(environment);
  const payments = createPaypalProvider(environment);
  if (path === '/api/config' && method === 'GET') {
    const config: AppConfig = { currency, localOnly: false, customerSharing: true, aiMode: drafting.mode ?? 'examples', aiConfigured: drafting.configured ?? false, aiModel: drafting.model ?? null, paypalConfigured: payments.configured, paypalClientId: payments.clientId };
    return json(config);
  }
  if (path === '/api/examples' && method === 'GET') return json(examples);
  if (path === '/api/customer' || path.startsWith('/api/customer/')) return handleCustomer(request, env, path);
  if (request.headers.has('authorization')) throw new AppError('OWNER_SESSION_REQUIRED', 'Open your own workspace to change quotes.', 403);
  const shareRoute = /^\/api\/quotes\/([^/]+)\/share(?:\/(revoke))?$/.exec(path);
  if (shareRoute) return handleShare(request, env, workspaceId, shareRoute[1], Boolean(shareRoute[2]));
  const match = /^\/api\/quotes(?:\/([^/]+)(?:\/(draft|estimate|approve|orders|checkout-recovery)(?:\/([^/]+)\/(capture))?)?)?$/.exec(path);
  if (!match) throw new AppError('NOT_FOUND', 'This action could not be found.', 404);
  const [, quoteId, action, orderId, capture] = match;
  if (orderId && action !== 'orders') throw new AppError('NOT_FOUND', 'This action could not be found.', 404);
  if (quoteId && !idPattern.test(quoteId)) throw new AppError('QUOTE_NOT_FOUND', 'This quote could not be found.', 404);
  if ((!quoteId && !['GET', 'POST'].includes(method)) || (action && method !== (action === 'checkout-recovery' ? 'GET' : 'POST')) || (quoteId && !action && !['GET', 'PUT'].includes(method))) throw new AppError('METHOD_NOT_ALLOWED', 'This action is not available.', 405);
  const body = method === 'GET' ? undefined : await requestBody(request);
  const day = new Date().toISOString().slice(0, 10);
  const expiresAt = Date.now() + 2 * 86400000;
  const client = await digest(request.headers.get('cf-connecting-ip') ?? 'unknown');
  if (method !== 'GET') {
    await consume(env.DB, `write:${client}:${Math.floor(Date.now() / 60000)}`, 40, expiresAt);
    if (!quoteId) {
      await consume(env.DB, `create:${client}:${day}`, 40, expiresAt);
      await env.DB.prepare('DELETE FROM hosted_limits WHERE id IN (SELECT id FROM hosted_limits WHERE expires_at < ? LIMIT 100)').bind(Date.now()).run();
    }
  }
  const store = await openHostedStore(env.DB, workspaceId, quoteId, method !== 'GET');
  try {
    const checkpoint = async () => store.checkpoint();
    const consumeAi = async () => {
      // Each reservation is one atomic statement, including across Workers. IP
      // limits survive cookie resets; the final counter survives day changes.
      await consume(env.DB, `ai-burst:${client}:${Math.floor(Date.now() / 60000)}`,
        boundedLimit(env.HOSTED_AI_IP_BURST_LIMIT, 2, 4), expiresAt,
        'This demo has reached its AI request limit for your network. Try again in a minute.');
      await consume(env.DB, `ai-client:${client}:${day}`,
        boundedLimit(env.HOSTED_AI_IP_DAILY_LIMIT, 12, 24), expiresAt,
        'This demo has reached its daily AI allowance for your network. Try again after midnight UTC.');
      await consume(env.DB, `ai-workspace:${workspaceId}:${day}`, 8, expiresAt,
        'This workspace has reached its daily AI allowance. Try again after midnight UTC.');
      await consume(env.DB, `ai-global:${day}`, boundedLimit(env.HOSTED_AI_DAILY_LIMIT, 40, 100), expiresAt,
        'This demo has reached its shared daily AI allowance. Try again after midnight UTC.');
      // This counter must not be deleted by expired daily/burst quota cleanup.
      await consume(env.DB, 'ai-total:v1', boundedLimit(env.HOSTED_AI_TOTAL_LIMIT, 200, 500), Number.MAX_SAFE_INTEGER,
        'The demo’s total AI allowance has been reached. You can still use the sample draft and edit quotes by hand.');
    };
    const provider = {
      ...drafting,
      draft: async (requestText: string) => {
        await checkpoint();
        const isExample = examples.some((example) => example.request.trim() === requestText.trim());
        if (!isExample && drafting.configured) {
          await consumeAi();
        }
        return drafting.draft(requestText);
      },
      estimate: async (context: Parameters<NonNullable<typeof drafting.estimate>>[0]) => {
        await checkpoint();
        if (drafting.configured) {
          await consumeAi();
        }
        return drafting.estimate!(context);
      },
    };
    const paymentProvider = {
      ...payments,
      createOrder: async (...args: Parameters<typeof payments.createOrder>) => { await checkpoint(); return payments.createOrder(...args); },
      getOrder: async (...args: Parameters<typeof payments.getOrder>) => { await checkpoint(); return payments.getOrder(...args); },
      captureOrder: async (...args: Parameters<typeof payments.captureOrder>) => { await checkpoint(); return payments.captureOrder(...args); },
    };
    const service = createQuoteService(store.store, provider, paymentProvider);
    let result: unknown;
    if (!quoteId) result = method === 'GET' ? service.list() : service.create(parse(quoteCreateSchema, body));
    else if (!action) result = method === 'GET' ? service.get(quoteId) : await service.update(quoteId, parse(quoteUpdateSchema, body));
    else if (action === 'checkout-recovery') result = service.recovery(quoteId);
    else if (action === 'orders') {
      const { approvedRevision } = parse(checkoutSchema, body);
      result = capture ? await service.capture(quoteId, orderId!, approvedRevision) : await service.createOrder(quoteId, approvedRevision);
    } else {
      const { expectedRevision } = parse(revisionSchema, body);
      result = await service[action as 'draft' | 'estimate' | 'approve'](quoteId, expectedRevision);
    }
    return json(result, !quoteId && method === 'POST' ? 201 : 200);
  } finally { await store.close(); }
}

export default {
  async fetch(request: Request, env: HostedEnvironment): Promise<Response> {
    const visitor = session(request);
    let response: Response;
    try {
      const path = new URL(request.url).pathname;
      if (path.startsWith('/api/')) response = await handleApi(request, env, await digest(visitor.value));
      else {
        if (!['GET', 'HEAD'].includes(request.method)) throw new AppError('METHOD_NOT_ALLOWED', 'This action is not available.', 405);
        const asset = (assets as Record<string, { type: string; body: string }>)[path] ?? (!path.split('/').pop()?.includes('.') ? assets['/index.html'] : undefined);
        if (!asset) throw new AppError('NOT_FOUND', 'This page could not be found.', 404);
        response = new Response(request.method === 'HEAD' ? null : Buffer.from(asset.body, 'base64'), { headers: { ...responseHeaders, 'Content-Type': asset.type } });
      }
    } catch (error) {
      response = error instanceof AppError
        ? json({ error: { code: error.code, message: error.message } }, error.status)
        : json({ error: { code: 'SERVER_ERROR', message: 'This action could not be completed. Try again.' } }, 500);
    }
    if (visitor.isNew) response.headers.set('Set-Cookie', visitor.cookie);
    return response;
  },
};
