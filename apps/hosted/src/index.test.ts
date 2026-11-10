import { afterEach, describe, expect, it, vi } from 'vitest';
import { examples } from '../../api/src/drafting.js';
import type { Quote } from '@agree-first/shared';
import worker, { type HostedEnvironment } from './index.js';
import { database } from './test-database.js';

function environment(extra: Partial<HostedEnvironment> = {}): HostedEnvironment {
  return { DB: database().db, ...extra };
}
const origin = 'https://agree-first.example';
function request(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}${path}`, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function visitor(env: HostedEnvironment, ip = '203.0.113.10') {
  const page = await worker.fetch(request('/'), env);
  const setCookie = page.headers.get('set-cookie')!;
  const headers = { cookie: setCookie.split(';')[0], 'cf-connecting-ip': ip };
  return {
    setCookie,
    fetch: (path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) =>
      worker.fetch(request(path, method, body, { ...headers, ...extra }), env),
  };
}
const input = { title: 'Booking form', customerName: 'Customer', request: examples[0].request };
async function create(client: Awaited<ReturnType<typeof visitor>>, changes: Partial<typeof input> = {}) {
  const response = await client.fetch('/api/quotes', 'POST', { ...input, ...changes });
  expect(response.status).toBe(201);
  return response.json() as Promise<Quote>;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('hosted API request boundaries', () => {
  it('keeps the guest cookie across requests and hides other visitors quotes', async () => {
    const env = environment();
    const owner = await visitor(env);
    expect(owner.setCookie).toContain('HttpOnly; Secure; SameSite=Lax');
    expect(owner.setCookie).toMatch(/^__Host-agree-first=[a-f0-9]{64}; Path=\//);
    const quote = await create(owner);
    const ownList = await owner.fetch('/api/quotes');
    expect(ownList.headers.get('set-cookie')).toBeNull();
    expect((await ownList.json() as Quote[]).map((value) => value.id)).toEqual([quote.id]);
    const stranger = await visitor(env);
    expect(await (await stranger.fetch('/api/quotes')).json()).toEqual([]);
    expect((await stranger.fetch(`/api/quotes/${quote.id}`)).status).toBe(404);
    expect((await stranger.fetch(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: 1 })).status).toBe(404);
    expect((await stranger.fetch(`/api/quotes/${quote.id}`)).headers.get('cache-control')).toBe('no-store');
  });

  it('rejects cross-site writes and unsupported methods', async () => {
    const owner = await visitor(environment());
    expect((await owner.fetch('/api/quotes', 'POST', input, { origin: 'https://attacker.example' })).status).toBe(403);
    expect((await owner.fetch('/api/quotes', 'POST', input, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await owner.fetch('/api/quotes', 'DELETE')).status).toBe(405);
    expect(await (await owner.fetch('/api/quotes')).json()).toEqual([]);
  });

  it('rejects malformed routes and dangling captures without modifying the quote', async () => {
    const owner = await visitor(environment());
    const quote = await create(owner);
    for (const action of ['draft', 'estimate', 'approve']) {
      expect((await owner.fetch(`/api/quotes/${quote.id}/${action}/ORDER/capture`, 'POST', { expectedRevision: 1 })).status).toBe(404);
    }
    expect((await owner.fetch(`/api/quotes/${quote.id}/checkout-recovery/ORDER/capture`)).status).toBe(404);
    expect((await owner.fetch('/api/quotes/not-a-uuid')).status).toBe(404);
    expect((await owner.fetch(`/api/quotes/${quote.id}/unknown`, 'POST', {})).status).toBe(404);
    expect((await (await owner.fetch(`/api/quotes/${quote.id}`)).json() as Quote).revision).toBe(1);
  });

  it('persists sample drafting, approval and reapproval across fresh request stores', async () => {
    const owner = await visitor(environment());
    const quote = await create(owner);
    const drafted = await (await owner.fetch(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: 1 })).json() as Quote;
    expect(drafted.draftSource).toBe('example');
    const edit = {
      title: drafted.title, customerName: drafted.customerName, request: drafted.request,
      included: drafted.included, excluded: drafted.excluded, needs: drafted.needs,
      questions: drafted.questions.map((question) => ({ ...question, resolution: 'answer', response: 'Inquiry form' })),
      price: '1.00', expectedRevision: drafted.revision,
    };
    const edited = await (await owner.fetch(`/api/quotes/${quote.id}`, 'PUT', edit)).json() as Quote;
    const approved = await (await owner.fetch(`/api/quotes/${quote.id}/approve`, 'POST', { expectedRevision: edited.revision })).json() as Quote;
    expect(approved.status).toBe('ready');
    expect(approved.approved?.priceCents).toBe(100);
    const reloaded = await (await owner.fetch(`/api/quotes/${quote.id}`)).json() as Quote;
    expect(reloaded.approved).toEqual(approved.approved);
    const changed = await (await owner.fetch(`/api/quotes/${quote.id}`, 'PUT', { ...edit, price: '2.00', expectedRevision: reloaded.revision })).json() as Quote;
    expect(changed.status).toBe('draft');
    expect(changed.approved).toBeNull();
    const stale = await owner.fetch(`/api/quotes/${quote.id}/approve`, 'POST', { expectedRevision: reloaded.revision });
    expect(stale.status).toBe(409);
    const reapproved = await (await owner.fetch(`/api/quotes/${quote.id}/approve`, 'POST', { expectedRevision: changed.revision })).json() as Quote;
    expect(reapproved.approved?.priceCents).toBe(200);
    expect(reapproved.approved?.revision).toBe(changed.revision);
  });

  it('meters live sample estimates and persists quota on invalid upstream responses', async () => {
    const env = environment({ ASTRO_GATEWAY_URL: 'https://gateway.example', ASTRO_GATEWAY_API_KEY: 'test-key', HOSTED_AI_DAILY_LIMIT: '1' });
    const completion = vi.fn(async () => Response.json({ invalid: 'upstream envelope' }));
    vi.stubGlobal('fetch', completion);
    const owner = await visitor(env);
    const quote = await create(owner);
    const draft = await owner.fetch(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: 1 });
    expect(draft.status).toBe(200);
    expect(completion).not.toHaveBeenCalled();
    const estimated = await owner.fetch(`/api/quotes/${quote.id}/estimate`, 'POST', { expectedRevision: 2 });
    expect(estimated.status).toBe(502);
    const repeated = await owner.fetch(`/api/quotes/${quote.id}/estimate`, 'POST', { expectedRevision: 2 });
    expect(repeated.status).toBe(429);
    expect(await repeated.json()).toMatchObject({ error: { code: 'DEMO_LIMIT' } });
    expect(completion).toHaveBeenCalledTimes(1);
    expect((await (await owner.fetch(`/api/quotes/${quote.id}`)).json() as Quote).revision).toBe(2);
  });

  it('rejects oversized bodies with and without a Content-Length header and rejects malformed JSON', async () => {
    const env = environment();
    const owner = await visitor(env);
    expect((await owner.fetch('/api/quotes', 'POST', { ...input, request: 'x'.repeat(70_000) })).status).toBe(413);
    const cookie = owner.setCookie.split(';')[0];
    const advertised = new Request(`${origin}/api/quotes`, { method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'content-length': '70000' }, body: '{}' });
    expect((await worker.fetch(advertised, env)).status).toBe(413);
    const malformed = new Request(`${origin}/api/quotes`, { method: 'POST',
      headers: { cookie, 'content-type': 'application/json' }, body: '{' });
    expect((await worker.fetch(malformed, env)).status).toBe(400);
    expect((await owner.fetch('/api/quotes', 'POST', input, { 'content-type': 'text/plain' })).status).toBe(415);
    expect(await (await owner.fetch('/api/quotes')).json()).toEqual([]);
  });
});


const liveEnvironment = { ASTRO_GATEWAY_URL: 'https://gateway.example', ASTRO_GATEWAY_API_KEY: 'test-key' };
function invalidCompletion() {
  const upstream = vi.fn(async () => Response.json({ invalid: 'upstream envelope' }));
  vi.stubGlobal('fetch', upstream);
  return upstream;
}
async function customQuote(client: Awaited<ReturnType<typeof visitor>>) {
  return create(client, { request: 'Build a custom booking form for my studio.' });
}

describe('public demo AI abuse limits', () => {
  it('enforces the default burst across concurrent requests with reset cookies', async () => {
    const env = environment(liveEnvironment);
    const upstream = invalidCompletion();
    const clients = await Promise.all([visitor(env), visitor(env), visitor(env)]);
    const quotes = await Promise.all(clients.map(customQuote));
    const responses = await Promise.all(clients.map((client, index) =>
      client.fetch(`/api/quotes/${quotes[index].id}/draft`, 'POST', { expectedRevision: 1 })));
    expect(responses.map((response) => response.status).sort()).toEqual([429, 502, 502]);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('keeps the per-IP daily limit after cookie resets and burst windows change', async () => {
    const env = environment({ ...liveEnvironment, HOSTED_AI_IP_DAILY_LIMIT: '2' });
    const upstream = invalidCompletion();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const statuses = [];
    for (let index = 0; index < 3; index += 1) {
      clock.mockReturnValue(1_800_000_000_000 + index * 60_001);
      const client = await visitor(env);
      const quote = await customQuote(client);
      statuses.push((await client.fetch(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: 1 })).status);
    }
    expect(statuses).toEqual([502, 502, 429]);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('reserves the lifetime budget atomically across concurrent clients with different IPs', async () => {
    const env = environment({ ...liveEnvironment, HOSTED_AI_TOTAL_LIMIT: '2' });
    const upstream = invalidCompletion();
    const clients = await Promise.all(Array.from({ length: 6 }, (_, index) => visitor(env, `203.0.113.${index + 20}`)));
    const quotes = await Promise.all(clients.map(customQuote));
    const responses = await Promise.all(clients.map((client, index) =>
      client.fetch(`/api/quotes/${quotes[index].id}/draft`, 'POST', { expectedRevision: 1 })));
    expect(responses.filter((response) => response.status === 502)).toHaveLength(2);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(4);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare('SELECT count FROM hosted_limits WHERE id = ?').bind('ai-total:v1').first()).toEqual({ count: 2 });
  });

  it('preserves the lifetime budget across UTC days, new IPs and expired-quota cleanup', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'));
    const env = environment({ ...liveEnvironment, HOSTED_AI_TOTAL_LIMIT: '2' });
    const upstream = invalidCompletion();
    const statuses = [];
    for (let index = 0; index < 3; index += 1) {
      vi.setSystemTime(new Date(`2026-11-${10 + index * 3}T12:00:00Z`));
      const client = await visitor(env, `198.51.100.${index + 10}`);
      const quote = await customQuote(client);
      statuses.push((await client.fetch(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: 1 })).status);
    }
    expect(statuses).toEqual([502, 502, 429]);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(await env.DB.prepare('SELECT count, expires_at FROM hosted_limits WHERE id = ?').bind('ai-total:v1').first())
      .toEqual({ count: 2, expires_at: Number.MAX_SAFE_INTEGER });
  });

  it('does not charge the AI budget for invalid revisions, inputs or foreign/nonexistent quotes', async () => {
    const env = environment({ ...liveEnvironment, HOSTED_AI_TOTAL_LIMIT: '1' });
    const upstream = invalidCompletion();
    const owner = await visitor(env);
    const quote = await customQuote(owner);
    expect((await owner.fetch(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: 999 })).status).toBe(409);
    expect((await owner.fetch(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: 'invalid' })).status).toBe(400);
    expect((await owner.fetch('/api/quotes/00000000-0000-0000-0000-000000000000/draft', 'POST', { expectedRevision: 1 })).status).toBe(404);
    const stranger = await visitor(env);
    expect((await stranger.fetch(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: 1 })).status).toBe(404);
    expect((await env.DB.prepare("SELECT id FROM hosted_limits WHERE id LIKE 'ai-%'").all()).results).toEqual([]);
    expect(upstream).not.toHaveBeenCalled();
    expect((await owner.fetch(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: 1 })).status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('keeps static drafting and checkout recovery accessible after the live AI budget is spent', async () => {
    const env = environment({ ...liveEnvironment, HOSTED_AI_TOTAL_LIMIT: '1' });
    const upstream = invalidCompletion();
    const owner = await visitor(env);
    const quote = await customQuote(owner);
    expect((await owner.fetch(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: 1 })).status).toBe(502);
    const exhausted = await owner.fetch(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: 1 });
    expect(exhausted.status).toBe(429);
    expect(await exhausted.json()).toEqual({ error: { code: 'DEMO_LIMIT',
      message: 'The demo’s total AI allowance has been reached. You can still use the sample draft and edit quotes by hand.' } });
    const sample = await create(owner);
    const drafted = await owner.fetch(`/api/quotes/${sample.id}/draft`, 'POST', { expectedRevision: 1 });
    expect(drafted.status).toBe(200);
    expect(await drafted.json()).toMatchObject({ draftSource: 'example' });
    const recovery = await owner.fetch(`/api/quotes/${quote.id}/checkout-recovery`);
    expect(recovery.status).toBe(200);
    expect(await recovery.json()).toBeNull();
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each([['999999', 500], ['Infinity', 200], ['0', 1], ['not-a-number', 200], ['2.9', 2]] as const)
    ('clamps total-budget configuration %s to %s calls', async (configuration, maximum) => {
      const env = environment({ ...liveEnvironment, HOSTED_AI_TOTAL_LIMIT: configuration });
      await env.DB.prepare('INSERT INTO hosted_limits (id, count, expires_at) VALUES (?, ?, ?)')
        .bind('ai-total:v1', maximum, Number.MAX_SAFE_INTEGER).run();
      const upstream = invalidCompletion();
      const owner = await visitor(env);
      const quote = await customQuote(owner);
      expect((await owner.fetch(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: 1 })).status).toBe(429);
      expect(upstream).not.toHaveBeenCalled();
    });
});
