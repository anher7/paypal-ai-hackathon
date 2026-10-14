import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiDraftProvider } from './ai.js';

const environment = { ASTRO_GATEWAY_URL: 'https://gateway.example.test', ASTRO_GATEWAY_API_KEY: 'dummy-private-key' };
const draft = {
  included: ['An inquiry form.'], excluded: ['Live calendar.'], needs: ['Destination email.'],
  questions: [{ sourcePhrase: 'booking form', prompt: 'Inquiry form or live calendar?' }],
};
const estimate = {
  tasks: [{ name: 'Build and test the form', withoutAgent: { minMinutes: 61, maxMinutes: 120 }, withAgent: { minMinutes: 90, maxMinutes: 150 }, agentHelp: 'Suggest code and checks.', humanWork: 'Review and test delivery.' }],
  assumptions: ['No live calendar; customer provides copy.'],
};
function completion(value: unknown, finishReason = 'stop') {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(value) } }] }), { status: 200 });
}
afterEach(() => vi.restoreAllMocks());

describe('private AI gateway drafting', () => {
  it('sends one authenticated request and creates unanswered server question IDs', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(completion(draft));
    const provider = createAiDraftProvider(environment, { fetch: request });
    const result = await provider.draft('Please build a booking form.');
    expect(result?.source).toBe('ai');
    expect(result?.questions[0]).toMatchObject({ resolution: 'unanswered', response: '', sourcePhrase: 'booking form' });
    expect(result?.questions[0].id).not.toBe('booking-form');
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://gateway.example.test/v1/chat/completions');
    expect(options?.redirect).toBe('error');
    expect(options?.headers).toMatchObject({ Authorization: 'Bearer dummy-private-key' });
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe('claude-haiku-4-5');
    expect(body.stream).toBe(false);
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('response_format');
  });
  it('does not duplicate /v1 in a configured base URL', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(completion(draft));
    await createAiDraftProvider({ ...environment, ASTRO_GATEWAY_URL: 'https://gateway.example.test/v1/' }, { fetch: request }).draft('booking form');
    expect(request.mock.calls[0][0]).toBe('https://gateway.example.test/v1/chat/completions');
  });
  it.each([
    { ...draft, price: 450 },
    { ...draft, questions: [{ sourcePhrase: 'nonexistent wording', prompt: 'Which?' }] },
    { ...draft, questions: [{ ...draft.questions[0], resolution: 'answer', response: 'Assumed without consent' }] },
    { ...draft, included: [] },
  ])('rejects malformed or authoritative model output', async (output) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(completion(output));
    await expect(createAiDraftProvider(environment, { fetch: request }).draft('booking form')).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects unreadable JSON, truncated output, and oversized responses', async () => {
    for (const [response, code] of [[new Response('bad json'), 'AI_GATEWAY_INVALID_JSON'], [completion(draft, 'length'), 'AI_RESPONSE_INCOMPLETE'], [new Response('x'.repeat(100001)), 'AI_INVALID_RESPONSE']] as const) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(createAiDraftProvider(environment, { fetch: request }).draft('booking form')).rejects.toMatchObject({ code });
    }
  });
  it.each([[401, 'AI_ACCESS_DENIED'], [403, 'AI_ACCESS_DENIED'], [402, 'AI_CREDITS_NEEDED'], [429, 'AI_BUSY'], [500, 'AI_UNAVAILABLE']])('maps HTTP %s safely without retry', async (status, code) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('provider secret diagnostics', { status: Number(status) }));
    await expect(createAiDraftProvider(environment, { fetch: request }).draft('booking form')).rejects.toMatchObject({ code });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('times out without retries or exposing provider errors', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('secret server diagnostic')));
    }));
    await expect(createAiDraftProvider(environment, { fetch: request, timeoutMilliseconds: 5 }).draft('booking form')).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('disables provider use explicitly even with credentials present', async () => {
    const request = vi.fn<typeof fetch>();
    const provider = createAiDraftProvider({ ...environment, AGREE_FIRST_AI_MODE: 'examples' }, { fetch: request });
    expect(provider.mode).toBe('examples');
    expect(await provider.draft('Any new request')).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects insecure gateway settings and expired runtime credentials before a request', async () => {
    const request = vi.fn<typeof fetch>();
    const insecure = createAiDraftProvider({ ...environment, ASTRO_GATEWAY_URL: 'http://gateway.example.test' }, { fetch: request });
    expect(insecure.configured).toBe(false);
    await expect(insecure.draft('booking form')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    const expired = createAiDraftProvider({ ...environment, ASTRO_GATEWAY_EXPIRES_AT: '2000-01-01T00:00:00.000Z' }, { fetch: request });
    await expect(expired.draft('booking form')).rejects.toMatchObject({ code: 'AI_SETUP_EXPIRED' });
    expect(request).not.toHaveBeenCalled();
  });
  it('estimates the saved work without setting prices or forcing agent savings', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(completion(estimate));
    const provider = createAiDraftProvider(environment, { fetch: request });
    const result = await provider.estimate!({ request: 'booking form', included: ['Inquiry only'], excluded: ['Calendar'], needs: ['Email'], questions: [] });
    expect(result).toMatchObject({ ...estimate, source: 'ai', model: 'claude-haiku-4-5' });
    expect(result?.tasks[0].withAgent.minMinutes).toBeGreaterThan(result!.tasks[0].withoutAgent.minMinutes);
    const body = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(JSON.parse(body.messages[1].content)).toEqual({ request: 'booking form', included: ['Inquiry only'], excluded: ['Calendar'], needs: ['Email'], questions: [] });
  });
  it('uses live effort estimates for edited example work rather than its static fixture', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(completion(estimate));
    const result = await createAiDraftProvider(environment, { fetch: request }).estimate!({
      request: 'Build a five-page website with a booking form.', included: ['Live booking calendar and payments'],
      excluded: [], needs: [], questions: [],
    });
    expect(result?.source).toBe('ai');
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(JSON.parse(String(request.mock.calls[0][1]?.body)).messages[1].content).included).toEqual(['Live booking calendar and payments']);
  });
  it('rejects model price suggestions and reversed effort ranges', async () => {
    for (const output of [{ ...estimate, price: 100 }, { ...estimate, tasks: [{ ...estimate.tasks[0], withoutAgent: { minMinutes: 120, maxMinutes: 20 } }] }]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(completion(output));
      await expect(createAiDraftProvider(environment, { fetch: request }).estimate!({ request: 'Form', included: ['Form'], excluded: [], needs: [], questions: [] })).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    }
  });
});

describe('gateway and model JSON response stages', () => {
  function textCompletion(content: string) {
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  }
  it.each(['json', ''])('accepts a single %s JSON fence with no surrounding text', async (language) => {
    const response = textCompletion(`\n\`\`\`${language}\n${JSON.stringify(draft)}\n\`\`\`\n`);
    const request = vi.fn<typeof fetch>().mockResolvedValue(response);
    expect((await createAiDraftProvider(environment, { fetch: request }).draft('booking form'))?.included).toEqual(draft.included);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    'Model refused to return JSON.',
    '{"included": ["Incomplete"',
    'Here is the draft:\n```json\n{}\n```',
    '```json\n{}\n```\nAdditional explanation.',
    '```json\n{}\n```\n```json\n{}\n```',
  ])('rejects partial output or text outside JSON without exposing it', async (content) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(textCompletion(content));
    const result = createAiDraftProvider(environment, { fetch: request }).draft('booking form');
    await expect(result).rejects.toMatchObject({ code: 'AI_MODEL_INVALID_JSON', message: 'The AI draft was not readable JSON. Your saved work is unchanged.' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('still validates fenced JSON against the strict scope schema', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(textCompletion('```json\n{"included":["A form"],"excluded":[],"needs":[],"questions":[],"price":450}\n```'));
    await expect(createAiDraftProvider(environment, { fetch: request }).draft('booking form')).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  });
  it('distinguishes unexpected gateway envelopes and explicit streaming responses', async () => {
    for (const [response, code] of [
      [new Response(JSON.stringify({ content: 'not a chat completion' })), 'AI_GATEWAY_INVALID_RESPONSE'],
      [new Response('data: provider response\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), 'AI_GATEWAY_STREAMED_RESPONSE'],
    ] as const) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(createAiDraftProvider(environment, { fetch: request }).draft('booking form')).rejects.toMatchObject({ code });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
});