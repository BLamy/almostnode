import type { Product } from './products';

export type CartItem = {
  product: Product;
  quantity: number;
};

export type CheckoutSession = {
  id: string;
  url: string;
};

const DEFAULT_STRIPE_EMULATOR_URL = '/__virtual__/4009';
const DEFAULT_STRIPE_SECRET_KEY = 'sk_test_vibecoder_store';

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function getStripeEmulatorBaseUrl(): string {
  return stripTrailingSlash(
    import.meta.env.VITE_STRIPE_EMULATOR_URL || DEFAULT_STRIPE_EMULATOR_URL,
  );
}

function toAbsoluteAppUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const virtualBase = window.location.pathname.match(/^(.*\/__virtual__\/\d+)(?:\/|$)/)?.[1] || '';
  return new URL(`${virtualBase}${normalizedPath}`, window.location.origin).toString();
}

export function normalizeStripeCheckoutUrl(url: string): string {
  const emulatorBase = getStripeEmulatorBaseUrl();
  const parsed = new URL(url, window.location.href);

  if (parsed.hostname === 'localhost' && parsed.port === '4009') {
    const browserBase = new URL(emulatorBase, window.location.origin);
    return `${browserBase.origin}${browserBase.pathname}${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  return parsed.toString();
}

export async function createStripeCheckoutSession(items: CartItem[]): Promise<CheckoutSession> {
  const emulatorBase = getStripeEmulatorBaseUrl();
  const response = await fetch(`${emulatorBase}/v1/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_STRIPE_SECRET_KEY || DEFAULT_STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode: 'payment',
      success_url: toAbsoluteAppUrl('/success?session_id={CHECKOUT_SESSION_ID}'),
      cancel_url: toAbsoluteAppUrl('/'),
      line_items: items.map((item) => ({
        price: item.product.priceId,
        quantity: item.quantity,
      })),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data.error === 'string'
      ? data.error
      : 'Stripe emulator did not create a checkout session.';
    throw new Error(message);
  }

  if (typeof data.id !== 'string' || typeof data.url !== 'string') {
    throw new Error('Stripe emulator returned an invalid checkout session.');
  }

  return {
    id: data.id,
    url: normalizeStripeCheckoutUrl(data.url),
  };
}
