import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

// Integration tests run against the local Supabase (`npm run db:start`). They are not part of
// `npm test`: that config excludes tests/integration on purpose.
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": fileURLToPath(new URL("./tests/setup/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/integration/setup/global.ts"],
    // Real network and database: more room than a unit test.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
