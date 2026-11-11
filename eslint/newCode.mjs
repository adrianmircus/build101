import { tizaPlugin } from "./plugin.mjs";

// Stricter rules for the platform layers. Legacy code is exempt until it migrates into them.
const NEW_CODE = [
  "lib/errors.ts",
  "lib/errors.test.ts",
  "lib/domain/**/*.ts",
  "lib/server/**/*.{ts,tsx}",
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
      // `!` and @ts-* comments silence the compiler instead of fixing the type.
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true, "ts-check": false },
      ],
    },
  },
  {
    files: ["lib/server/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    plugins: { tiza: tizaPlugin },
    rules: { "tiza/require-server-only": "error" },
  },
];
