import { describe, expect, it } from "vitest";
import { attemptFor } from "./opKey";
import { MAX_NAMES, namesProblem, parseNames } from "./nameList";
import { NEW_GROUP, createReducer, initialCreate, pasteProblems, requestSignature, type Fields } from "./createFlowState";
import { draftRows } from "./usernameReview";

const FIELDS: Fields = { groupChoice: NEW_GROUP, groupName: "4.º B", subjectId: "math", schoolYear: "2026", names: "Lucía Fernández\nMateo Silva" };
const YEARS = { min: 2020, max: 2100 };
const ROWS = draftRows([
  { displayName: "Lucía Fernández", username: "luciaf" },
  { displayName: "Mateo Silva", username: "mateos" },
  { displayName: "Valentina Rodríguez", username: "valentinar" },
]);

function reviewing() {
  return createReducer(initialCreate(FIELDS), { type: "reviewing", rows: ROWS });
}

describe("parseNames", () => {
  it("una línea por nombre, sin vacías y con los espacios y tabs normalizados", () => {
    expect(parseNames("  Lucía   Fernández \n\n\tMateo\tSilva\r\n")).toEqual(["Lucía Fernández", "Mateo Silva"]);
  });

  it("pide al menos uno, y no más de 60", () => {
    expect(namesProblem([])).toBe("empty");
    expect(namesProblem(Array.from({ length: MAX_NAMES + 1 }, (_, i) => `Nombre ${i}`))).toBe("too_many");
    expect(namesProblem(["x".repeat(121)])).toBe("too_long");
    expect(namesProblem(["Ana Pérez"])).toBeNull();
  });
});

describe("pasteProblems", () => {
  it("con todo bien no marca nada", () => {
    expect(pasteProblems(FIELDS, ["math"], YEARS)).toEqual([]);
  });

  it("un grupo nuevo pide nombre, materia y año, cada uno con su campo", () => {
    const fields = { ...FIELDS, groupName: " ", subjectId: "", schoolYear: "26" };
    expect(pasteProblems(fields, ["math"], YEARS).map((problem) => problem.field)).toEqual(["cr-grupo-nombre", "cr-grupo-materia", "cr-grupo-anio"]);
  });

  it("un grupo existente no pide los datos del grupo, pero sí los nombres", () => {
    const fields = { ...FIELDS, groupChoice: "grupo-1", groupName: "", subjectId: "", names: "" };
    expect(pasteProblems(fields, ["math"], YEARS).map((problem) => problem.field)).toEqual(["cr-nombres"]);
  });
});

describe("createReducer", () => {
  it("pasa a revisar con las filas y vuelve a los nombres sin perder lo escrito", () => {
    const back = createReducer(reviewing(), { type: "back" });
    expect(back.step).toBe("paste");
    expect(back.fields).toEqual(FIELDS);
  });

  it("cambiar un usuario limpia la marca de esa fila y le da otra identidad; las demás conservan la suya", () => {
    let state = createReducer(reviewing(), { type: "started", groupId: "g", attempt: { opKey: "k", signature: "s" } });
    state = createReducer(state, { type: "results", results: [{ index: 1, outcome: "username_taken", studentId: null }, { index: 0, outcome: "created", studentId: "a" }, { index: 2, outcome: "created", studentId: "b" }] });
    expect(state.flags).toEqual({ "fila-1": "taken" });
    state = createReducer(state, { type: "edit", key: "fila-1", value: "mateos2" });
    expect(state.flags).toEqual({});
    expect(state.rows[0]?.username).toBe("mateos2");
    expect(state.attempt).toEqual({ opKey: "k", signature: "s" });
    expect(state.rows[0]?.slot).toBe(3);
    expect(createReducer(state, { type: "edit", key: "fila-1", value: " MateoS2 " }).rows[0]?.slot).toBe(3);
  });

  it("una fila incierta se queda con su identidad y la clave del pedido para reintentar", () => {
    let state = createReducer(reviewing(), { type: "started", groupId: "g", attempt: { opKey: "k", signature: "s" } });
    state = createReducer(state, { type: "results", results: [{ index: 0, outcome: "created", studentId: "a" }, { index: 1, outcome: "uncertain", studentId: null }, { index: 2, outcome: "created", studentId: "c" }] });
    expect(state.flags).toEqual({ "fila-1": "uncertain" });
    expect(state.rows.map((row) => row.slot)).toEqual([1]);
    expect(state.attempt?.opKey).toBe("k");
  });

  it("una fila incierta no cambia de usuario ni de identidad, y no se puede volver a los nombres (F2-13)", () => {
    let state = createReducer(reviewing(), { type: "started", groupId: "g", attempt: { opKey: "k", signature: "s" } });
    state = createReducer(state, { type: "results", results: [{ index: 0, outcome: "created", studentId: "a" }, { index: 1, outcome: "uncertain", studentId: null }, { index: 2, outcome: "created", studentId: "c" }] });
    expect(createReducer(state, { type: "edit", key: "fila-1", value: "otro.usuario" })).toBe(state);
    expect(createReducer(state, { type: "back" })).toBe(state);
    expect(state.step).toBe("review");
  });

  it("si se crearon todas, termina y cuenta las creadas", () => {
    const state = createReducer(reviewing(), {
      type: "results",
      results: ROWS.map((_, index) => ({ index, outcome: "created" as const, studentId: `id-${index}` })),
    });
    expect(state.step).toBe("done");
    expect(state.createdIds).toEqual(["id-0", "id-1", "id-2"]);
    expect(state.rows).toEqual([]);
  });

  it("si una falla, las creadas salen de la lista y la que falló queda para probar de nuevo", () => {
    const state = createReducer(reviewing(), {
      type: "results",
      results: [{ index: 0, outcome: "created", studentId: "a" }, { index: 1, outcome: "failed", studentId: null }, { index: 2, outcome: "created", studentId: "c" }],
    });
    expect(state.step).toBe("review");
    expect(state.rows.map((row) => row.key)).toEqual(["fila-1"]);
    expect(state.flags).toEqual({ "fila-1": "failed" });
    expect(state.createdIds).toEqual(["a", "c"]);
  });

  it("cambiar de grupo o de datos del grupo olvida el grupo ya creado; cambiar los nombres no", () => {
    const made = createReducer(initialCreate(FIELDS), { type: "groupReady", groupId: "g1" });
    expect(createReducer(made, { type: "field", name: "groupName", value: "5.º" }).groupId).toBeNull();
    expect(createReducer(made, { type: "field", name: "names", value: "x" }).groupId).toBe("g1");
  });
});

describe("opKey de un pedido", () => {
  it("el mismo pedido reusa la clave aunque se edite una fila (esa cambia de identidad); otro grupo da otra clave", () => {
    let count = 0;
    const fresh = () => `k${(count += 1)}`;
    const state = reviewing();
    const first = attemptFor(null, requestSignature(state), fresh);
    expect(attemptFor(first, requestSignature(state), fresh)).toBe(first);
    const edited = createReducer(state, { type: "edit", key: "fila-0", value: "lucia.f" });
    expect(attemptFor(first, requestSignature(edited), fresh)).toBe(first);
    expect(edited.rows[0]?.slot).toBe(3);
    expect(attemptFor(first, requestSignature({ ...state, groupId: "g" }), fresh).opKey).toBe("k2");
  });
});
