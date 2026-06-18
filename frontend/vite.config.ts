import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // Overridable so the Playwright test frontend can proxy to the test
        // backend (port 3101) instead of the dev backend (3001).
        target: process.env.BACKEND_URL ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
