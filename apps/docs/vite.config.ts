import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // docstream and its deps ship TSX/JSX source — pre-bundle them with esbuild's
  // automatic JSX runtime so they work as plain dependencies.
  optimizeDeps: {
    include: ["@brett_lamy/docstream", "react", "react-dom", "react-dom/client"],
    esbuildOptions: {
      jsx: "automatic",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
