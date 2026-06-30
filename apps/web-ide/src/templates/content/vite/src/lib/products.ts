export type Product = {
  id: string;
  name: string;
  description: string;
  priceId: string;
  priceCents: number;
  accent: string;
  specs: string[];
};

export const PRODUCTS: Product[] = [
  {
    id: 'desk-pad',
    name: 'Graphite Desk Pad',
    description: 'A low-profile mat with a smooth tracking surface and a stitched edge.',
    priceId: 'price_vibecoder_desk_pad',
    priceCents: 4800,
    accent: 'bg-amber-500',
    specs: ['Vegan leather', '34 x 16 in', 'Ships test-only'],
  },
  {
    id: 'task-lamp',
    name: 'Focus Task Lamp',
    description: 'A dimmable aluminum lamp for late-night checkout flow debugging.',
    priceId: 'price_vibecoder_task_lamp',
    priceCents: 8900,
    accent: 'bg-sky-500',
    specs: ['USB-C powered', 'Warm/cool modes', 'Emulated stock'],
  },
  {
    id: 'notebook-kit',
    name: 'Prototype Notebook Kit',
    description: 'Three dot-grid notebooks and a fine-tip pen for sketching product ideas.',
    priceId: 'price_vibecoder_notebook_kit',
    priceCents: 3200,
    accent: 'bg-emerald-500',
    specs: ['3-pack', '120 pages each', 'Ready for QA'],
  },
];

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}
