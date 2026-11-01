import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

export default defineConfig({
  plugins: [react()],
  define: {
    __GIT_HASH__: JSON.stringify("test"),
    __BUILD_ID__: JSON.stringify("test"),
    // Fixed example hosts: tests do not depend on the shipped site.config.json.
    __CDN_URL__: JSON.stringify("https://cdn.example.test"),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@smriti/shared": resolve(projectRoot, "src/shared/src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/__tests__/setup.ts"],
    globals: false,
    // Registration-flow integration tests walk the full 7-step wizard with
    // userEvent interactions. Under full-suite parallel load these can exceed
    // the 5000ms default. 15000ms provides a 3–5x buffer over isolated times.
    testTimeout: 15000,
  },
});
