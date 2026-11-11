// Shared by the import-based rules: finds every module specifier (import, re-export and dynamic
// import()) and resolves it to a repo-relative path, so a rule judges the real file and not the
// spelling ("@/lib/x", "../x" or "../../lib/./x" are the same thing).
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const EXT = /\.(?:ts|tsx|mjs|js)$/;
// Windows device prefixes (\\?\C:\…, \\.\C:\…) name the same file as C:\….
const DEVICE = /^\/\/[?.]\//;
const CANDIDATES = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

/**
 * The real path of the file a spelling points to. realpath gives the file's real case and expands
 * 8.3 short names, so "@/LIB/server/x" or "C:/…/WORKTR~1/…" on Windows is judged as the file it is.
 * A path that matches no file can't be imported either, so its lexical form is enough.
 */
function realFile(spelled) {
  const hit = CANDIDATES.map((ext) => spelled + ext).find((candidate) => existsSync(candidate));
  return hit ? realpathSync.native(hit) : spelled;
}

/** Repo-relative path without extension, or null for packages and paths outside the repo. */
export function resolveSource(rawSource, filename, cwd) {
  // Canonical spelling first, as TypeScript resolves it: backslashes are separators and repeated
  // slashes collapse, so "@//lib/x", "@///lib/x" and "..\\lib\\x" are the same module as "@/lib/x".
  const source = rawSource.replace(/\\/g, "/").replace(DEVICE, "").replace(/\/{2,}/g, "/");
  // Every form resolves to an absolute path first and only then becomes repo-relative, so a spelling
  // that leaves the repo and comes back ("@/../<repo folder>/lib/server/x") or an absolute path
  // ("C:/…/lib/server/x", "/…/lib/server/x") is still lib/server/x.
  const absolute = isAbsolute(source) || /^[A-Za-z]:\//.test(source);
  const base = source.startsWith("@/") ? cwd : source.startsWith(".") || absolute ? dirname(filename) : null;
  if (base === null) return null;
  const target = source.startsWith("@/") ? source.slice(2) : source;
  const root = existsSync(cwd) ? realpathSync.native(cwd) : cwd;
  const path = relative(root, realFile(resolve(base, target))).split(sep).join("/");
  if (path === ".." || path.startsWith("../")) return null;
  return path.replace(EXT, "").replace(/\/index$/, "");
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
