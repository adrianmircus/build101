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
];
