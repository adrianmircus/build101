import { describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/lib/errors";
import { NEW_GROUP, initialCreate, type Fields } from "./createFlowState";
import { createRows, groupFor, nextAttempt, partialText, previewRows, type CreateActions } from "./createSteps";
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

describe("groupFor", () => {
  const ctx = (a: CreateActions) => ({ institutionId: "i1", actions: a });

  it("un grupo existente no crea nada", async () => {
    const a = actions();
    const state = initialCreate({ ...FIELDS, groupChoice: "g1" });
    expect(await groupFor(ctx(a), state, null)).toEqual({ ok: true, value: { id: "g1", attempt: null } });
    expect(a.createGroup).not.toHaveBeenCalled();
  });

  it("uno nuevo se crea con el nombre sin espacios y el año como número", async () => {
    const a = actions();
    const result = await groupFor(ctx(a), initialCreate(FIELDS), null);
    expect(a.createGroup).toHaveBeenCalledWith(expect.objectContaining({ institutionId: "i1", name: "4.º B", subjectId: "math", schoolYear: 2026 }));
    expect(result.ok && result.value.id).toBe("g-nuevo");
  });

  it("si ya se creó, no se crea otro; y si falló, el reintento usa la misma clave", async () => {
    const a = actions({ createGroup: vi.fn(async () => unavailable) });
    const first = await groupFor(ctx(a), initialCreate(FIELDS), null);
    expect(first.ok).toBe(false);
    const key = (a.createGroup as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].opKey;
    const again = actions();
    await groupFor(ctx(again), initialCreate(FIELDS), { opKey: key, signature: JSON.stringify([" 4.º B ", "math", "2026"]) });
    expect((again.createGroup as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].opKey).toBe(key);
    const made = await groupFor(ctx(again), { ...initialCreate(FIELDS), groupId: "ya" }, null);
    expect(made).toEqual({ ok: true, value: { id: "ya", attempt: null } });
  });
});

describe("createRows", () => {
  it("manda los usuarios normalizados con la clave del pedido", async () => {
    const a = actions();
    const rows = draftRows([{ displayName: "Lucía Fernández", username: "luciaf" }]).map((row) => ({ ...row, username: " LuciaF " }));
    const attempt = nextAttempt({ ...initialCreate(FIELDS), rows }, "g1");
    const result = await createRows({ institutionId: "i1", actions: a }, { groupId: "g1", rows, attempt });
    expect(a.create).toHaveBeenCalledWith({ groupId: "g1", rows: [{ displayName: "Lucía Fernández", username: "luciaf" }], opKey: attempt.opKey });
    expect(result.ok).toBe(true);
  });
});

describe("partialText", () => {
  it("cuenta lo creado y lo que queda", () => {
    expect(partialText(2, 1)).toBe("Se crearon 2 cuentas. Queda 1 por revisar: miralo abajo.");
    expect(partialText(1, 3)).toBe("Se creó 1 cuenta. Quedan 3 por revisar: miralo abajo.");
    expect(partialText(0, 2)).toBe("Quedan 2 por revisar: miralo abajo.");
  });
});
