import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { layers } from "./eslint/layers.mjs";
import { legacy } from "./eslint/legacy.mjs";
import { newCode } from "./eslint/newCode.mjs";
import { sizes } from "./eslint/sizes.mjs";

// ESLINT_NO_LEGACY=1 drops the exception list: eslint/build-legacy.mjs uses it to measure.
const exceptions = process.env.ESLINT_NO_LEGACY === "1" ? [] : legacy;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...sizes,
  ...layers,
  ...newCode,
  ...exceptions,
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
    // Untracked local folders (scratch repos, reports, test output): linting them ran out of memory.
    "nocti-*/**",
    "dfa-demo*/**",
    "reports/**",
    "research_notes/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
