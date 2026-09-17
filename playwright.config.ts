import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 180_000,
  workers: 1,
  expect: { timeout: 30_000 },
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: {
    // Production mode for CI parity (dev mode's on-demand compilation can add enough latency to
    // the first request to trip up timing-sensitive assertions); `next build` runs once here since
    // reuseExistingServer is off in CI, so this is the actual served app, not source.
    command: process.env.CI ? "npx next build && npx next start" : "npx next dev",
    url: "http://localhost:3000/",
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 120_000 : 30_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
