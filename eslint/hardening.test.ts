import { execSync } from "node:child_process";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { ruleIdsFor, ruleMessages } from "./lint.helper";

const LAYERS = "tiza/layers";
const LEGACY = "tiza/no-legacy-imports";
const SERVER_ONLY = "tiza/require-server-only";
const STATIC = "tiza/static-import-target";

// JSON.stringify keeps backslashes in the specifier instead of turning them into escape sequences.
const imp = (source: string) => `import { x } from ${JSON.stringify(source)};\nexport const y = x;\n`;

describe("aliases are normalized like relative paths", () => {
  it.each([
    ["lib/domain/a.ts", "@/lib/domain/../server/log", LAYERS],
    ["components/a/B.tsx", "@/components/../lib/server/log", LAYERS],
    ["lib/server/services/x.ts", "@/lib/server/services/../db/client", LAYERS],
    ["lib/server/services/x.ts", "@/lib/server/./db/client", LAYERS],
    ["lib/domain/a.ts", "@/lib/domain/../groups/store", LEGACY],
    ["lib/server/a.ts", "@/lib/./groups/store", LEGACY],
  ])("%s importing %s trips %s", async (file, source, rule) => {
    expect(await ruleIdsFor(imp(source), file)).toContain(rule);
  });
  it("still accepts a harmless normalized alias", async () => {
    const ids = await ruleIdsFor(imp("@/lib/domain/../errors"), "lib/domain/a.ts");
    expect(ids).not.toContain(LAYERS);
    expect(ids).not.toContain(LEGACY);
  });
});

describe("aliases and paths are canonicalized like TypeScript does", () => {
  it.each([
    ["lib/domain/a.ts", "@//lib/server/log", LAYERS],
    ["lib/domain/a.ts", "@///lib/server/log", LAYERS],
    ["lib/domain/a.ts", "@/lib\\server\\log", LAYERS],
    ["lib/domain/a.ts", "@\\/lib//domain/../server\\log", LAYERS],
    ["lib/domain/a.ts", "..\\server\\log", LAYERS],
    ["lib/domain/a.ts", "..//server//log", LAYERS],
    ["lib/server/services/x.ts", "@//lib/server/db//client", LAYERS],
    ["lib/server/services/x.ts", "..\\db\\client", LAYERS],
    ["lib/domain/a.ts", "@///lib/groups/store", LEGACY],
    ["lib/domain/a.ts", "@/lib\\groups\\store", LEGACY],
    ["lib/server/a.ts", "..\\groups\\store", LEGACY],
    ["lib/server/a.ts", "..//groups//store", LEGACY],
  ])("%s importing %s trips %s", async (file, source, rule) => {
    expect(await ruleIdsFor(imp(source), file)).toContain(rule);
  });
  it("covers namespace imports and dynamic import() too", async () => {
    const ns = 'import * as x from "@//lib/server/log";\nexport const y = x;\n';
    expect(await ruleIdsFor(ns, "lib/domain/a.ts")).toContain(LAYERS);
    const dyn = 'export const m = () => import("@///lib/groups/store");\n';
    expect(await ruleIdsFor(dyn, "lib/domain/a.ts")).toContain(LEGACY);
  });
  it("still accepts harmless spellings", async () => {
    const ids = await ruleIdsFor(imp("@//lib\\domain/../errors"), "lib/domain/a.ts");
    expect(ids).not.toContain(LAYERS);
    expect(ids).not.toContain(LEGACY);
  });
});

describe("paths that leave the repo and come back in", () => {
  // The worktree folder name is part of the spelling, so build it from the current repo.
  const repo = basename(process.cwd());
  it.each([
    [`@/../${repo}/lib/server/log`, LAYERS],
    [`@/../${repo}/lib/groups/store`, LEGACY],
    [`../../../${repo}/lib/server/log`, LAYERS],
    // Absolute paths, in both separator styles.
    [`${process.cwd().replaceAll("\\", "/")}/lib/server/log`, LAYERS],
    [`${process.cwd().replaceAll("/", "\\")}\\lib\\groups\\store`, LEGACY],
  ])("lib/domain/a.ts importing %s trips %s", async (source, rule) => {
    expect(await ruleIdsFor(imp(source), "lib/domain/a.ts")).toContain(rule);
  });
});

// Windows resolves these to the same file (case-insensitive, device prefixes, 8.3 short names), and so
// does TypeScript there. On Linux they point to files that don't exist, so tsc fails and they aren't a bypass.
describe.runIf(process.platform === "win32")("Windows spellings of the same file", () => {
  const cwd = process.cwd().replaceAll("\\", "/");
  const shortCwd = () => {
    const out = execSync(`for %I in ("${process.cwd()}") do @echo %~sI`, { shell: "cmd.exe" }).toString().trim();
    return out.replaceAll("\\", "/");
  };
  it.each([
    ["@/LIB/server/log", LAYERS],
    ["@/Lib/groups/store", LEGACY],
    [`//?/${cwd}/lib/server/log`, LAYERS],
    [`//./${cwd}/lib/groups/store`, LEGACY],
  ])("lib/domain/a.ts importing %s trips %s", async (source, rule) => {
    expect(await ruleIdsFor(imp(source), "lib/domain/a.ts")).toContain(rule);
  });
  it("follows 8.3 short names", async () => {
    expect(await ruleIdsFor(imp(`${shortCwd()}/lib/server/log`), "lib/domain/a.ts")).toContain(LAYERS);
  });
});

describe(".tsx in new code", () => {
  const dyn = "declare const name: string;\nexport const m = () => import(name);\n";
  it("is an error anywhere in lib/domain, with an explanation", async () => {
    const code = "export const a = 1;\n";
    expect(await ruleIdsFor(code, "lib/domain/a.tsx")).toContain("no-restricted-syntax");
    expect((await ruleMessages(code, "lib/domain/deep/a.tsx")).some((m) => m.includes("no admite archivos .tsx"))).toBe(true);
    expect(await ruleIdsFor(code, "lib/domain/a.ts")).not.toContain("no-restricted-syntax");
  });
  it.each(["lib/domain/a.tsx", "lib/server/a.tsx", "lib/client/a.tsx", "tests/a.tsx"])(
    "applies the new-code rules to %s",
    async (file) => {
      expect(await ruleIdsFor(dyn, file)).toContain(STATIC);
      const any = "export const f = (x: any) => x as number;\n";
      expect(await ruleIdsFor(any, file)).toContain("@typescript-eslint/no-explicit-any");
    },
  );
});

describe("dynamic import() targets", () => {
  const dyn = (target: string) => `export const m = () => import(${target});\n`;
  it("resolves a template literal without interpolations", async () => {
    expect(await ruleIdsFor(dyn("`react`"), "lib/domain/a.ts")).toContain(LAYERS);
    expect(await ruleIdsFor(dyn("`@/lib/domain/../groups/store`"), "lib/domain/a.ts")).toContain(LEGACY);
    expect(await ruleIdsFor(dyn("`@/lib/errors`"), "lib/domain/a.ts")).not.toContain(STATIC);
  });
  it.each(["`@/lib/${name}`", "name", "'a' + name"])("rejects %s in new code", async (target) => {
    const code = `declare const name: string;\nexport const m = () => import(${target});\n`;
    for (const file of ["lib/errors.ts", "lib/domain/a.ts", "lib/server/a.ts", "lib/client/a.ts", "tests/a.ts"]) {
      expect(await ruleIdsFor(code, file), file).toContain(STATIC);
    }
    const messages = await ruleMessages(code, "lib/domain/a.ts");
    expect(messages.some((m) => m.includes("string literal"))).toBe(true);
  });
  it("allows it in e2e tests and legacy code", async () => {
    const code = "declare const name: string;\nexport const m = () => import(name);\n";
    expect(await ruleIdsFor(code, "tests/e2e/a.ts")).not.toContain(STATIC);
    expect(await ruleIdsFor(code, "components/a/B.tsx")).not.toContain(STATIC);
  });
});

describe("server-only must be the exact side-effect import", () => {
  const lint = (code: string) => ruleIdsFor(`${code}\nexport const a = 1;\n`, "lib/server/x.ts");
  it.each([
    'import type {} from "server-only";',
    'import {} from "server-only";',
    'import x from "server-only";',
    'import type x from "server-only";',
  ])("flags %s", async (code) => {
    expect(await lint(code)).toContain(SERVER_ONLY);
  });
  it("accepts the correct import", async () => {
    expect(await lint('import "server-only";')).not.toContain(SERVER_ONLY);
    expect(await lint("import 'server-only'")).not.toContain(SERVER_ONLY);
  });
});
