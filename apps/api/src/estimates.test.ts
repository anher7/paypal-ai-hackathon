import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  calculateWorkEstimateTotals, quoteUpdateSchema, type DraftProvider,
  type Quote, type QuoteUpdate, type WorkEstimateTask,
} from '@agree-first/shared';
import { createStore, type QuoteStore } from './store.js';
import { createQuoteService } from './service.js';
import { createPaypalProvider } from './paypal.js';
import { exampleDraftProvider, examples } from './drafting.js';

const stores: QuoteStore[] = [];
const directories: string[] = [];
afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});
const tasks: WorkEstimateTask[] = [{
  name: 'Review and test', withoutAgent: { minMinutes: 1, maxMinutes: 61 }, withAgent: { minMinutes: 2, maxMinutes: 90 },
  agentHelp: 'Suggest test cases.', humanWork: 'Run checks and fix errors.',
}];
function setup(provider: DraftProvider = exampleDraftProvider, path = ':memory:') {
  const store = createStore(path);
  stores.push(store);
  return { store, service: createQuoteService(store, provider, createPaypalProvider({})) };
}
function edit(quote: Quote, changes: Partial<QuoteUpdate> = {}): QuoteUpdate {
  return {
    title: quote.title, customerName: quote.customerName, request: quote.request,
    expectedRevision: quote.revision, included: ['Five pages and an inquiry form'], excluded: [], needs: [],
    questions: [], price: '450', hourlyRate: '50.01', ...changes,
  };
}
async function estimated(fixture: ReturnType<typeof setup>) {
  const quote = fixture.service.create(examples[0]);
  const example = (await exampleDraftProvider.draft(examples[0].request))!;
  const saved = await fixture.service.update(quote.id, edit(quote, { included: example.included, excluded: example.excluded, needs: example.needs, questions: example.questions.map((question) => ({ ...question, resolution: 'answer', response: 'An inquiry form only; no live calendar.' })) }));
  return fixture.service.estimate(saved.id, saved.revision);
}

describe('effort and suggested prices', () => {
  it('uses exact summed integer minutes and rounds up one time per price range', () => {
    const totals = calculateWorkEstimateTotals([...tasks, ...tasks], 5001);
    expect(totals.withoutAgent).toEqual({ minMinutes: 2, maxMinutes: 122, minPriceCents: 167, maxPriceCents: 10169 });
    expect(totals.withAgent).toEqual({ minMinutes: 4, maxMinutes: 180, minPriceCents: 334, maxPriceCents: 15003 });
    expect(calculateWorkEstimateTotals(tasks, null).withoutAgent.minPriceCents).toBeNull();
  });
  it('keeps extreme bounded calculations safe without floating point loss', () => {
    const large = { ...tasks[0], withoutAgent: { minMinutes: 525600, maxMinutes: 525600 } };
    const value = calculateWorkEstimateTotals(Array.from({ length: 30 }, () => large), 999999999).withoutAgent.maxPriceCents;
    expect(value).toBe(262799999737200);
    expect(Number.isSafeInteger(value)).toBe(true);
    expect(() => calculateWorkEstimateTotals([{ ...large, withoutAgent: { minMinutes: 3, maxMinutes: 2 } }], 100)).toThrow();
  });
  it('validates a positive rate and rejects client-generated estimates', () => {
    const fixture = setup();
    const quote = fixture.service.create(examples[0]);
    expect(quoteUpdateSchema.safeParse(edit(quote, { hourlyRate: '0' })).success).toBe(false);
    expect(quoteUpdateSchema.safeParse({ ...edit(quote), workEstimate: {} }).success).toBe(false);
    expect(quoteUpdateSchema.parse({ ...edit(quote), hourlyRate: undefined }).hourlyRate).toBe('');
  });
  it('provides labeled example effort without changing the freelancer total', async () => {
    const fixture = setup();
    const quote = await estimated(fixture);
    expect(quote.workEstimate?.source).toBe('example');
    expect(quote.workEstimate?.stale).toBe(false);
    expect(quote.hourlyRateCents).toBe(5001);
    expect(quote.priceCents).toBe(45000);
    const approved = await fixture.service.approve(quote.id, quote.revision);
    expect(approved.approved?.priceCents).toBe(45000);
  });
  it('passes edited scope and settled answers to the provider while retaining the final price', async () => {
    const estimate = vi.fn(async () => ({ source: 'ai' as const, model: 'dummy-model', tasks, assumptions: ['Review remains human.'] }));
    const fixture = setup({ draft: async () => null, estimate });
    const quote = fixture.service.create({ ...examples[0], request: 'Build a booking form for inquiries.' });
    const saved = await fixture.service.update(quote.id, edit(quote, {
      questions: [{ id: 'question-one', sourcePhrase: 'booking form', prompt: 'Which form?', resolution: 'answer', response: 'Inquiry only.' }],
    }));
    const result = await fixture.service.estimate(saved.id, saved.revision);
    expect(estimate.mock.calls[0][0]).toEqual({ request: saved.request, included: saved.included, excluded: saved.excluded, needs: saved.needs, questions: saved.questions });
    expect(result.priceCents).toBe(45000);
    expect(result.revision).toBe(saved.revision + 1);
  });
  it('recalculates rate-only changes and marks scope or answers stale', async () => {
    const fixture = setup();
    const quote = await estimated(fixture);
    const originalScope = { included: quote.included, excluded: quote.excluded, needs: quote.needs, questions: quote.questions };
    const rerated = await fixture.service.update(quote.id, edit(quote, { ...originalScope, hourlyRate: '100' }));
    expect(rerated.workEstimate?.stale).toBe(false);
    expect(rerated.workEstimate?.totals.withoutAgent.minPriceCents).toBe(180000);
    const changed = await fixture.service.update(quote.id, edit(rerated, { ...originalScope, included: ['Ten pages'], hourlyRate: '100' }));
    expect(changed.workEstimate?.stale).toBe(true);
    await expect(fixture.service.estimate(changed.id, changed.revision)).rejects.toMatchObject({ code: 'AI_NOT_CONNECTED' });
    const restored = await fixture.service.update(changed.id, edit(changed, { ...originalScope }));
    const refreshed = await fixture.service.estimate(restored.id, restored.revision);
    const questionChanged = await fixture.service.update(refreshed.id, edit(refreshed, { included: refreshed.included, questions: [{ id: 'q', sourcePhrase: 'booking form', prompt: 'Which?', resolution: 'assumption', response: 'Inquiry only.' }] }));
    expect(questionChanged.workEstimate?.stale).toBe(true);
    await expect(fixture.service.estimate(questionChanged.id, questionChanged.revision)).rejects.toMatchObject({ code: 'AI_NOT_CONNECTED' });
  });
  it('invalidates earlier approval after a new estimate and keeps approved payment price human-selected', async () => {
    const fixture = setup();
    const quote = await estimated(fixture);
    const approved = await fixture.service.approve(quote.id, quote.revision);
    const updated = await fixture.service.estimate(approved.id, approved.revision);
    expect(updated.approved).toBeNull();
    expect(updated.status).toBe('draft');
    expect(updated.priceCents).toBe(45000);
  });
  it('requires included work and provider setup for arbitrary requests', async () => {
    const fixture = setup();
    const quote = fixture.service.create({ ...examples[0], request: 'Create a new logo.' });
    await expect(fixture.service.estimate(quote.id, quote.revision)).rejects.toMatchObject({ code: 'ESTIMATE_SCOPE_NEEDED' });
    const saved = await fixture.service.update(quote.id, edit(quote));
    await expect(fixture.service.estimate(saved.id, saved.revision)).rejects.toMatchObject({ code: 'AI_NOT_CONNECTED' });
  });
  it('keeps saved scope untouched when provider output is invalid', async () => {
    const fixture = setup({ draft: async () => null, estimate: async () => ({ source: 'ai', model: null, tasks: [], assumptions: [] }) });
    const quote = fixture.service.create(examples[0]);
    const saved = await fixture.service.update(quote.id, edit(quote));
    await expect(fixture.service.estimate(saved.id, saved.revision)).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(fixture.service.get(saved.id)).toEqual(saved);
  });
  it('rejects stale revisions, paid quotes, and uncertain capture attempts before invoking AI', async () => {
    const estimate = vi.fn(async () => ({ source: 'ai' as const, model: 'dummy-model', tasks, assumptions: ['Review remains human.'] }));
    const fixture = setup({ draft: async () => null, estimate });
    const quote = fixture.service.create(examples[0]);
    await expect(fixture.service.estimate(quote.id, quote.revision + 1)).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    fixture.store.saveQuote({ ...quote, status: 'paid' });
    await expect(fixture.service.estimate(quote.id, quote.revision)).rejects.toMatchObject({ code: 'QUOTE_PAID' });
    fixture.store.saveQuote(quote);
    fixture.store.saveAttempt({ id: 'a', quoteId: quote.id, revision: quote.revision, orderId: 'o', merchantId: null, createRequestId: 'c', captureRequestId: 'p', createdAt: quote.createdAt, captureStartedAt: quote.createdAt, state: 'capturing' });
    await expect(fixture.service.estimate(quote.id, quote.revision)).rejects.toMatchObject({ code: 'PAYMENT_UNCERTAIN' });
    expect(estimate).not.toHaveBeenCalled();
  });
  it('persists estimates after restart and normalizes old stored payloads', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agree-first-estimate-'));
    directories.push(directory);
    const path = join(directory, 'quotes.sqlite');
    const fixture = setup(exampleDraftProvider, path);
    const quote = await estimated(fixture);
    const legacy = fixture.service.create({ ...examples[0], title: 'Legacy quote' });
    delete legacy.hourlyRateCents;
    delete legacy.workEstimate;
    fixture.store.saveQuote(legacy);
    fixture.store.close();
    stores.splice(stores.indexOf(fixture.store), 1);
    const restarted = setup(exampleDraftProvider, path);
    expect(restarted.service.get(quote.id).workEstimate).toEqual(quote.workEstimate);
    expect(restarted.service.get(legacy.id)).toMatchObject({ hourlyRateCents: null, workEstimate: null });
  });
});
