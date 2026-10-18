import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party agent skills (npx skills add), not app code.
    ".agents/**",
    // Other agents' git worktrees: separate checkouts of this repo, linted from their own folder.
    ".claude/worktrees/**",
    // MediaPipe's WASM loaders, copied from node_modules on install (scripts/copy-mediapipe.mjs).
    "public/mediapipe/**",
    // Local end-to-end test runs (not committed): their bundled output isn't app code.
    ".e2e-codex/**",
  ]),
]);

export default eslintConfig;
