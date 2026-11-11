// Shared by the import-based rules: finds every module specifier (import, re-export and dynamic
// import()) and resolves it to a repo-relative path, so a rule judges the real file and not the
// spelling ("@/lib/x", "../x" or "../../lib/./x" are the same thing).
import { dirname, relative, resolve, sep } from "node:path";

const EXT = /\.(?:ts|tsx|mjs|js)$/;

/** Repo-relative path without extension, or null for packages and paths outside the repo. */
export function resolveSource(source, filename, cwd) {
  let path;
  if (source.startsWith("@/")) path = source.slice(2);
  else if (source.startsWith(".")) path = relative(cwd, resolve(dirname(filename), source)).split(sep).join("/");
  else return null;
  if (path.startsWith("..")) return null;
  return path.replace(EXT, "");
}

export const repoPath = (filename, cwd) => relative(cwd, filename).split(sep).join("/").replace(EXT, "");

export const within = (path, root) => path === root || path.startsWith(`${root}/`);

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
      if (node.source.type === "Literal" && typeof node.source.value === "string") {
        onSource(node.source, node.source.value);
      }
    },
  };
}
