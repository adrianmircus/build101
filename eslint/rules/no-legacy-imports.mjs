// New code must not import legacy modules. tsconfig.strict.json turns on noUncheckedIndexedAccess
// and `include` does not isolate imports: a legacy module imported by new code joins the strict
// program and breaks it. Paths are resolved (alias and relative) because a relative "../groups"
// can mean different folders depending on where the importing file lives.
import { importVisitors, resolveSource, within } from "./imports.mjs";

const NEW_ROOTS = ["lib/errors", "lib/domain", "lib/server", "lib/client"];
const LEGACY_ROOTS = ["lib", "components", "app", "proxy"];

// `target` has no extension; "lib/errors.test" is the test next to lib/errors.ts.
export function isLegacyTarget(target) {
  const base = target.replace(/\.test$/, "");
  if (NEW_ROOTS.some((root) => within(base, root))) return false;
  return LEGACY_ROOTS.some((root) => within(base, root));
}

export const noLegacyImports = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      legacy:
        "New code cannot import legacy code ('{{source}}'): it would join the strict TypeScript program (noUncheckedIndexedAccess). To reuse old logic, move the module into lib/domain, lib/server or lib/client.",
    },
  },
  create(context) {
    return importVisitors((node, source) => {
      const target = resolveSource(source, context.filename, context.cwd);
      if (target !== null && isLegacyTarget(target)) {
        context.report({ node, messageId: "legacy", data: { source } });
      }
    });
  },
};
