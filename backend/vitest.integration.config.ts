import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    hookTimeout: 120000,
    testTimeout: 30000,
    fileParallelism: false,
  },
});
