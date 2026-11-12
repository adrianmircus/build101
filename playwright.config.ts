import { defineConfig, devices } from "@playwright/test";
import { PORT, serverEnv } from "./tests/e2e/support/env";

// Each worktree can pick its own port (E2E_PORT): two checkouts must not test each other's build. The default (3000) is the site_url of
// supabase/config.toml, so the links of the mails open the server under test; with another port only the test that opens a mail link as it arrived is skipped.
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
  // One school per run (its own admin, group and teacher), deleted at the end: see tests/e2e/support/global-setup.ts (it returns its own teardown).
  globalSetup: "./tests/e2e/support/global-setup.ts",
  // The guided demo has real delays (several seconds per version), so each test gets a generous budget.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  // Each test drives a full production build with axe on every screen: more than two browsers at once
  // starve a laptop (crashed targets, EPERM on close) and the run stops meaning anything.
  workers: 2,
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
    { name: "celular", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // The production build is what colleges see; the dev server hides problems (and adds its own overlay).
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Only when asked (E2E_REUSE=1): a server left over from another checkout would test someone else's build.
    reuseExistingServer: process.env.E2E_REUSE === "1" && !CI,
    timeout: 600_000,
    // The local Supabase, Mailpit and the demo's throwaway values: see tests/e2e/support/env.ts.
    env: serverEnv(),
  },
});
