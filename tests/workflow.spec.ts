import { expect, test, type Page } from '@playwright/test';

async function openExample(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use this example' }).click();
  await expect(page.getByRole('heading', { name: 'Review the scope' })).toBeVisible();
}

async function resolveExample(page: Page, price = '450.50') {
  await page.getByLabel('How is it settled?').selectOption('assumption');
  await page.getByLabel('Assumption shown to the customer').fill('An inquiry form only. Live calendar availability is not included.');
  await page.getByLabel('Total price in EUR').fill(price);
  await page.getByRole('button', { name: 'Approve scope & price' }).click();
  await expect(page.getByText('Scope and price approved. Open Customer view to review the agreement.')).toBeVisible();
}

test('question-linked scope needs an answer, then shows the exact approved price to the customer', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openExample(page);
  await expect(page.getByRole('link', { name: 'booking form', exact: true })).toBeVisible();
  await expect(page.getByText('Example draft · review every word')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve scope & price' })).toBeDisabled();
  await page.getByLabel('Total price in EUR').fill('450.50');
  await expect(page.getByRole('button', { name: 'Approve scope & price' })).toBeDisabled();
  await resolveExample(page);
  await page.getByRole('link', { name: 'Customer view' }).click();
  await expect(page.getByRole('heading', { name: 'Review your agreement' })).toBeVisible();
  await expect(page.getByText('An inquiry form only. Live calendar availability is not included.')).toBeVisible();
  await expect(page.getByText('€450.50', { exact: true })).toBeVisible();
  await expect(page.getByText('Sandbox checkout needs setup', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'I agree to this scope' }).check();
  await expect(page.getByText('Sandbox checkout needs setup', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Payment received.' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /simulate|mark.*paid/i })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('€450.50', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('editing an approved quote invalidates the old customer agreement', async ({ page }) => {
  await openExample(page);
  await resolveExample(page, '0.10');
  const quoteId = page.url().split('/').at(-1);
  await page.getByLabel('Included work').fill('One inquiry form.');
  await page.getByRole('button', { name: 'Save quote', exact: true }).click();
  await expect(page.getByText('Quote saved.', { exact: true })).toBeVisible();
  await page.goto(`/review/${quoteId}`);
  await expect(page.getByRole('heading', { name: 'This quote needs your approval.' })).toBeVisible();
  await expect(page.getByText('€0.10', { exact: true })).toHaveCount(0);
});

test('a new request works manually and sample drafting never claims to be live AI', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Work title').fill('A small menu update');
  await page.getByLabel('Customer name').fill('Dummy cafe');
  await page.getByLabel('Customer request').fill('Update three prices on our existing menu.');
  await page.getByRole('button', { name: 'New quote' }).click();
  await expect(page.getByRole('heading', { name: 'Review the scope' })).toBeVisible();
  await page.getByRole('button', { name: 'Try example drafting' }).click();
  await expect(page.getByRole('alert')).toContainText('Live AI is not connected.');
  await page.getByLabel('Included work').fill('Update three menu prices supplied by the customer.');
  await page.getByLabel('Total price in EUR').fill('25.10');
  await page.getByRole('button', { name: 'Approve scope & price' }).click();
  await expect(page.getByText('Scope and price approved. Open Customer view to review the agreement.')).toBeVisible();
  await page.getByRole('link', { name: 'Customer view' }).click();
  await expect(page.getByText('€25.10', { exact: true })).toBeVisible();
});

test('pages fit narrow screens and request links focus their question', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await openExample(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'booking form', exact: true }).click();
  await expect(page.locator('#question-booking-form')).toBeFocused();
  await resolveExample(page);
  await page.getByRole('link', { name: 'Customer view' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a request and quote title are rendered as text', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await page.goto('/');
  await page.getByLabel('Work title').fill('<img src=x onerror=alert(1)>');
  await page.getByLabel('Customer name').fill('Dummy customer');
  await page.getByLabel('Customer request').fill('<script>alert(1)</script>');
  await page.getByRole('button', { name: 'New quote' }).click();
  await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]+$/);
  const savedQuoteId = page.url().split('/').at(-1)!;
  await expect(page.getByLabel('Customer request')).toHaveValue('<script>alert(1)</script>');
  await expect(page.locator('.request-quote script')).toHaveCount(0);
  await expect(page.locator('.request-quote')).toContainText('<script>alert(1)</script>');
  await page.getByRole('link', { name: '← Your work', exact: true }).click();
  await expect(page.locator('a[href="/quotes/' + savedQuoteId + '"]').getByRole('heading', { name: '<img src=x onerror=alert(1)>', exact: true })).toBeVisible();
  await expect(page.locator('main img')).toHaveCount(0);
  expect(dialogs).toEqual([]);
});



test('uncertain payment recovery survives reload and checks the saved order only', async ({ page, request }) => {
  await openExample(page);
  await resolveExample(page);
  const quoteId = page.url().split('/').at(-1)!;
  const quoteResponse = await request.get(`/api/quotes/${quoteId}`);
  const quote = await quoteResponse.json();
  const attempts: { revision: number; accepted: boolean }[] = [];
  let sdkLoads = 0;

  await page.route('**/api/config', (route) => route.fulfill({
    json: { currency: 'EUR', paypalConfigured: true, paypalClientId: 'dummy-client', aiMode: 'examples', localOnly: true },
  }));
  await page.route(`**/api/quotes/${quoteId}/checkout-recovery`, (route) => route.fulfill({
    json: { orderId: 'saved-order', approvedRevision: quote.revision },
  }));
  await page.route(`**/api/quotes/${quoteId}/orders/saved-order/capture`, (route) => {
    const body = route.request().postDataJSON();
    attempts.push({ revision: body.approvedRevision, accepted: body.scopeAccepted });
    return route.fulfill({ status: 502, json: {
      error: { code: 'PAYMENT_UNCERTAIN', message: 'PayPal has not confirmed the result. Check this payment again.' },
    } });
  });
  await page.route('https://www.paypal.com/**', (route) => { sdkLoads += 1; return route.abort(); });
  await page.getByRole('link', { name: 'Customer view' }).click();
  const retry = page.getByRole('button', { name: 'Check payment again' });
  await expect(retry).toBeVisible();
  await expect(retry).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I agree to this scope' }).check();
  await retry.click();
  await expect(page.getByRole('alert')).toContainText('PayPal has not confirmed');
  await page.reload();
  await expect(retry).toBeVisible();
  await expect(retry).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I agree to this scope' }).check();
  await retry.click();
  await expect(page.getByRole('alert')).toContainText('PayPal has not confirmed');
  expect(attempts).toEqual([
    { revision: quote.revision, accepted: true },
    { revision: quote.revision, accepted: true },
  ]);
  expect(sdkLoads).toBe(0);
  await expect(page.getByRole('heading', { name: 'Payment received.' })).toHaveCount(0);
});



