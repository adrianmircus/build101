import { describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/lib/errors";
import { NEW_GROUP, createReducer, initialCreate, type CreateAction, type Fields } from "./createFlowState";
import { confirmCreate, type CreateActions } from "./createSteps";
import { draftRows } from "./usernameReview";

// F2-13: the request of the accounts goes out, and its answer is lost. The real reducer and the real steps; the server is a spy.
const FIELDS: Fields = { groupChoice: "g1", groupName: "", subjectId: "math", schoolYear: "2026", names: "Lucía Fernández, Mateo Silva" };
const unavailable = fail("UNAVAILABLE", "Todavía no está disponible.");
const lost = () => Promise.reject(new TypeError("fetch failed"));

function actions(over: Partial<CreateActions> = {}): CreateActions {
  return {
    preview: vi.fn(async () => ok([])),
    createGroup: vi.fn(async () => ok({ id: "g-nuevo" })),
    create: vi.fn(async () => ok([{ index: 0, outcome: "created" as const, studentId: "s1" }])),
    ...over,
  };
}

function flow(a: CreateActions, start = initialCreate(FIELDS)) {
  let state = start;
  const dispatch = (action: CreateAction) => {
    state = createReducer(state, action);
  };
  const run = () => confirmCreate({ institutionId: "i1", actions: a }, state, dispatch);
  return { run, dispatch, get state() { return state; } };
}

describe("se pierde la respuesta entera de crear (F2-13)", () => {
  const ROWS = draftRows([
    { displayName: "Lucía Fernández", username: "luciaf" },
    { displayName: "Mateo Silva", username: "mateos" },
  ]);
  const start = () => ({ ...initialCreate({ ...FIELDS, groupChoice: "g1" }), step: "review" as const, rows: ROWS });

  it("mientras el pedido está en el aire, las filas están en curso: no se editan ni se vuelve a los nombres", async () => {
    let seen: ReturnType<typeof flow>["state"] | null = null;
    const f = flow(actions({ create: vi.fn(async () => (seen = f.state, ok([]))) }), start());
    await f.run();
    expect(seen!.flags).toEqual({ "fila-0": "sending", "fila-1": "sending" });
    // The reducer ignores both while the request is out.
    const during = seen!;
    expect(createReducer(during, { type: "edit", key: "fila-0", value: "otro" })).toBe(during);
    expect(createReducer(during, { type: "back" })).toBe(during);
  });

  it("confirma, se pierde la respuesta, se intenta editar y reintenta: las filas quedan inciertas, no se editan y no hay un segundo estudiante", async () => {
    const students = new Map<string, string>(); // what the server holds: opKey + slot -> username
    const create = vi
      .fn()
      .mockImplementationOnce(async (input: { opKey: string; rows: Array<{ slot: number; username: string }> }) => {
        for (const row of input.rows) students.set(`${input.opKey}:${row.slot}`, row.username); // it was created...
        return lost(); // ...and the answer never came
      })
      .mockImplementationOnce(async (input: { opKey: string; rows: Array<{ slot: number; username: string }> }) => {
        for (const row of input.rows) students.set(`${input.opKey}:${row.slot}`, row.username);
        return ok(input.rows.map((_, index) => ({ index, outcome: "created" as const, studentId: `s${index}` })));
      });
    const f = flow(actions({ create }), start());
    const first = await f.run();
    expect(first.ok).toBe(false);
    expect(f.state.flags).toEqual({ "fila-0": "uncertain", "fila-1": "uncertain" });
    expect(f.state.rows.map((row) => row.slot)).toEqual([0, 1]);

    // What the screen allows now: nothing to edit, no way back.
    f.dispatch({ type: "edit", key: "fila-0", value: "lucia.fernandez" });
    f.dispatch({ type: "edit", key: "fila-1", value: "mateo.silva" });
    f.dispatch({ type: "back" });
    expect(f.state.step).toBe("review");
    expect(f.state.rows.map((row) => row.username)).toEqual(["luciaf", "mateos"]);

    const second = await f.run();
    if (second.ok) f.dispatch({ type: "results", results: second.value });
    const [a, b] = create.mock.calls.map(([input]) => input as { opKey: string; rows: Array<{ slot: number; username: string }> });
    expect(b?.opKey).toBe(a?.opKey);
    expect(b?.rows).toEqual(a?.rows);
    expect(students.size).toBe(2); // the same two students, not four
    expect(f.state.step).toBe("done");
  });

  it("una falla de la acción entera (no solo la conexión) también deja las filas inciertas", async () => {
    const f = flow(actions({ create: vi.fn(async () => unavailable) }), start());
    await f.run();
    expect(f.state.flags).toEqual({ "fila-0": "uncertain", "fila-1": "uncertain" });
  });

  it("si falla el grupo, no salió ningún pedido de cuentas: las filas no quedan marcadas", async () => {
    const f = flow(actions({ createGroup: vi.fn(async () => unavailable) }), { ...start(), fields: { ...FIELDS, groupChoice: NEW_GROUP, groupName: "4.º B" } });
    await f.run();
    expect(f.state.flags).toEqual({});
  });
});
