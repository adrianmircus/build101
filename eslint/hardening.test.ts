import { describe, expect, it } from "vitest";
import { ruleIdsFor, ruleMessages } from "./lint.helper";

const LAYERS = "tiza/layers";
const LEGACY = "tiza/no-legacy-imports";
const SERVER_ONLY = "tiza/require-server-only";
const STATIC = "tiza/static-import-target";

const imp = (source: string) => `import { x } from "${source}";\nexport const y = x;\n`;

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
