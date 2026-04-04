import 'dotenv/config';
import { defineConfig } from '@playwright/test';

const e2ePort = Number(process.env.ALMOSTNODE_E2E_PORT || 5173);
const e2eBaseUrl = `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: e2eBaseUrl,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: `pnpm exec vite --config vite.examples.config.js --host localhost --port ${e2ePort} --strictPort`,
      url: `${e2eBaseUrl}/examples/vite-demo.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'node e2e/cors-proxy-server.mjs',
      url: 'http://localhost:8787',
      reuseExistingServer: !process.env.CI,
      timeout: 10000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
