import { describe, expect, it } from "vitest";
import { ruleIdsFor } from "./lint.helper";

const SERVER_ONLY = "tiza/require-server-only";
const SIZE = "tiza/function-size";

const body = (lines: number) => Array.from({ length: lines }, (_, i) => `  const v${i} = ${i};`).join("\n");

describe("server-only", () => {
  it("flags a lib/server file without the import", async () => {
    expect(await ruleIdsFor("export const a = 1;\n", "lib/server/x.ts")).toContain(SERVER_ONLY);
  });
  it("accepts the import as first statement, even after a directive", async () => {
    const ids = await ruleIdsFor('"use strict";\nimport "server-only";\nexport const a = 1;\n', "lib/server/x.ts");
    expect(ids).not.toContain(SERVER_ONLY);
  });
  it("flags the import when it is not first", async () => {
    const code = 'import { z } from "zod";\nimport "server-only";\nexport const a = z;\n';
    expect(await ruleIdsFor(code, "lib/server/x.ts")).toContain(SERVER_ONLY);
  });
  it("skips tests and files outside lib/server", async () => {
    expect(await ruleIdsFor("export const a = 1;\n", "lib/server/x.test.ts")).not.toContain(SERVER_ONLY);
    expect(await ruleIdsFor("export const a = 1;\n", "lib/domain/x.ts")).not.toContain(SERVER_ONLY);
  });
});

describe("function size: component vs function", () => {
  const component = (n: number) => `export function Panel() {\n${body(n)}\n  return null;\n}\n`;
  const plain = (n: number) => `export function build() {\n${body(n)}\n  return 1;\n}\n`;

  it("allows a 100-line component in .tsx but not a 100-line function", async () => {
    expect(await ruleIdsFor(component(100), "components/x/Panel.tsx")).not.toContain(SIZE);
    expect(await ruleIdsFor(plain(100), "components/x/build.tsx")).toContain(SIZE);
  });
  it("flags a component over 150 lines", async () => {
    expect(await ruleIdsFor(component(160), "components/x/Panel.tsx")).toContain(SIZE);
  });
  it("treats an uppercase function in .ts as a plain function", async () => {
    expect(await ruleIdsFor(component(100), "lib/domain/panel.ts")).toContain(SIZE);
  });
  it("does not count blank lines or comments", async () => {
    const code = `export function build() {\n${"  // note\n\n".repeat(60)}  return 1;\n}\n`;
    expect(await ruleIdsFor(code, "lib/domain/x.ts")).not.toContain(SIZE);
  });
});

describe("new code rules", () => {
  it("forbids default exports, any and assertions but allows as const", async () => {
    const bad = "export default function f(a: unknown) { return a as string; }\nexport const b: any = 1;\n";
    const ids = await ruleIdsFor(bad, "lib/domain/x.ts");
    expect(ids).toEqual(
      expect.arrayContaining([
        "no-restricted-exports",
        "@typescript-eslint/no-explicit-any",
        "@typescript-eslint/consistent-type-assertions",
      ]),
    );
    expect(await ruleIdsFor('export const c = ["a"] as const;\n', "lib/domain/x.ts")).toEqual([]);
  });
  it("leaves legacy code alone", async () => {
    const code = "export default function f(a: unknown) { return a as string; }\n";
    expect(await ruleIdsFor(code, "lib/profiles.ts")).toEqual([]);
  });
});

describe("limits", () => {
  it("flags a file over 200 lines", async () => {
    const code = Array.from({ length: 201 }, (_, i) => `export const v${i} = ${i};`).join("\n");
    expect(await ruleIdsFor(code, "lib/domain/big.ts")).toContain("max-lines");
  });
  it("flags more than 3 parameters", async () => {
    const code = "export const f = (a: 1, b: 2, c: 3, d: 4) => a;\n";
    expect(await ruleIdsFor(code, "lib/domain/x.ts")).toContain("max-params");
  });
});

describe("new code cannot import legacy code", () => {
  const LEGACY = "tiza/no-legacy-imports";
  const imp = (source: string) => `import { x } from "${source}";\nexport const y = x;\n`;

  it.each([
    ["lib/domain/a.ts", "@/lib/groups/store"],
    ["lib/domain/a.ts", "../groups/store"],
    ["lib/server/services/a.ts", "@/lib/agent/client"],
    ["lib/server/services/a.ts", "../../auth/dal"],
    ["lib/client/a.ts", "@/components/ui/MathText"],
    ["tests/a.ts", "../app/api/x/route"],
    ["lib/errors.ts", "@/lib/contract"],
  ])("%s cannot import %s", async (file, source) => {
    expect(await ruleIdsFor(imp(source), file)).toContain(LEGACY);
  });

  it.each([
    ["lib/domain/a.ts", "@/lib/errors"],
    ["lib/domain/a.ts", "../errors"],
    ["lib/server/services/a.ts", "@/lib/server/log"],
    ["lib/server/services/a.ts", "../../domain/x"],
    ["lib/server/entry/a.ts", "../log"],
    ["lib/client/a.ts", "@/lib/client/callAction"],
    ["tests/a.ts", "../lib/server/log"],
    ["lib/domain/a.ts", "zod"],
  ])("%s can import %s", async (file, source) => {
    expect(await ruleIdsFor(imp(source), file)).not.toContain(LEGACY);
  });

  it("does not apply to legacy files", async () => {
    expect(await ruleIdsFor(imp("@/lib/groups/store"), "lib/profiles.ts")).not.toContain(LEGACY);
  });
});

describe("function size: wrappers and tests", () => {
  const wrap = (open: string, close: string) => `${open}
${body(60)}
  return null;
${close}
`;

  it("takes the variable name for memo and forwardRef components", async () => {
    const file = "components/x/Panel.tsx";
    expect(await ruleIdsFor(wrap("export const Panel = memo(function () {", "});"), file)).not.toContain(SIZE);
    expect(await ruleIdsFor(wrap("export const Panel = memo(() => {", "});"), file)).not.toContain(SIZE);
    const forward = wrap("export const Field = React.forwardRef((props, ref) => {", "});");
    expect(await ruleIdsFor(forward, file)).not.toContain(SIZE);
    expect(await ruleIdsFor(wrap("export const panel = memo(() => {", "});"), file)).toContain(SIZE);
  });

  it("exempts only the callbacks of describe, it, test and hooks in tests", async () => {
    const suite = `describe("a", () => {\n${body(80)}\n  it("b", async () => {\n${body(60)}\n  });\n  beforeEach(() => {\n${body(60)}\n  });\n});\n`;
    const ids = await ruleIdsFor(`import { describe, it, beforeEach } from "vitest";\n${suite}`, "lib/domain/x.test.ts");
    expect(ids).not.toContain(SIZE);
    const steps = `test("a", async () => {\n  await test.step("s", async () => {\n${body(60)}\n  });\n});\n`;
    expect(await ruleIdsFor(steps, "tests/e2e/a.spec.ts")).not.toContain(SIZE);
    const each = `it.each([1])("a", () => {\n${body(60)}\n});\n`;
    expect(await ruleIdsFor(each, "lib/domain/x.test.ts")).not.toContain(SIZE);
  });

  it("still fails a long helper inside a test file", async () => {
    const helper = `function setup() {\n${body(80)}\n  return 1;\n}\nit("a", () => { setup(); });\n`;
    expect(await ruleIdsFor(helper, "lib/domain/x.test.ts")).toContain(SIZE);
    expect(await ruleIdsFor(helper, "tests/e2e/a.spec.ts")).toContain(SIZE);
  });
});

describe("new code: no non-null assertion and no @ts comments", () => {
  const NON_NULL = "@typescript-eslint/no-non-null-assertion";
  const BAN = "@typescript-eslint/ban-ts-comment";

  it("flags the ! operator", async () => {
    expect(await ruleIdsFor("export const f = (a: string | null) => a!.length;\n", "lib/domain/x.ts")).toContain(NON_NULL);
  });
  it.each(["@ts-ignore", "@ts-expect-error", "@ts-nocheck"])("flags %s", async (directive) => {
    const code = `// ${directive} because of a reason\nexport const a: number = "x";\n`;
    expect(await ruleIdsFor(code, "lib/server/x.ts")).toContain(BAN);
  });
  it("does not apply to legacy files", async () => {
    expect(await ruleIdsFor("export const f = (a: string | null) => a!.length;\n", "lib/profiles.ts")).not.toContain(NON_NULL);
  });
});

describe("new code: server-only in .tsx and strict scope", () => {
  it("requires server-only in lib/server/**/*.tsx", async () => {
    expect(await ruleIdsFor("export const A = () => null;\n", "lib/server/ui/A.tsx")).toContain(SERVER_ONLY);
    expect(await ruleIdsFor('import "server-only";\nexport const A = () => null;\n', "lib/server/ui/A.tsx")).not.toContain(SERVER_ONLY);
  });
});
