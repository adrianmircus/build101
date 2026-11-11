import { tizaPlugin } from "./plugin.mjs";

// The dependency matrix lives in rules/layers.mjs: it resolves files, which no-restricted-imports
// patterns cannot do reliably (barrels, "./x/../y", dynamic import()).
export const layers = [
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    plugins: { tiza: tizaPlugin },
    rules: { "tiza/layers": "error" },
  },
];
