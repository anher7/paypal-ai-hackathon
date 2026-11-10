import { expect, test } from '@playwright/test';
import { calculateWorkEstimateTotals, parseEuroPrice, type Quote, type WorkEstimate } from '@agree-first/shared';

test('live drafting estimates edited work and copies only the chosen current suggestion', async ({ page }) => {
  let quote: Quote = {
    id: 'live-ai-work-estimate', title: 'A dummy menu', customerName: 'Dummy cafe',
    request: 'Create a print menu with seasonal specials.', included: [], excluded: [], needs: [], questions: [],
    priceCents: 45000, hourlyRateCents: null, workEstimate: null, currency: 'EUR', revision: 1, status: 'draft',
    draftSource: 'manual', approved: null, payment: null, createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:00:00Z',
  };
  const estimate: WorkEstimate = { source: 'ai', model: 'controlled-test-model', generatedAt: '2026-10-14T10:00:00Z', stale: false,
    tasks: [{ name: 'Layout and print checks', withoutAgent: { minMinutes: 180, maxMinutes: 300 }, withAgent: { minMinutes: 120, maxMinutes: 360 }, agentHelp: 'Suggest layouts.', humanWork: 'Review type, proofread and test printing.' }],
    assumptions: ['Customer provides final prices and text.'], totals: { withoutAgent: { minMinutes: 180, maxMinutes: 300, minPriceCents: null, maxPriceCents: null }, withAgent: { minMinutes: 120, maxMinutes: 360, minPriceCents: null, maxPriceCents: null } },
  };
  const events: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/config', (route) => route.fulfill({ json: { currency: 'EUR', paypalConfigured: false, paypalClientId: null, aiMode: 'live', aiConfigured: true, aiModel: 'controlled-test-model', localOnly: true } }));
  await page.route('**/api/quotes/live-ai-work-estimate', (route) => {
    if (route.request().method() === 'PUT') {
      events.push('save');
      const { expectedRevision, price, hourlyRate, ...content } = route.request().postDataJSON();
      const workChanged = JSON.stringify([content.request, content.included, content.excluded, content.needs, content.questions]) !== JSON.stringify([quote.request, quote.included, quote.excluded, quote.needs, quote.questions]);
      quote = { ...quote, ...content, revision: expectedRevision + 1, priceCents: parseEuroPrice(price), hourlyRateCents: parseEuroPrice(hourlyRate) };
      if (quote.workEstimate) { quote.workEstimate = { ...quote.workEstimate, stale: quote.workEstimate.stale || workChanged, totals: calculateWorkEstimateTotals(quote.workEstimate.tasks, quote.hourlyRateCents ?? null) }; }
    }
    return route.fulfill({ json: quote });
  });
  await page.route('**/api/quotes/live-ai-work-estimate/draft', (route) => {
    events.push('draft');
    quote = { ...quote, revision: quote.revision + 1, draftSource: 'ai', included: ['One two-sided print menu.'], excluded: ['Printing costs.'], needs: ['Final menu text.'], questions: [{ id: 'seasonal', sourcePhrase: 'seasonal specials', prompt: 'One version or recurring updates?', resolution: 'unanswered', response: '' }] };
    return route.fulfill({ json: quote });
  });
  await page.route('**/api/quotes/live-ai-work-estimate/estimate', (route) => {
    events.push('estimate');
    expect(route.request().postDataJSON()).toEqual({ expectedRevision: quote.revision });
    quote = { ...quote, revision: quote.revision + 1, workEstimate: { ...estimate, totals: calculateWorkEstimateTotals(estimate.tasks, quote.hourlyRateCents ?? null) } };
    return route.fulfill({ json: quote });
  });
  await page.route('**/api/quotes/live-ai-work-estimate/approve', (route) => { events.push('approve'); return route.fulfill({ json: quote }); });
  await page.goto('/quotes/live-ai-work-estimate');
  await page.getByRole('button', { name: 'Generate AI draft' }).click();
  await expect(page.getByText('AI draft · review every word')).toBeVisible();
  await expect(page.getByLabel('Total price in EUR')).toHaveValue('450.00');
  await page.getByLabel('How is it settled?').selectOption('answer');
  await page.getByLabel('Answer or proposed assumption').fill('One version only.');
  await page.getByLabel('Included work').fill('One two-sided print menu and print-ready PDF.');
  await page.getByLabel('Hourly rate in EUR').fill('50.00');
  await page.getByRole('button', { name: 'Estimate work', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compare delivery options' })).toBeVisible();
  await expect(page.getByText('€150.00–€250.00', { exact: true })).toBeVisible();
  await expect(page.getByText('€100.00–€300.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Review type, proofread and test printing.')).toBeVisible();
  await expect(page.getByLabel('Answer or proposed assumption')).toHaveValue('One version only.');
  await expect(page.getByLabel('Total price in EUR')).toHaveValue('450.00');
  const highAgent = page.getByRole('button', { name: 'Use high suggestion with an ai agent', exact: true });
  await highAgent.click();
  await expect(page.getByLabel('Total price in EUR')).toHaveValue('300.00');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.getByLabel('Included work').fill('One menu plus a second language version.');
  await expect(page.getByText('The work changed. Estimate again before using a suggested price.')).toBeVisible();
  await expect(highAgent).toBeDisabled();
  await page.getByRole('button', { name: 'Estimate work', exact: true }).click();
  await expect(highAgent).toBeEnabled();
  await page.getByLabel('Hourly rate in EUR').fill('');
  await expect(page.getByText('Add an hourly rate to see suggested prices.')).toBeVisible();
  await page.getByRole('button', { name: 'Save quote', exact: true }).click();
  await expect(page.getByText('Quote saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Hourly rate in EUR')).toHaveValue('');
  await expect(page.getByLabel('Total price in EUR')).toHaveValue('300.00');
  await expect(page.getByText('Add an hourly rate to see suggested prices.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(events).toEqual(['draft', 'save', 'estimate', 'save', 'estimate', 'save']);
  expect(errors).toEqual([]);
});
