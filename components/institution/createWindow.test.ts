import { describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/lib/errors";
import { NEW_GROUP, createReducer, initialCreate, type CreateAction, type Fields } from "./createFlowState";
import { confirmCreate, type CreateActions } from "./createSteps";
import { draftRows } from "./usernameReview";

const FIELDS: Fields = { groupChoice: NEW_GROUP, groupName: "4.º B", subjectId: "math", schoolYear: "2026", names: "Lucía Fernández" };
const unavailable = fail("UNAVAILABLE", "Todavía no está disponible.");

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
const keys = (fn: unknown) => (fn as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0].opKey);

describe("confirmCreate: la ventana mientras se crea el grupo (F2-13)", () => {
  const two = { ...initialCreate(FIELDS), step: "review" as const, rows: draftRows([{ displayName: "Lucía Fernández", username: "luciaf" }]), nextSlot: 1 };

  it("mientras espera el grupo no se puede editar ni volver; la fila sale con su identidad original y no quedan dos estudiantes", async () => {
    let answerGroup!: (value: ReturnType<typeof ok<{ id: string }>>) => void;
    const createGroup = vi.fn(() => new Promise<ReturnType<typeof ok<{ id: string }>>>((resolve) => (answerGroup = resolve)));
    const create = vi.fn(async () => ok([{ index: 0, outcome: "created" as const, studentId: "s1" }]));
    const f = flow(actions({ createGroup, create }), two);
    const original = f.state.rows[0];
    const running = f.run();
    expect(f.state.flags[original.key]).toBe("sending");
    f.dispatch({ type: "edit", key: original.key, value: "otrousuario" });
    f.dispatch({ type: "back" });
    expect(f.state.rows[0]).toEqual(original);
    expect(f.state.step).toBe("review");
    answerGroup(ok({ id: "g-nuevo" }));
    await running;
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ rows: [expect.objectContaining({ username: original.username, slot: original.slot })] }));
  });

  it("si el grupo falla, se desbloquea y el reintento usa la misma clave del grupo", async () => {
    const createGroup = vi.fn().mockImplementationOnce(async () => unavailable).mockImplementation(async () => ok({ id: "g-nuevo" }));
    const f = flow(actions({ createGroup }), two);
    await f.run();
    expect(f.state.flags).toEqual({});
    const key = f.state.rows[0].key;
    f.dispatch({ type: "edit", key, value: "otrousuario" });
    expect(f.state.rows[0].username).toBe("otrousuario");
    await f.run();
    expect(keys(createGroup)[1]).toBe(keys(createGroup)[0]);
  });
});
