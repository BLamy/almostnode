import { defineConfig, mergeConfig } from "vitest/config"
import viteConfig from "./vite.config"

async function resolveViteConfig() {
  return typeof viteConfig === "function"
    ? await viteConfig({
        command: "serve",
        isPreview: false,
        isSsrBuild: false,
        mode: "test",
      })
    : viteConfig
}

export default defineConfig(async () =>
  mergeConfig(await resolveViteConfig(), {
    test: {
      include: ["src/**/*.test.{ts,tsx}"],
    },
  }),
)
