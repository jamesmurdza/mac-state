import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // The reservation allows 2 macOS VMs at once; every E2E file creates one, so run files one at a time.
    fileParallelism: false,
  },
});
