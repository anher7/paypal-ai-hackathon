import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const target = process.argv[2];
const output = process.argv[3];
if (!target || !output) throw new Error('Usage: node scripts/evaluate-hosted.mjs https://your-demo.example /absolute/output.json');
const origin = new URL(target);
if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Use HTTPS or a loopback test server.');
const allCases = JSON.parse(await readFile(new URL('../evals/scope-cases.json', import.meta.url), 'utf8'));
const selected = process.argv[4]?.split(',');
const cases = selected ? allCases.filter(item => selected.includes(item.id)) : allCases;
if (!cases.length || selected?.some(id => !allCases.some(item => item.id === id))) throw new Error('Choose known case IDs from evals/scope-cases.json.');
let cookie = '';
async function request(path, method = 'GET', body) {
  const response = await fetch(new URL(path, origin), {
    method, redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const session = response.headers.getSetCookie().find(value => value.startsWith('__Host-agree-first='));
  if (session) cookie = session.split(';')[0];
  const result = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error?.code ?? 'UNEXPECTED_RESPONSE'}`);
  return result;
}
const config = await request('/api/config');
assert.equal(config.aiConfigured, true, 'This evaluation requires a configured live model.');
const report = { target: origin.origin, startedAt: new Date().toISOString(), model: config.aiModel, type: 'Developer-run synthetic cases, one model response each; not user research or proof of reduced disputes.', cases: [] };
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
for (const [index, example] of cases.entries()) {
  // Keep a single live call in each UTC minute, within the public demo limits.
  if (index) await new Promise(resolve => setTimeout(resolve, 61000 - Date.now() % 60000));
  let quote = await request('/api/quotes', 'POST', { title: `Evaluation: ${example.id}`, customerName: 'Synthetic test customer', request: example.request });
  quote = await request(`/api/quotes/${quote.id}/draft`, 'POST', { expectedRevision: quote.revision });
  const grounded = quote.questions.every(question => example.request.toLowerCase().includes(question.sourcePhrase.toLowerCase()));
  const humanControlPreserved = quote.status === 'draft' && quote.approved === null && quote.priceCents === null && quote.questions.every(question => question.resolution === 'unanswered' && question.response === '');
  assert.equal(quote.draftSource, 'ai');
  const result = { ...example, quoteId: quote.id, source: quote.draftSource, grounded, humanControlPreserved, included: quote.included, excluded: quote.excluded, needs: quote.needs, questions: quote.questions.map(({ sourcePhrase, prompt }) => ({ sourcePhrase, prompt })), contentReview: null };
  report.cases.push(result);
  report.completedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ case: example.id, questions: result.questions.length, grounded, humanControlPreserved }));
}
