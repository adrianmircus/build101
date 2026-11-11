// Shared by the import-based rules: finds every module specifier (import, re-export and dynamic
// import()) and resolves it to a repo-relative path, so a rule judges the real file and not the
// spelling ("@/lib/x", "../x" or "../../lib/./x" are the same thing).
import { dirname, relative, resolve, sep } from "node:path";
import { normalize } from "node:path/posix";

const EXT = /\.(?:ts|tsx|mjs|js)$/;

/** Repo-relative path without extension, or null for packages and paths outside the repo. */
export function resolveSource(rawSource, filename, cwd) {
  // Canonical spelling first, as TypeScript resolves it: backslashes are separators and repeated
  // slashes collapse, so "@//lib/x", "@///lib/x" and "..\\lib\\x" are the same module as "@/lib/x".
  const source = rawSource.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  let path;
  // Aliases are normalized like relative paths: "@/lib/domain/../server/x" is lib/server/x.
  if (source.startsWith("@/")) path = normalize(source.slice(2));
  else if (source.startsWith(".")) path = relative(cwd, resolve(dirname(filename), source)).split(sep).join("/");
  else return null;
  if (path === ".." || path.startsWith("../")) return null;
  return path.replace(EXT, "");
}

export const repoPath = (filename, cwd) => relative(cwd, filename).split(sep).join("/").replace(EXT, "");

export const within = (path, root) => path === root || path.startsWith(`${root}/`);

/** The specifier of an import() call when it is a literal or a template without interpolations. */
export function staticTarget(source) {
  if (source.type === "Literal" && typeof source.value === "string") return source.value;
  if (source.type === "TemplateLiteral" && source.expressions.length === 0) return source.quasis[0]?.value.cooked ?? null;
  return null;
}

/** Visitors that call `onSource(node, specifier)` for every static module specifier. */
export function importVisitors(onSource) {
  const fromDeclaration = (node) => {
    if (node.source && typeof node.source.value === "string") onSource(node.source, node.source.value);
  };
  return {
    ImportDeclaration: fromDeclaration,
    ExportNamedDeclaration: fromDeclaration,
    ExportAllDeclaration: fromDeclaration,
    ImportExpression(node) {
      const specifier = staticTarget(node.source);
      if (specifier !== null) onSource(node.source, specifier);
    },
  };
}
