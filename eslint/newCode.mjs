import { tizaPlugin } from "./plugin.mjs";

// Stricter rules for the platform layers. Legacy code is exempt until it migrates into them.
const NEW_CODE = [
  "lib/errors.ts",
  "lib/domain/**/*.ts",
  "lib/server/**/*.ts",
  "lib/client/**/*.{ts,tsx}",
  "tests/**/*.ts",
];

export const newCode = [
  {
    files: NEW_CODE,
    plugins: { tiza: tizaPlugin },
    rules: {
      "tiza/no-legacy-imports": "error",
      // Named exports only: renaming a default import silently breaks greps and refactors.
      "no-restricted-exports": ["error", { restrictDefaultExports: { direct: true, defaultFrom: true } }],
      "@typescript-eslint/no-explicit-any": "error",
      // "never" still allows `as const`, which is the only assertion we want.
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    },
  },
  {
    files: ["lib/server/**/*.ts"],
    ignores: ["**/*.test.ts"],
    plugins: { tiza: tizaPlugin },
    rules: { "tiza/require-server-only": "error" },
  },
];
