import { describe, expect, it } from "vitest";
import { buildPlan, collectChanged, isSkipped, normalizePath, parseArgs, parseNullSeparated, resolveBase } from "./plan.mjs";

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
