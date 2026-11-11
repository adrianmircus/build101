import { functionSize } from "./rules/function-size.mjs";
import { noLegacyImports } from "./rules/no-legacy-imports.mjs";
import { requireServerOnly } from "./rules/server-only.mjs";

export const tizaPlugin = {
  meta: { name: "tiza" },
  rules: {
    "function-size": functionSize,
    "require-server-only": requireServerOnly,
    "no-legacy-imports": noLegacyImports,
  },
};
