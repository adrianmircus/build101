// Shared by the import-based rules: finds every module specifier (import, re-export and dynamic
// import()) and resolves it to a repo-relative path, so a rule judges the real file and not the
// spelling ("@/lib/x", "../x" or "../../lib/./x" are the same thing).
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const EXT = /\.(?:ts|tsx|mjs|js)$/;

/** Repo-relative path without extension, or null for packages and paths outside the repo. */
export function resolveSource(rawSource, filename, cwd) {
  // Canonical spelling first, as TypeScript resolves it: backslashes are separators and repeated
  // slashes collapse, so "@//lib/x", "@///lib/x" and "..\\lib\\x" are the same module as "@/lib/x".
  const source = rawSource.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  let path;
  // Every form resolves to an absolute path first and only then becomes repo-relative, so a spelling
  // that leaves the repo and comes back ("@/../<repo folder>/lib/server/x") or an absolute path
  // ("C:/…/lib/server/x", "/…/lib/server/x") is still lib/server/x.
  // Backslashes are already slashes here, so a Windows drive path looks like "C:/…".
  const absolute = isAbsolute(source) || /^[A-Za-z]:\//.test(source);
  const base = source.startsWith("@/") ? cwd : source.startsWith(".") || absolute ? dirname(filename) : null;
  if (base === null) return null;
  const target = source.startsWith("@/") ? source.slice(2) : source;
  path = relative(cwd, resolve(base, target)).split(sep).join("/");
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
