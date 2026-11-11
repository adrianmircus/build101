import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // The real package throws outside a react-server build; tests have no such build.
      "server-only": fileURLToPath(new URL("./tests/setup/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    // e2e and integration have their own commands (Playwright / Supabase local).
    exclude: [
      "**/node_modules/**",
      ".next/**",
      ".claude/**",
      "nocti-*/**",
      "dfa-demo*/**",
      "tests/e2e/**",
      "tests/integration/**",
    ],
    coverage: {
      provider: "v8",
      include: ["lib/domain/**", "lib/server/services/**"],
      // Those folders are empty until later phases: don't fail the run for lack of files.
      allowExternal: false,
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
