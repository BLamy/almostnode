# agent-wasm vibecoder store

This seeded workspace is a React + Vite store with a Stripe Checkout path wired for the almostnode browser IDE.

- edit `src/pages/Home.tsx`
- run `npm run dev`
- preview the app in the host pane
- ask the agent to add a product to the cart and checkout with Stripe

The checkout client posts to the Stripe emulator at `/__virtual__/4009/v1/checkout/sessions` by default. The product price IDs are mirrored in `emulate.config.json` so the emulator can seed matching Stripe products and prices.

Set `VITE_STRIPE_EMULATOR_URL` if your Stripe emulator is registered somewhere else.
