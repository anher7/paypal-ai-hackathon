import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readGatewayEnvironment, createWorkspaceAiDraftProvider } from './ai-configuration.js';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, readFileSync: vi.fn(original.readFileSync) };
});

const fixtures: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  fixtures.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});
function fixture(contents?: string) {
  const root = mkdtempSync(join(tmpdir(), 'agree-first-gateway-'));
  fixtures.push(root);
  if (contents !== undefined) {
    mkdirSync(join(root, '.tools/astropods'), { recursive: true });
    writeFileSync(join(root, '.tools/astropods/gateway-runtime.json'), contents);
  }
  return root;
}
const runtime = { baseUrl: 'https://gateway.example.test', apiKey: 'dummy-only', expiresAt: '2099-01-01T00:00:00.000Z', model: 'claude-haiku-4-5' };
describe('private gateway runtime configuration', () => {
  it('loads a dummy runtime internally without modifying process credentials', () => {
    const environment = { MODEL_DEFAULT: 'custom-model' };
    const result = readGatewayEnvironment(fixture(JSON.stringify(runtime)), environment);
    expect(result).toMatchObject({ ASTRO_GATEWAY_URL: runtime.baseUrl, ASTRO_GATEWAY_API_KEY: 'dummy-only', ASTRO_GATEWAY_EXPIRES_AT: runtime.expiresAt, MODEL_DEFAULT: 'custom-model' });
    expect(environment).toEqual({ MODEL_DEFAULT: 'custom-model' });
  });
  it('preserves explicit settings and explicit example mode', () => {
    for (const environment of [{ ASTRO_GATEWAY_URL: 'https://explicit.example.test' }, { AGREE_FIRST_AI_MODE: 'examples' }]) {
      expect(readGatewayEnvironment(fixture('unreadable'), environment)).toBe(environment);
    }
  });
  it('handles absent, malformed, and oversized private runtime files safely', () => {
    expect(readGatewayEnvironment(fixture(), {})).toEqual({});
    for (const contents of ['bad json', '{}', 'x'.repeat(16001)]) {
      expect(readGatewayEnvironment(fixture(contents), {})).toEqual({ ASTRO_GATEWAY_URL: 'invalid' });
    }
  });
});

describe('reconnecting the workspace AI provider', () => {
  it('detects settings written after construction and uses refreshed model credentials on the next request', async () => {
    const root = fixture();
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{
      finish_reason: 'stop', message: { content: JSON.stringify({ included: ['A logo.'], excluded: [], needs: [], questions: [] }) },
    }] })));
    const provider = createWorkspaceAiDraftProvider(root, {}, { fetch: request });
    expect(provider.mode).toBe('examples');
    expect(provider.configured).toBe(false);
    expect(provider.model).toBeNull();
    expect(await provider.draft('Create a logo.')).toBeNull();
    mkdirSync(join(root, '.tools/astropods'), { recursive: true });
    writeFileSync(join(root, '.tools/astropods/gateway-runtime.json'), JSON.stringify({ ...runtime, model: 'new-dummy-model', apiKey: 'new-dummy-key' }));
    expect(provider.mode).toBe('live');
    expect(provider.configured).toBe(true);
    expect(provider.model).toBe('new-dummy-model');
    expect((await provider.draft('Create a logo.'))?.source).toBe('ai');
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).model).toBe('new-dummy-model');
    expect(request.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer new-dummy-key' });
  });
  it('rechecks expiry and prevents a request after a runtime expires', async () => {
    const root = fixture(JSON.stringify(runtime));
    const request = vi.fn<typeof fetch>();
    const provider = createWorkspaceAiDraftProvider(root, {}, { fetch: request });
    expect(provider.configured).toBe(true);
    writeFileSync(join(root, '.tools/astropods/gateway-runtime.json'), JSON.stringify({ ...runtime, expiresAt: '2000-01-01T00:00:00.000Z' }));
    expect(provider.configured).toBe(false);
    await expect(provider.draft('Create a logo.')).rejects.toMatchObject({ code: 'AI_SETUP_EXPIRED' });
    expect(request).not.toHaveBeenCalled();
  });
  it('skips private file access and all provider requests in explicit example mode', async () => {
    const root = fixture(JSON.stringify(runtime));
    const read = vi.mocked(readFileSync);
    read.mockClear();
    const request = vi.fn<typeof fetch>();
    const provider = createWorkspaceAiDraftProvider(root, { AGREE_FIRST_AI_MODE: 'examples' }, { fetch: request });
    expect(provider.mode).toBe('examples');
    expect(provider.configured).toBe(false);
    expect(provider.model).toBeNull();
    expect(await provider.draft('Create a logo.')).toBeNull();
    expect(await provider.estimate!({ request: 'Create a logo.', included: ['A logo'], excluded: [], needs: [], questions: [] })).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});