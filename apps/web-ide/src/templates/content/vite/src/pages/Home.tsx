import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { createStripeCheckoutSession, type CartItem } from '@/lib/stripeCheckout';
import { PRODUCTS, formatCurrency, type Product } from '@/lib/products';

type CartState = Record<string, number>;

function cartEntries(cart: CartState): CartItem[] {
  return PRODUCTS
    .map((product) => ({
      product,
      quantity: cart[product.id] || 0,
    }))
    .filter((item) => item.quantity > 0);
}

function cartCount(cart: CartState): number {
  return Object.values(cart).reduce((total, quantity) => total + quantity, 0);
}

function cartTotal(items: CartItem[]): number {
  return items.reduce(
    (total, item) => total + item.product.priceCents * item.quantity,
    0,
  );
}

function StoreProductCard({
  product,
  quantity,
  onAdd,
  onRemove,
}: {
  product: Product;
  quantity: number;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <article className="grid min-h-[23rem] grid-rows-[9rem_1fr] overflow-hidden rounded-lg border border-border bg-card shadow-[0_20px_70px_-50px_rgba(15,23,42,0.8)]">
      <div className="relative overflow-hidden bg-secondary">
        <div className={`absolute left-5 top-5 h-16 w-16 rounded-md ${product.accent}`} />
        <div className="absolute bottom-5 left-5 right-5 rounded-md border border-white/35 bg-white/55 p-3 text-sm font-semibold text-slate-900 shadow-sm backdrop-blur">
          {product.name}
        </div>
      </div>
      <div className="flex flex-col p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{product.name}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{product.description}</p>
          </div>
          <p className="shrink-0 text-base font-semibold">{formatCurrency(product.priceCents)}</p>
        </div>

        <ul className="mt-4 grid gap-2 text-xs text-muted-foreground">
          {product.specs.map((spec) => (
            <li key={spec} className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${product.accent}`} />
              {spec}
            </li>
          ))}
        </ul>

        <div className="mt-auto flex items-center gap-2 pt-5">
          <Button className="flex-1" onClick={onAdd}>
            Add {product.name} to cart
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label={`Remove ${product.name} from cart`}
            onClick={onRemove}
            disabled={quantity === 0}
          >
            -
          </Button>
          <span className="min-w-8 rounded-md border border-border bg-background px-2 py-2 text-center text-sm font-semibold">
            {quantity}
          </span>
        </div>
      </div>
    </article>
  );
}

function Home() {
  const [cart, setCart] = useState<CartState>({});
  const [checkoutState, setCheckoutState] = useState<'idle' | 'loading'>('idle');
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(() => cartEntries(cart), [cart]);
  const total = cartTotal(items);
  const count = cartCount(cart);

  function addProduct(product: Product): void {
    setError(null);
    setCart((current) => ({
      ...current,
      [product.id]: (current[product.id] || 0) + 1,
    }));
  }

  function removeProduct(product: Product): void {
    setError(null);
    setCart((current) => {
      const nextQuantity = Math.max((current[product.id] || 0) - 1, 0);
      const next = { ...current };
      if (nextQuantity === 0) {
        delete next[product.id];
      } else {
        next[product.id] = nextQuantity;
      }
      return next;
    });
  }

  async function checkout(): Promise<void> {
    if (items.length === 0 || checkoutState === 'loading') return;

    setCheckoutState('loading');
    setError(null);
    try {
      const session = await createStripeCheckoutSession(items);
      window.location.assign(session.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Checkout failed.');
      setCheckoutState('idle');
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <nav className="flex items-center gap-4 py-2">
          <Link to="/" className="text-sm font-semibold text-foreground hover:text-foreground/80">Store</Link>
          <Link to="/todos" className="text-sm font-semibold text-muted-foreground hover:text-foreground">Todos</Link>
          <Link to="/about" className="text-sm font-semibold text-muted-foreground hover:text-foreground">About</Link>
          <div className="ml-auto rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground">
            {count} {count === 1 ? 'item' : 'items'}
          </div>
        </nav>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="space-y-5">
            <div className="rounded-lg border border-border bg-card p-5 shadow-[0_28px_90px_-56px_rgba(15,23,42,0.72)] sm:p-6">
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Vibecoder test store
              </p>
              <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                    Buy a product through an emulated Stripe Checkout flow.
                  </h1>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
                    Product prices match the seeded Stripe emulator IDs in this workspace, so an agent can add an item, open Checkout, pay, and verify the success screen without touching live Stripe.
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-secondary px-4 py-3 text-sm text-muted-foreground">
                  Stripe target <span className="font-mono text-foreground">/__virtual__/4009</span>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {PRODUCTS.map((product) => (
                <StoreProductCard
                  key={product.id}
                  product={product}
                  quantity={cart[product.id] || 0}
                  onAdd={() => addProduct(product)}
                  onRemove={() => removeProduct(product)}
                />
              ))}
            </div>
          </div>

          <aside className="h-fit rounded-lg border border-border bg-card p-5 shadow-[0_28px_90px_-54px_rgba(15,23,42,0.72)] lg:sticky lg:top-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Cart</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">Checkout summary</h2>
              </div>
              <div className="rounded-md bg-secondary px-3 py-2 text-sm font-semibold">
                {count}
              </div>
            </div>

            <div className="mt-5 min-h-32 space-y-3">
              {items.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm leading-6 text-muted-foreground">
                  Cart is empty. Add any product to enable the Stripe checkout flow.
                </p>
              ) : (
                items.map((item) => (
                  <div key={item.product.id} className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-3">
                    <div>
                      <p className="text-sm font-semibold">{item.product.name}</p>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{item.product.priceId}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {item.quantity} x {formatCurrency(item.product.priceCents)}
                    </p>
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 border-t border-border pt-5">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span className="text-lg font-semibold text-foreground">{formatCurrency(total)}</span>
              </div>
              <Button
                className="mt-4 w-full"
                size="lg"
                onClick={checkout}
                disabled={items.length === 0 || checkoutState === 'loading'}
              >
                {checkoutState === 'loading' ? 'Creating Stripe session...' : 'Checkout with Stripe'}
              </Button>
              {error ? (
                <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm leading-6 text-destructive">
                  {error}
                </p>
              ) : (
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  Test checkout uses the Stripe emulator. Use the hosted checkout page to complete payment.
                </p>
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

export default Home;
