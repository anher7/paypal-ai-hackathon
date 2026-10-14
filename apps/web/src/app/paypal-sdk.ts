export interface PayPalButtons {
  render(container: HTMLElement): Promise<void>;
  close(): Promise<void>;
}
export interface PayPalSdk {
  Buttons(options: {
    style: { layout: 'vertical'; shape: 'rect'; label: 'pay' };
    createOrder(): Promise<string>;
    onApprove(data: { orderID: string }): Promise<void>;
    onCancel(): void;
    onError(error: unknown): void;
  }): PayPalButtons;
}

declare global { interface Window { paypal?: PayPalSdk; } }

let loadingSdk: Promise<PayPalSdk> | null = null;
let loadedClientId: string | null = null;

export function loadPayPalSdk(clientId: string): Promise<PayPalSdk> {
  if (loadingSdk && loadedClientId === clientId) { return loadingSdk; }
  loadedClientId = clientId;
  loadingSdk = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?${new URLSearchParams({ 'client-id': clientId, currency: 'EUR', intent: 'capture', commit: 'true', components: 'buttons' })}`;
    script.async = true;
    script.onload = () => {
      if (window.paypal) { resolve(window.paypal); return; }
      loadingSdk = null; script.remove();
      reject(new Error('PayPal checkout did not load. Please refresh and try again.'));
    };
    script.onerror = () => { loadingSdk = null; script.remove(); reject(new Error('PayPal checkout could not load. Check your connection and try again.')); };
    document.head.append(script);
  });
  return loadingSdk;
}

