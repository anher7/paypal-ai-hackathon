import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3002' });

// Only the external SDK is replaced; quote, approval, order, capture and SQLite use the real API.
async function installSdk(page: Page) {
  await page.route('https://www.paypal.com/sdk/js?**', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.paypal = { Buttons(options) { let host; return {
      async render(container) {
        host = container;
        for (const [label, action] of [
          ['Test PayPal pay', async () => { const id = await options.createOrder(); await options.onApprove({orderID:id}); }],
          ['Test PayPal cancel', () => options.onCancel()],
        ]) { const button = document.createElement('button'); button.textContent = label;
          button.onclick = () => Promise.resolve().then(action).catch(options.onError); container.append(button); }
      }, async close() { if(host) host.replaceChildren(); }
    }; } };` }));
}

async function ready(page: Page, marker = '') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use this example' }).click();
  await expect(page.getByRole('heading', { name: 'Review the scope' })).toBeVisible();
  await page.getByLabel('Work title').fill(`Integration quote ${marker}`);
  await page.getByLabel('How is it settled?').selectOption('answer');
  await page.getByLabel('Answer or proposed assumption').fill('An inquiry form only; no live calendar.');
  await page.getByLabel('Total price in EUR').fill('450.50');
  await page.getByRole('button', { name: 'Approve scope & price' }).click();
  await page.getByRole('link', { name: 'Customer view' }).click();
  await expect(page.getByText('€450.50', { exact: true })).toBeVisible();
  return page.url().split('/').at(-1)!;
}

test('checkout captures the fixed total, persists the receipt, locks edits and prevents repeat payment', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installSdk(page);
  const id = await ready(page);
  const initial = await (await request.get(`/api/quotes/${id}`)).json();
  const missingConsent = await request.post(`/api/quotes/${id}/orders`, { data: { approvedRevision: initial.revision, scopeAccepted: false } });
  expect(missingConsent.status()).toBe(400);
  await expect(page.getByRole('button', { name: 'Test PayPal pay', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'I agree to this scope' }).check();
  await page.getByRole('button', { name: 'Test PayPal pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Payment received.' })).toBeVisible();
  const paid = await (await request.get(`/api/quotes/${id}`)).json();
  expect(paid.status).toBe('paid');
  expect(paid.payment.priceCents).toBe(45050);
  expect(paid.payment.orderId).toMatch(/^TEST-ORDER-/);
  await page.reload();
  await expect(page.getByText(paid.payment.captureId, { exact: true })).toBeVisible();
  const repeat = await request.post(`/api/quotes/${id}/orders/${paid.payment.orderId}/capture`, { data: { approvedRevision: paid.revision, scopeAccepted: true } });
  expect(repeat.status()).toBe(200);
  expect((await repeat.json()).payment).toEqual(paid.payment);
  const newOrder = await request.post(`/api/quotes/${id}/orders`, { data: { approvedRevision: paid.revision, scopeAccepted: true } });
  expect(newOrder.status()).toBe(409);
  await page.goto(`/quotes/${id}`);
  await expect(page.getByRole('heading', { name: 'This quote is paid.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save quote', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '← Your work', exact: true }).click();
  await expect(page.locator(`a[href="/review/${id}"]`)).toContainText('Paid');
  expect(errors).toEqual([]);
});

test('a provider timeout survives reload and recovers the same order', async ({ page, request }) => {
  await installSdk(page);
  const id = await ready(page, '[uncertain]');
  await page.getByRole('checkbox', { name: 'I agree to this scope' }).check();
  await page.getByRole('button', { name: 'Test PayPal pay', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Controlled provider timeout');
  const recovery = await (await request.get(`/api/quotes/${id}/checkout-recovery`)).json();
  await page.reload();
  const retry = page.getByRole('button', { name: 'Check payment again' });
  await expect(retry).toBeDisabled();
  await page.getByRole('checkbox', { name: 'I agree to this scope' }).check();
  await retry.click();
  await expect(page.getByRole('heading', { name: 'Payment received.' })).toBeVisible();
  expect((await (await request.get(`/api/quotes/${id}`)).json()).payment.orderId).toBe(recovery.orderId);
});

test('an incorrect capture amount cannot produce a paid receipt', async ({ page, request }) => {
  await installSdk(page);
  const id = await ready(page, '[mismatch]');
  await page.getByRole('checkbox', { name: 'I agree to this scope' }).check();
  await page.getByRole('button', { name: 'Test PayPal pay', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('PayPal has not confirmed a completed payment');
  await expect(page.getByRole('heading', { name: 'Payment received.' })).toHaveCount(0);
  const quote = await (await request.get(`/api/quotes/${id}`)).json();
  expect(quote.payment).toBeNull();
  expect(quote.status).toBe('ready');
});

test('cancelled checkout stays unpaid and the agreement can be printed', async ({ page, request }) => {
  await installSdk(page);
  const id = await ready(page);
  await page.evaluate(() => { window.print = () => { document.body.dataset['printed'] = 'yes'; }; });
  await page.getByRole('button', { name: 'Print / save agreement' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-printed', 'yes');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.agreement-title')).toBeVisible();
  await expect(page.locator('.print-agreement')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('checkbox', { name: 'I agree to this scope' }).check();
  await page.getByRole('button', { name: 'Test PayPal cancel', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Checkout cancelled');
  expect((await (await request.get(`/api/quotes/${id}`)).json()).payment).toBeNull();
});

test('SDK loading failure leaves the agreement unpaid and reports the error', async ({ page, request }) => {
  await page.route('https://www.paypal.com/sdk/js?**', route => route.abort());
  const id = await ready(page);
  await page.getByRole('checkbox', { name: 'I agree to this scope' }).check();
  await expect(page.getByRole('alert')).toContainText('PayPal checkout could not load');
  expect((await (await request.get(`/api/quotes/${id}`)).json()).payment).toBeNull();
});
