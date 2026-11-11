import { tizaPlugin } from "./plugin.mjs";

// Stricter rules for the platform layers. Legacy code is exempt until it migrates into them.
const NEW_CODE = [
  "lib/errors.ts",
  "lib/errors.test.ts",
  "lib/domain/**/*.{ts,tsx}",
  "lib/server/**/*.{ts,tsx}",
  "lib/client/**/*.{ts,tsx}",
  "tests/**/*.{ts,tsx}",
];

export const newCode = [
  {
    files: NEW_CODE,
    plugins: { tiza: tizaPlugin },
    rules: {
      "tiza/no-legacy-imports": "error",
      "tiza/static-import-target": "error",
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
  // The domain is pure TypeScript without React, so a .tsx file there is a mistake (and a way around the rules).
  {
    files: ["lib/domain/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program",
          message: "lib/domain no admite archivos .tsx: el dominio no usa React ni JSX. Usá .ts, o mové el componente a components/.",
        },
      ],
    },
  },
  // Browser-driven tests may import dynamically; they run outside the layered code.
  {
    files: ["tests/e2e/**"],
    plugins: { tiza: tizaPlugin },
    rules: { "tiza/static-import-target": "off" },
  },
  {
    files: ["lib/server/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    plugins: { tiza: tizaPlugin },
    rules: { "tiza/require-server-only": "error" },
  },
];
