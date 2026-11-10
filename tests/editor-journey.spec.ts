import { expect, test } from '@playwright/test';

test('example effort comparison persists, changes price only on selection and becomes stale after edits', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use this example' }).click();
  await page.getByLabel('Hourly rate in EUR').fill('50');
  await page.getByRole('button', { name: 'Estimate work', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compare delivery options' })).toBeVisible();
  await expect(page.getByLabel('Total price in EUR')).toHaveValue('');
  await page.getByRole('button', { name: 'Use low suggestion with an ai agent', exact: true }).click();
  const chosen = await page.getByLabel('Total price in EUR').inputValue();
  expect(Number(chosen)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Save quote', exact: true }).click();
  await expect(page.getByText('Quote saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Total price in EUR')).toHaveValue(chosen);
  await page.getByLabel('Included work').fill('A different deliverable.');
  await expect(page.getByRole('button', { name: 'Use low suggestion with an ai agent', exact: true })).toBeDisabled();
});

test('manual question add, save, edit, remove and dashboard persistence work against the real API', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Work title').fill('Question lifecycle');
  await page.getByLabel('Customer name').fill('Test studio');
  await page.getByLabel('Customer request').fill('Create a menu with seasonal specials.');
  await page.getByRole('button', { name: 'New quote' }).click();
  await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]+$/);
  const id = page.url().split('/').at(-1)!;
  await page.getByLabel('Included work').fill('One menu.');
  await page.getByRole('button', { name: '+ Add a question' }).click();
  await page.getByLabel('Words in the request').fill('seasonal specials');
  await page.getByLabel('Question', { exact: true }).fill('How many seasonal versions?');
  await page.getByLabel('How is it settled?').selectOption('answer');
  await page.getByLabel('Answer or proposed assumption').fill('One version.');
  await page.getByRole('button', { name: 'Save quote', exact: true }).click();
  await expect(page.getByText('Revision 2', { exact: true })).toBeVisible();
  await page.getByLabel('How is it settled?').selectOption('assumption');
  await page.getByLabel('Assumption shown to the customer').fill('One initial version only.');
  await page.getByRole('button', { name: 'Save quote', exact: true }).click();
  await expect(page.getByText('Revision 3', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Assumption shown to the customer')).toHaveValue('One initial version only.');
  await page.getByRole('button', { name: 'Remove question 1' }).click();
  await page.getByRole('button', { name: 'Save quote', exact: true }).click();
  await expect(page.getByText('Revision 4', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '← Your work', exact: true }).click();
  await page.reload();
  await expect(page.locator(`a[href="/quotes/${id}"]`)).toContainText('Question lifecycle');
  await page.goto(`/quotes/${id}`);
  await expect(page.getByRole('button', { name: 'Remove question 1' })).toHaveCount(0);
});

test('missing quotes show a useful error on editor and review pages', async ({ page }) => {
  for (const path of ['/quotes/missing-quote', '/review/missing-quote']) {
    await page.goto(path);
    await expect(page.getByRole('alert')).toContainText('This quote could not be found.');
  }
});
