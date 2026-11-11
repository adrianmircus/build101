import { describe, expect, it } from "vitest";
import { buildPlan, collectChanged, isSkipped, normalizePath, parseArgs, parseNullSeparated, phaseBranchFor, resolveBase } from "./plan.mjs";

const ids = (changed: string[]) => buildPlan(changed).map((s) => `${s.id}:${isSkipped(s) ? "skip" : "run"}`);

describe("collectChanged", () => {
  it("une el diff y los archivos sin trackear, sin repetidos y ordenados", () => {
    expect(collectChanged({ diff: ["lib/b.ts", "lib/a.ts"], untracked: ["lib/a.ts", "tests/new.test.ts"] })).toEqual([
      "lib/a.ts",
      "lib/b.ts",
      "tests/new.test.ts",
    ]);
  });
  it("normaliza las barras de Windows", () => {
    expect(collectChanged({ diff: ["lib\\server\\log.ts", ".\\proxy.ts"], untracked: ["lib/server/log.ts"] })).toEqual([
      "lib/server/log.ts",
      "proxy.ts",
    ]);
  });
  it("sin cambios devuelve una lista vacía", () => {
    expect(collectChanged({ diff: [], untracked: [] })).toEqual([]);
  });
});

describe("parseNullSeparated y normalizePath", () => {
  it("separa por NUL y descarta vacíos", () => {
    expect(parseNullSeparated("a.ts\0dir/b c.ts\0")).toEqual(["a.ts", "dir/b c.ts"]);
    expect(parseNullSeparated("")).toEqual([]);
  });
  it("cambia barras invertidas y saca el ./ inicial", () => {
    expect(normalizePath(".\\a\\b.ts")).toEqual("a/b.ts");
  });
});

describe("resolveBase y parseArgs", () => {
  it("el flag gana a la variable y esta al merge-base", () => {
    expect(resolveBase({ flag: "x", env: "y", mergeBase: "z" })).toEqual("x");
    expect(resolveBase({ env: "y", mergeBase: "z" })).toEqual("y");
    expect(resolveBase({ mergeBase: "z" })).toEqual("z");
    expect(resolveBase({})).toEqual(null);
  });
  it("lee --base en las dos formas", () => {
    expect(parseArgs(["--base", "main"])).toEqual({ base: "main" });
    expect(parseArgs(["--base=abc123"])).toEqual({ base: "abc123" });
    expect(parseArgs([])).toEqual({ base: undefined });
  });
  it("--base sin valor es un error claro", () => {
    expect(() => parseArgs(["--base"])).toThrow(/--base necesita/);
    expect(() => parseArgs(["--base", "--otro"])).toThrow(/--base necesita/);
  });
});

describe("buildPlan", () => {
  it("el typecheck corre siempre, incluso sin cambios", () => {
    expect(ids([])).toEqual(["typecheck:run", "lint:skip", "tests:skip", "database:skip"]);
  });
  it("solo docs y json: saltea lint y tests", () => {
    expect(ids(["docs/PLATAFORMA.md", "package.json"])).toEqual(["typecheck:run", "lint:skip", "tests:skip", "database:skip"]);
  });
  it("código: lint y tests reciben solo los archivos de código", () => {
    const [, lint, tests] = buildPlan(["components/B.tsx", "data/x.json", "docs/a.md", "lib/a.ts", "scripts/x.mjs"]);
    const code = ["components/B.tsx", "lib/a.ts", "scripts/x.mjs"];
    expect(lint).toMatchObject({ command: "npx", args: ["eslint", "--no-warn-ignored", ...code] });
    expect(tests).toMatchObject({ command: "npx", args: ["vitest", "related", "--run", "--passWithNoTests", ...code] });
  });
  it("un cambio en eslint/ corre las pruebas de las reglas, que vitest related no encuentra", () => {
    const expected = ["typecheck:run", "lint:run", "tests:run", "eslint-tests:run", "database:skip"];
    expect(ids(["eslint/rules/layers.mjs"])).toEqual(expected);
    expect(ids(["eslint.config.mjs"])).toEqual(expected);
    const step = buildPlan(["eslint/sizes.mjs"]).find((s) => s.id === "eslint-tests");
    expect(step).toMatchObject({ command: "npx", args: ["vitest", "run", "eslint"] });
  });
  it("sin cambios en eslint/ no corre esa tanda", () => {
    expect(ids(["lib/a.ts"])).not.toContain("eslint-tests:run");
  });
  it("supabase/ prende las pruebas de la base", () => {
    expect(ids(["supabase/migrations/001.sql"])).toEqual(["typecheck:run", "lint:skip", "tests:skip", "database:run"]);
    expect(buildPlan(["supabase/tests/a.sql"]).at(-1)).toMatchObject({ command: "supabase", args: ["test", "db"] });
  });
  it("una carpeta que solo se llama parecido no cuenta como supabase/", () => {
    expect(ids(["lib/supabase/client.ts"])[3]).toEqual("database:skip");
  });
  it("mezcla de todo: corre las cuatro", () => {
    expect(ids(["lib/a.ts", "supabase/x.sql"])).toEqual(["typecheck:run", "lint:run", "tests:run", "database:run"]);
  });
});

describe("phaseBranchFor", () => {
  it("deduce la rama de fase desde la de un ticket", () => {
    expect(phaseBranchFor("plataforma/t0-1-vitest")).toEqual("plataforma/fase-0");
    expect(phaseBranchFor("plataforma/t12-3-rls-de-grupos")).toEqual("plataforma/fase-12");
  });
  it("devuelve null con nombres que no siguen la convención", () => {
    for (const name of ["main", "plataforma/fase-0", "plataforma/t0-vitest", "plataforma/t0-1-", "feature/t0-1-vitest", "plataforma/t0-1-Vitest", "plataforma/ta-1-x"]) {
      expect(phaseBranchFor(name)).toEqual(null);
    }
  });
  it("una rama sin rama de fase queda a cargo del runner, que cae a main", () => {
    // The name alone says which phase branch to look for; whether it exists is checked against git.
    expect(phaseBranchFor("plataforma/t9-1-algo")).toEqual("plataforma/fase-9");
  });
});
