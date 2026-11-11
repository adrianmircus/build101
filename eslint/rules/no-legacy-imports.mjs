// New code must not import legacy modules. tsconfig.strict.json turns on noUncheckedIndexedAccess
// and `include` does not isolate imports: a legacy module imported by new code joins the strict
// program and breaks it. Paths are resolved (alias and relative) because a relative "../groups"
// can mean different folders depending on where the importing file lives.
import { dirname, relative, resolve, sep } from "node:path";

const NEW_ROOTS = ["lib/errors", "lib/domain", "lib/server", "lib/client"];
const LEGACY_ROOTS = ["lib", "components", "app", "proxy"];

const within = (target, root) => target === root || target.startsWith(`${root}/`);

export function isLegacyTarget(target) {
  if (NEW_ROOTS.some((root) => within(target.replace(/\.(ts|tsx|mjs|js)$/, ""), root))) return false;
  return LEGACY_ROOTS.some((root) => within(target.replace(/\.(ts|tsx|mjs|js)$/, ""), root));
}

function resolveSource(source, filename, cwd) {
  if (source.startsWith("@/")) return source.slice(2);
  if (!source.startsWith(".")) return null;
  return relative(cwd, resolve(dirname(filename), source)).split(sep).join("/");
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
    function check(node) {
      if (!node.source) return;
      const source = node.source.value;
      const target = typeof source === "string" ? resolveSource(source, context.filename, context.cwd) : null;
      if (target !== null && isLegacyTarget(target)) {
        context.report({ node: node.source, messageId: "legacy", data: { source } });
      }
    }
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
};
