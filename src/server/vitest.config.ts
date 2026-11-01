import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    conditions: ["workerd", "worker", "browser"],
  },
});
