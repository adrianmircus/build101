import { describe, expect, it } from "vitest";
import { blockingProblems, createLabel, draftRows, noteFor, problemText, problemsTitle, rowProblems } from "./usernameReview";

const ROWS = draftRows([
  { displayName: "Lucía Fernández", username: "luciaf" },
  { displayName: "Lucía Fagúndez", username: "luciaf2" },
  { displayName: "Mateo Silva", username: "mateos" },
]);

describe("rowProblems", () => {
  it("sin problemas no marca nada", () => {
    expect(rowProblems(ROWS)).toEqual({});
  });

  it("si el admin deja dos iguales, marca las dos filas", () => {
    const rows = ROWS.map((row, index) => (index === 1 ? { ...row, username: " LUCIAF " } : row));
    expect(rowProblems(rows)).toEqual({ "fila-0": "repeated", "fila-1": "repeated" });
  });

  it("marca el vacío y los que tienen tildes, espacios o son muy cortos", () => {
    const edit = (value: string) => ROWS.map((row, index) => (index === 2 ? { ...row, username: value } : row));
    expect(rowProblems(edit(""))["fila-2"]).toBe("empty");
    expect(rowProblems(edit("lucía"))["fila-2"]).toBe("invalid");
    expect(rowProblems(edit("ma teo"))["fila-2"]).toBe("invalid");
    expect(rowProblems(edit("m"))["fila-2"]).toBe("invalid");
    expect(rowProblems(edit("mateo.s_2-b"))["fila-2"]).toBeUndefined();
  });

  it("lo que devolvió el servidor se marca, y un repetido va primero", () => {
    expect(rowProblems(ROWS, { "fila-2": "taken", "fila-0": "failed" })).toEqual({ "fila-2": "taken", "fila-0": "failed" });
  });

  it("cada problema tiene un texto en castellano", () => {
    for (const problem of ["empty", "invalid", "repeated", "taken", "failed"] as const) expect(problemText(problem)).toMatch(/\.$/);
  });
});

describe("noteFor", () => {
  it("explica el número que se suma y el cambio del admin", () => {
    expect(noteFor(ROWS[0]!)).toBeNull();
    expect(noteFor(ROWS[1]!)).toBe("Ya había alguien con ese usuario, por eso lleva un número.");
    expect(noteFor({ ...ROWS[0]!, username: "lucia.f" })).toBe("Lo cambiaste vos.");
  });
});

describe("textos", () => {
  it("cuenta en singular y plural", () => {
    expect(createLabel(1)).toBe("Crear 1 cuenta");
    expect(createLabel(3)).toBe("Crear 3 cuentas");
    expect(problemsTitle(1)).toBe("Hay 1 usuario para corregir");
    expect(problemsTitle(2)).toBe("Hay 2 usuarios para corregir");
  });
});

describe("blockingProblems", () => {
  it("lista lo que frena el confirmar, con el nombre del estudiante, y deja pasar lo que se puede reintentar", () => {
    const rows = ROWS.map((row, index) => (index === 1 ? { ...row, username: "luciaf" } : row));
    expect(blockingProblems(rows, { "fila-2": "failed" }).map((item) => item.summary)).toEqual([
      "Lucía Fernández: el usuario está repetido",
      "Lucía Fagúndez: el usuario está repetido",
    ]);
    expect(blockingProblems(ROWS, { "fila-2": "taken" })[0]).toMatchObject({ field: "usr-fila-2", message: "Justo alguien tomó este usuario. Elegí otro." });
    expect(blockingProblems(ROWS, { "fila-2": "failed" })).toEqual([]);
  });
});
