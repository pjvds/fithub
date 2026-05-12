import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests for the FitHub web frontend.
 *
 * Run with: npm run test:e2e
 *
 * The webServer block starts `astro dev` with a stub AUTH_WORKER_URL so the
 * server boots without requiring the real Cloudflare infrastructure.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  reporter: "list",

  use: {
    baseURL: "http://localhost:4321",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      // Stub value so the dev server boots; the auth redirect tests do not
      // follow the redirect chain beyond the initial 302.
      AUTH_WORKER_URL: "http://localhost:9998",
    },
  },
});
