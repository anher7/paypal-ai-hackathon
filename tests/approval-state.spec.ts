import { expect, test } from '@playwright/test';
import type { Quote } from '@agree-first/shared';

test('question edits remain live after saving and re-drafting the quote', async ({ page }) => {
  let quote: Quote = {
    id: 'question-binding-regression',
    title: 'A dummy scope', customerName: 'Dummy customer',
    request: 'Build a five-page website with a booking form.',
    included: ['Five website pages.'], excluded: [], needs: [],
    questions: [{ id: 'booking-form', sourcePhrase: 'booking form', prompt: 'An inquiry form or live calendar availability?', resolution: 'unanswered', response: '' }],
    priceCents: 45000, currency: 'EUR', revision: 2, status: 'draft',
    draftSource: 'example', approved: null, payment: null,
    createdAt: '2026-10-13T12:00:00.000Z', updatedAt: '2026-10-13T12:00:00.000Z',
  };
  const savedResponses: string[] = [];
  await page.route('**/api/quotes/question-binding-regression', async (route) => {
    if (route.request().method() === 'PUT') {
      const { expectedRevision, price, ...content } = route.request().postDataJSON();
      savedResponses.push(content.questions[0].response);
      quote = { ...quote, ...content, priceCents: 45000, revision: expectedRevision + 1, status: 'draft', approved: null };
    }
    await route.fulfill({ json: quote });
  });
  await page.route('**/api/quotes/question-binding-regression/draft', async (route) => {
    quote = { ...quote, revision: quote.revision + 1,
      questions: [{ ...quote.questions[0], resolution: 'unanswered', response: '' }] };
    await route.fulfill({ json: quote });
  });
  await page.route('**/api/quotes/question-binding-regression/approve', async (route) => {
    expect(route.request().postDataJSON().expectedRevision).toBe(quote.revision);
    quote = { ...quote, status: 'ready', approved: {
      revision: quote.revision, title: quote.title, customerName: quote.customerName,
      request: quote.request, included: quote.included, excluded: quote.excluded,
      needs: quote.needs, questions: quote.questions, priceCents: 45000,
      currency: 'EUR', approvedAt: '2026-10-13T12:00:00.000Z',
    } };
    await route.fulfill({ json: quote });
  });

  await page.goto('/quotes/question-binding-regression');
  const approve = page.getByRole('button', { name: 'Approve scope & price' });
  await expect(approve).toBeDisabled();
  await page.getByRole('button', { name: 'Save quote', exact: true }).click();
  await expect(page.getByText('Quote saved.', { exact: true })).toBeVisible();

  await page.getByLabel('How is it settled?').selectOption('answer');
  await page.getByLabel('Answer or proposed assumption').fill('An inquiry form only; no live calendar.');
  await expect(approve).toBeEnabled();
  await expect(page.locator('.approval-hint')).toContainText('Ready for your approval');
  await page.getByRole('button', { name: 'Save quote', exact: true }).click();
  await expect(page.getByText('Quote saved.', { exact: true })).toBeVisible();
  expect(savedResponses.at(-1)).toBe('An inquiry form only; no live calendar.');

  await page.getByLabel('How is it settled?').selectOption('assumption');
  await page.getByLabel('Assumption shown to the customer').fill('Only an inquiry form is included.');
  await expect(approve).toBeEnabled();
  await page.getByRole('button', { name: 'Try example drafting' }).click();
  await expect(page.getByText('Example draft added. Review every line and settle the questions.')).toBeVisible();
  await expect(approve).toBeDisabled();
  await page.getByLabel('How is it settled?').selectOption('answer');
  await page.getByLabel('Answer or proposed assumption').fill('The customer confirmed an inquiry form.');
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText('Scope and price approved. Open Customer view to review the agreement.')).toBeVisible();
  expect(quote.questions[0].response).toBe('The customer confirmed an inquiry form.');
});

