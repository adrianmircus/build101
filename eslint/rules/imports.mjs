// Shared by the import-based rules: finds every module specifier (import, re-export and dynamic
// import()) and resolves it to a repo-relative path, so a rule judges the real file and not the
// spelling ("@/lib/x", "../x" or "../../lib/./x" are the same thing).
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";

const EXT = /\.(?:ts|tsx|mjs|js)$/;
// Windows device prefixes (\\?\C:\…, \\.\C:\…) name the same file as C:\….
const DEVICE = /^\/\/[?.]\//;
const CANDIDATES = ["", ".ts", ".tsx", ".d.ts", ".mts", ".cts", ".mjs", ".js", "/index.ts", "/index.tsx"];
// TypeScript maps a written .js/.jsx/.mjs/.cjs (or .ts/.tsx) to the source file, so "./x.js" is ./x.ts.
const WRITTEN_EXT = /\.(?:d\.ts|[cm]?[jt]sx?)$/;

/**
 * The real path of the file a spelling points to. realpath gives the file's real case and expands
 * 8.3 short names, so "@/LIB/server/x.js" or "C:/…/WORKTR~1/…" on Windows is judged as the file it is.
 * When no file matches, Windows still resolves it case-insensitively, so the path is compared in
 * lowercase there (every layer root is lowercase). Elsewhere a missing file can't be imported at all.
 */
function realFile(spelled) {
  const stems = [spelled, spelled.replace(WRITTEN_EXT, "")];
  const hit = stems.flatMap((stem) => CANDIDATES.map((ext) => stem + ext)).find((candidate) => existsSync(candidate));
  if (hit) return realpathSync.native(hit);
  return process.platform === "win32" ? spelled.toLowerCase() : spelled;
}

const resolvers = new Map();

/** TypeScript's own resolver with this repo's tsconfig (paths, moduleResolution), cached per root. */
function typeScriptResolver(cwd) {
  if (!resolvers.has(cwd)) {
    const file = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
    const config = file ? ts.readConfigFile(file, ts.sys.readFile).config : {};
    const options = ts.parseJsonConfigFileContent(config, ts.sys, file ? dirname(file) : cwd).options;
    const cache = ts.createModuleResolutionCache(cwd, (name) => name, options);
    resolvers.set(cwd, { options, cache });
  }
  return resolvers.get(cwd);
}

/**
 * The file tsc would load for this specifier, whatever its spelling ("typescript/../../lib/x",
 * "@/LIB/x.js", "\\\\?\\C:\\…"): the layer rules judge that file, never the text. Undefined when
 * TypeScript can't resolve it (then nothing compiles either, and the lexical check below still runs).
 */
function viaTypeScript(rawSource, filename, cwd) {
  const { options, cache } = typeScriptResolver(cwd);
  const resolved = ts.resolveModuleName(rawSource, filename, options, ts.sys, cache).resolvedModule;
  return resolved ? realpathSync.native(resolved.resolvedFileName) : undefined;
}

function repoRelative(absolute, cwd) {
  const root = existsSync(cwd) ? realpathSync.native(cwd) : cwd;
  const path = relative(root, absolute).split(sep).join("/");
  // Outside the repo, or a package in node_modules: not our layers.
  if (path === ".." || path.startsWith("../") || path.startsWith("node_modules/")) return null;
  return path.replace(/\.d\.ts$/, "").replace(EXT, "").replace(/\/index$/, "");
}

/** Repo-relative path without extension, or null for packages and paths outside the repo. */
export function resolveSource(rawSource, filename, cwd) {
  const real = viaTypeScript(rawSource, filename, cwd);
  if (real !== undefined) return repoRelative(real, cwd);
  return resolveLexically(rawSource, filename, cwd);
}

function resolveLexically(rawSource, filename, cwd) {
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
  return repoRelative(realFile(resolve(base, target)), cwd);
}

export const repoPath = (filename, cwd) => relative(cwd, filename).split(sep).join("/").replace(EXT, "");

export const within = (path, root) => path === root || path.startsWith(`${root}/`);

/** The specifier of an import() call when it is a literal or a template without interpolations. */
export function staticTarget(source) {
  if (source.type === "Literal" && typeof source.value === "string") return source.value;
  if (source.type === "TemplateLiteral" && source.expressions.length === 0) return source.quasis[0]?.value.cooked ?? null;
  return null;
}

// `/// <reference path="…" />` pulls a file into the program just like an import does.
const REFERENCE = /^\/\s*<reference\s+path\s*=\s*["']([^"']+)["']/;

const literalOf = (node) => (node?.type === "Literal" && typeof node.value === "string" ? node.value : null);

/**
 * Visitors that call `onSource(node, specifier)` for every way a TypeScript file can name another
 * module: import/export declarations, import(), type-only `import("…").T`, `import x = require("…")`
 * and triple-slash path references.
 */
export function importVisitors(onSource, context) {
  const report = (node, specifier) => specifier !== null && onSource(node, specifier);
  const fromDeclaration = (node) => report(node.source, literalOf(node.source));
  return {
    ImportDeclaration: fromDeclaration,
    ExportNamedDeclaration: fromDeclaration,
    ExportAllDeclaration: fromDeclaration,
    ImportExpression: (node) => report(node.source, staticTarget(node.source)),
    TSImportType: (node) => report(node, literalOf(node.argument?.literal ?? node.argument)),
    TSExternalModuleReference: (node) => report(node, literalOf(node.expression)),
    Program() {
      for (const comment of context?.sourceCode.getAllComments() ?? []) {
        const path = comment.type === "Line" ? REFERENCE.exec(comment.value)?.[1] : undefined;
        if (path) report(comment, path.startsWith(".") || path.startsWith("/") ? path : `./${path}`);
      }
    },
  };
}
