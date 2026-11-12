import { describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/lib/errors";
import { NEW_GROUP, createReducer, initialCreate, type CreateAction, type Fields } from "./createFlowState";
import { confirmCreate, createRows, groupFor, nextAttempt, partialText, previewRows, type CreateActions } from "./createSteps";
import { draftRows } from "./usernameReview";

const FIELDS: Fields = { groupChoice: NEW_GROUP, groupName: " 4.º B ", subjectId: "math", schoolYear: "2026", names: "Lucía Fernández\nMateo Silva" };
const unavailable = fail("UNAVAILABLE", "Todavía no está disponible.");

function actions(over: Partial<CreateActions> = {}): CreateActions {
  return {
    preview: vi.fn(async () => ok([{ displayName: "Lucía Fernández", username: "luciaf" }])),
    createGroup: vi.fn(async () => ok({ id: "g-nuevo" })),
    create: vi.fn(async () => ok([{ index: 0, outcome: "created" as const, studentId: "s1" }])),
    ...over,
  };
}

describe("previewRows", () => {
  it("manda los nombres limpios y devuelve las filas a revisar", async () => {
    const a = actions();
    const result = await previewRows({ institutionId: "i1", actions: a }, " Lucía   Fernández \n\nMateo Silva");
    expect(a.preview).toHaveBeenCalledWith({ institutionId: "i1", names: ["Lucía Fernández", "Mateo Silva"] });
    expect(result).toEqual({ ok: true, value: draftRows([{ displayName: "Lucía Fernández", username: "luciaf" }]) });
  });

  it("con un servicio que todavía no anda, el texto es neutro y no el del stub", async () => {
    const result = await previewRows({ institutionId: "i1", actions: actions({ preview: async () => unavailable }) }, "Ana Pérez");
    expect(result).toEqual({ ok: false, text: "No pudimos completar esto ahora. No es por vos: probá de nuevo en un rato." });
  });

  it("si la conexión se corta, también", async () => {
    const result = await previewRows({ institutionId: "i1", actions: actions({ preview: async () => Promise.reject(new TypeError("fetch failed")) }) }, "Ana Pérez");
    expect(result.ok).toBe(false);
  });
});

// The flow as the hook runs it: every dispatch goes through the real reducer, and each confirm starts from the state
// the screen would have, so a retry sees only what the first attempt left in it.
function flow(a: CreateActions, start = initialCreate(FIELDS)) {
  let state = start;
  const dispatch = (action: CreateAction) => {
    state = createReducer(state, action);
  };
  const run = () => confirmCreate({ institutionId: "i1", actions: a }, state, dispatch);
  return { run, dispatch, get state() { return state; } };
}
const keys = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0].opKey);
const lost = () => Promise.reject(new TypeError("fetch failed"));
const REVIEWED = { ...initialCreate(FIELDS), step: "review" as const, rows: draftRows([{ displayName: "Lucía Fernández", username: "luciaf" }]) };

describe("groupFor", () => {
  const ctx = (a: CreateActions) => ({ institutionId: "i1", actions: a });

  it("un grupo existente no crea nada", async () => {
    const a = actions();
    const state = initialCreate({ ...FIELDS, groupChoice: "g1" });
    expect(await groupFor(ctx(a), state, () => undefined)).toEqual({ ok: true, value: "g1" });
    expect(a.createGroup).not.toHaveBeenCalled();
  });

  it("uno nuevo se crea con el nombre sin espacios y el año como número", async () => {
    const a = actions();
    const result = await groupFor(ctx(a), initialCreate(FIELDS), () => undefined);
    expect(a.createGroup).toHaveBeenCalledWith(expect.objectContaining({ institutionId: "i1", name: "4.º B", subjectId: "math", schoolYear: 2026 }));
    expect(result).toEqual({ ok: true, value: "g-nuevo" });
  });

  it("si el grupo ya se creó, no se crea otro", async () => {
    const a = actions();
    expect(await groupFor(ctx(a), { ...initialCreate(FIELDS), groupId: "ya" }, () => undefined)).toEqual({ ok: true, value: "ya" });
    expect(a.createGroup).not.toHaveBeenCalled();
  });
});

describe("confirmCreate: las claves del pedido", () => {
  it("la clave del grupo está en el estado antes de que salga el pedido", async () => {
    let inState: string | undefined;
    const createGroup = vi.fn(async () => ((inState = f.state.groupAttempt?.opKey), ok({ id: "g-nuevo" })));
    const f = flow(actions({ createGroup }), REVIEWED);
    await f.run();
    expect(inState).toBeDefined();
    expect(keys(createGroup)).toEqual([inState]);
  });

  it("si se pierde la respuesta del grupo, el reintento usa la misma clave y no crea otro", async () => {
    const createGroup = vi.fn().mockImplementationOnce(lost).mockImplementation(async () => ok({ id: "g-nuevo" }));
    const f = flow(actions({ createGroup }), REVIEWED);
    expect((await f.run()).ok).toBe(false);
    expect((await f.run()).ok).toBe(true);
    const [first, second] = keys(createGroup);
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it("si el pedido falla con un error, también conserva la clave", async () => {
    const createGroup = vi.fn().mockImplementationOnce(async () => unavailable).mockImplementation(async () => ok({ id: "g-nuevo" }));
    const f = flow(actions({ createGroup }), REVIEWED);
    await f.run();
    await f.run();
    expect(keys(createGroup)[1]).toBe(keys(createGroup)[0]);
  });

  it("si el usuario cambia los datos del grupo, la clave se renueva", async () => {
    const createGroup = vi.fn(async () => unavailable);
    const f = flow(actions({ createGroup }), REVIEWED);
    await f.run();
    f.dispatch({ type: "field", name: "groupName", value: "4.º C" });
    await f.run();
    const [first, second] = keys(createGroup);
    expect(second).not.toBe(first);
  });

  it("con el grupo creado, un grupo nuevo con los mismos datos es otro pedido", async () => {
    const createGroup = vi.fn(async () => ok({ id: "g-nuevo" }));
    const f = flow(actions({ createGroup }), REVIEWED);
    await f.run();
    expect(f.state.groupAttempt).toBeNull();
  });

  it("si se pierde la respuesta de las cuentas, el reintento usa la misma clave", async () => {
    const create = vi.fn().mockImplementationOnce(lost).mockImplementation(async () => ok([{ index: 0, outcome: "created" as const, studentId: "s1" }]));
    const f = flow(actions({ create }), REVIEWED);
    expect((await f.run()).ok).toBe(false);
    expect((await f.run()).ok).toBe(true);
    expect(keys(create)[1]).toBe(keys(create)[0]);
    expect(keys(create)[0]).toBeDefined();
  });
});

describe("createRows", () => {
  it("manda los usuarios normalizados con la clave del pedido", async () => {
    const a = actions();
    const rows = draftRows([{ displayName: "Lucía Fernández", username: "luciaf" }]).map((row) => ({ ...row, username: " LuciaF " }));
    const attempt = nextAttempt({ ...initialCreate(FIELDS), rows }, "g1");
    const result = await createRows({ institutionId: "i1", actions: a }, { groupId: "g1", rows, attempt });
    expect(a.create).toHaveBeenCalledWith({ groupId: "g1", rows: [{ displayName: "Lucía Fernández", username: "luciaf", slot: 0 }], opKey: attempt.opKey });
    expect(result.ok).toBe(true);
  });
});

describe("una respuesta perdida al crear (F2-13)", () => {
  const ROWS = draftRows([
    { displayName: "Lucía Fernández", username: "luciaf" },
    { displayName: "Mateo Silva", username: "mateos" },
    { displayName: "Valentina Rodríguez", username: "valentinar" },
  ]);

  // The real reducer and the real steps; the server is a spy that answers what the real service answers for each case.
  function flow(answers: Array<Array<"created" | "uncertain" | "username_taken">>) {
    let state = createReducer(initialCreate({ ...FIELDS, groupChoice: "g1" }), { type: "reviewing", rows: ROWS });
    const dispatch = (action: CreateAction) => {
      state = createReducer(state, action);
    };
    const create = vi.fn(async (input: { rows: unknown[] }) => {
      const outcomes = answers.shift() ?? [];
      return ok(input.rows.map((_, index) => ({ index, outcome: outcomes[index] ?? "created", studentId: outcomes[index] === "uncertain" || outcomes[index] === "username_taken" ? null : `s${index}` })));
    });
    const confirm = async () => {
      const done = await confirmCreate({ institutionId: "i1", actions: actions({ create }) }, state, dispatch);
      if (done.ok) dispatch({ type: "results", results: done.value });
    };
    return { create, confirm, dispatch, state: () => state };
  }

  it("el reintento manda la misma clave del pedido y el mismo slot de cada fila incierta", async () => {
    const f = flow([["created", "uncertain", "created"], ["created"]]);
    await f.confirm();
    expect(f.state().rows.map((row) => row.displayName)).toEqual(["Mateo Silva"]);
    expect(f.state().flags).toEqual({ "fila-1": "uncertain" });
    await f.confirm();
    const [first, second] = f.create.mock.calls.map(([input]) => input as { opKey: string; rows: Array<{ slot: number }> });
    expect(second?.opKey).toBe(first?.opKey);
    expect(first?.rows.map((row) => row.slot)).toEqual([0, 1, 2]);
    expect(second?.rows.map((row) => row.slot)).toEqual([1]);
    expect(f.state().step).toBe("done");
  });

  it("una fila incierta no se puede editar: el reintento sale con el mismo usuario y el mismo slot", async () => {
    const f = flow([["uncertain", "username_taken", "created"], ["created", "created"]]);
    await f.confirm();
    f.dispatch({ type: "edit", key: "fila-0", value: "lucia.fernandez" });
    f.dispatch({ type: "edit", key: "fila-1", value: "mateo.silva" });
    await f.confirm();
    const sent = f.create.mock.calls.map(([input]) => input as { opKey: string; rows: Array<{ slot: number; username: string }> });
    expect(sent[1]?.opKey).toBe(sent[0]?.opKey);
    // Only the row that was not uncertain took another identity.
    expect(sent[1]?.rows.map((row) => row.slot)).toEqual([0, 3]);
    expect(sent[1]?.rows.map((row) => row.username)).toEqual(["luciaf", "mateo.silva"]);
  });
});

describe("partialText", () => {
  it("cuenta lo creado y lo que queda", () => {
    expect(partialText(2, 1)).toBe("Se crearon 2 cuentas. Queda 1 por revisar: miralo abajo.");
    expect(partialText(1, 3)).toBe("Se creó 1 cuenta. Quedan 3 por revisar: miralo abajo.");
    expect(partialText(0, 2)).toBe("Quedan 2 por revisar: miralo abajo.");
  });
});
