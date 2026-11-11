import { tizaPlugin } from "./plugin.mjs";

const blank = { skipBlankLines: true, skipComments: true };

// Components are bigger than plain functions because they carry markup. Only .tsx files can hold
// them, so .ts files get the plain limit for every function.
const sizeRules = (componentMax) => ({
  "max-lines": ["error", { max: 200, ...blank }],
  "tiza/function-size": ["error", { max: 40, componentMax }],
  complexity: ["error", 10],
  "max-depth": ["error", 3],
  "max-params": ["error", 3],
});

export const sizes = [
  {
    files: ["**/*.{ts,mjs,js}"],
    plugins: { tiza: tizaPlugin },
    rules: sizeRules(40),
  },
  {
    files: ["**/*.tsx"],
    plugins: { tiza: tizaPlugin },
    rules: sizeRules(150),
  },
  {
    // A describe() callback holds every case of a suite, so the function limit would only push tests
    // into arbitrary splits. The file limit still applies: a test file over 200 lines gets split.
    files: ["**/*.test.{ts,tsx}", "tests/e2e/**/*.spec.ts"],
    rules: { "tiza/function-size": "off" },
  },
  {
    // Playwright fixtures receive a `use` callback that the React hooks rule mistakes for React.use().
    files: ["tests/e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
];
