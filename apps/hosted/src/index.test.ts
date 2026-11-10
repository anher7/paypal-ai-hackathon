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
async function visitor(env: HostedEnvironment) {
  const page = await worker.fetch(request('/'), env);
  const setCookie = page.headers.get('set-cookie')!;
  const headers = { cookie: setCookie.split(';')[0] };
  return {
    setCookie,
    fetch: (path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) =>
      worker.fetch(request(path, method, body, { ...headers, ...extra }), env),
  };
}
const input = { title: 'Booking form', customerName: 'Customer', request: examples[0].request };
async function create(client: Awaited<ReturnType<typeof visitor>>) {
  const response = await client.fetch('/api/quotes', 'POST', input);
  expect(response.status).toBe(201);
  return response.json() as Promise<Quote>;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
