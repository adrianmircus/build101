import { defineConfig, devices } from "@playwright/test";
import type { TestOptions } from "./tests/e2e/support/fixtures";

const PORT = 3100;
const CI = !!process.env.CI;

export default defineConfig<TestOptions>({
  testDir: "tests/e2e",
  // The guided demo has real delays (several seconds per version), so each test gets a generous budget.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [["html"], ["github"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "es-UY",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // 1440x900 is a common notebook. The default 1280x720 is too short: on tall steps the tour bubble falls off screen
    // (see the "burbuja fuera de la pantalla" annotations).
    { name: "escritorio", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Pixel 7 is Chromium-based, so only one browser needs to be installed.
    { name: "celular", use: { ...devices["Pixel 7"], viewTransitions: false } },
  ],
  webServer: {
    // The production build is what colleges see; the dev server hides problems (and adds its own overlay).
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 600_000,
    env: {
      // Throwaway value: a production build refuses to sign sessions without one. It protects nothing real.
      SESSION_SECRET: "e2e-only-not-a-real-secret",
      // The demo must never reach an AI provider; empty keys also make any accidental call fail fast.
      ANTHROPIC_API_KEY: "",
      OPENROUTER_API_KEY: "",
      ELEVENLABS_API_KEY: "",
    },
  },
});
