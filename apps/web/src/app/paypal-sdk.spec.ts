import { loadPayPalSdk, type PayPalSdk } from './paypal-sdk';

it('loads a final-price EUR checkout and reuses the SDK for the same merchant', async () => {
  const appendScript = vi.spyOn(document.head, 'append').mockImplementation(() => undefined);
  const previousSdk = window.paypal;
  const sdk: PayPalSdk = { Buttons: vi.fn() };
  window.paypal = sdk;
  try {
    const loading = loadPayPalSdk('checkout-test-client');
    const script = appendScript.mock.calls[0][0] as HTMLScriptElement;
    const url = new URL(script.src);
    expect(url.origin + url.pathname).toBe('https://www.paypal.com/sdk/js');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'client-id': 'checkout-test-client', currency: 'EUR', intent: 'capture',
      commit: 'true', components: 'buttons',
    });
    expect(loadPayPalSdk('checkout-test-client')).toBe(loading);
    script.dispatchEvent(new Event('load'));
    expect(await loading).toBe(sdk);
    expect(appendScript).toHaveBeenCalledTimes(1);
  } finally {
    window.paypal = previousSdk;
    appendScript.mockRestore();
  }
});
