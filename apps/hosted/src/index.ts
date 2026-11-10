import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { currency, quoteCreateSchema, quoteUpdateSchema, revisionSchema, checkoutSchema, type AppConfig } from '@agree-first/shared';
import { createQuoteService } from '../../api/src/service.js';
import { createAiDraftProvider } from '../../api/src/ai.js';
import { createPaypalProvider } from '../../api/src/paypal.js';
import { examples } from '../../api/src/drafting.js';
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
async function consume(db: HostedDatabase, key: string, maximum: number, expiresAt: number) {
  const result = await db.prepare(`INSERT INTO hosted_limits (id, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count`).bind(key, expiresAt, maximum).first();
  if (!result) throw new AppError('DEMO_LIMIT', 'This demo has reached its usage limit. Please try again later.', 429);
}
function safeEnvironment(env: HostedEnvironment): NodeJS.ProcessEnv {
  const keys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID', 'ASTRO_GATEWAY_URL', 'ASTRO_GATEWAY_API_KEY', 'ASTRO_GATEWAY_EXPIRES_AT', 'MODEL_DEFAULT'];
  return Object.fromEntries(keys.map((key) => [key, typeof env[key] === 'string' ? env[key] as string : undefined]));
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
    const config: AppConfig = { currency, localOnly: false, aiMode: drafting.mode ?? 'examples', aiConfigured: drafting.configured ?? false, aiModel: drafting.model ?? null, paypalConfigured: payments.configured, paypalClientId: payments.clientId };
    return json(config);
  }
  if (path === '/api/examples' && method === 'GET') return json(examples);
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
    const provider = {
      ...drafting,
      draft: async (requestText: string) => {
        await checkpoint();
        const isExample = examples.some((example) => example.request.trim() === requestText.trim());
        if (!isExample && drafting.configured) {
          await consume(env.DB, `ai-workspace:${workspaceId}:${day}`, 8, expiresAt);
          await consume(env.DB, `ai-global:${day}`, Math.min(100, Math.max(1, Number(env.HOSTED_AI_DAILY_LIMIT) || 40)), expiresAt);
        }
        return drafting.draft(requestText);
      },
      estimate: async (context: Parameters<NonNullable<typeof drafting.estimate>>[0]) => {
        await checkpoint();
        if (drafting.configured) {
          await consume(env.DB, `ai-workspace:${workspaceId}:${day}`, 8, expiresAt);
          await consume(env.DB, `ai-global:${day}`, Math.min(100, Math.max(1, Number(env.HOSTED_AI_DAILY_LIMIT) || 40)), expiresAt);
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
