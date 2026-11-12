import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ getClaims: vi.fn(), list: vi.fn() }));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
vi.mock("../repos/auth-session", () => ({ getClaims: mocks.getClaims }));
vi.mock("../repos/db", () => ({ sessionDb: async () => ({}) }));
vi.mock("../repos/institutions", () => ({ listMyInstitutions: mocks.list }));

import { getActor, requireAdmin, requireStaff, requireStudent } from "./actor";

const USER = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const inst = (id: string, roles: string[]) => ({ id, name: `Colegio ${id.slice(0, 1)}`, kind: "school", roles });
const NO_PERMISSION = "No tenés permiso para hacer esto.";

beforeEach(() => {
  mocks.getClaims.mockReset();
  mocks.list.mockReset();
  mocks.getClaims.mockResolvedValue({ userId: USER, sessionId: null, email: null });
});

describe("getActor", () => {
  it("sin sesión es null y no pregunta por instituciones", async () => {
    mocks.getClaims.mockResolvedValue(null);
    expect(await getActor()).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("staff con sus instituciones y roles", async () => {
    mocks.list.mockResolvedValue([inst(A, ["admin", "teacher"]), inst(B, ["teacher"])]);
    expect(await getActor()).toEqual({
      kind: "staff",
      userId: USER,
      institutions: [inst(A, ["admin", "teacher"]), inst(B, ["teacher"])],
    });
  });

  it("estudiante con su institución", async () => {
    mocks.list.mockResolvedValue([inst(A, ["student"])]);
    expect(await getActor()).toEqual({ kind: "student", userId: USER, institutionId: A });
  });

  it("sin membresías no es nadie", async () => {
    mocks.list.mockResolvedValue([]);
    expect(await getActor()).toBeNull();
  });

  it("una sesión cerrada (FORBIDDEN de la base) es como no tener sesión", async () => {
    mocks.list.mockRejectedValue(new AppError("FORBIDDEN", "Tu sesión terminó. Volvé a entrar."));
    expect(await getActor()).toBeNull();
  });

  it("una caída de la base no se disfraza de sesión cerrada", async () => {
    mocks.list.mockRejectedValue(new Error("boom"));
    await expect(getActor()).rejects.toThrow("boom");
  });
});

describe("requireStaff, requireAdmin y requireStudent", () => {
  it("sin sesión: FORBIDDEN con el texto de no_session", async () => {
    mocks.getClaims.mockResolvedValue(null);
    for (const call of [requireStaff, () => requireAdmin(A), requireStudent]) {
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Tu sesión terminó. Volvé a entrar." });
    }
  });

  it("un estudiante no es staff, y el staff no es estudiante", async () => {
    mocks.list.mockResolvedValue([inst(A, ["student"])]);
    await expect(requireStaff()).rejects.toMatchObject({ code: "FORBIDDEN", message: NO_PERMISSION });
    await expect(requireAdmin(A)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await requireStudent()).institutionId).toBe(A);
    mocks.list.mockResolvedValue([inst(A, ["teacher"])]);
    await expect(requireStudent()).rejects.toMatchObject({ code: "FORBIDDEN", message: NO_PERMISSION });
  });

  it("requireAdmin: admin de esa institución sí; de otra, o profe, no", async () => {
    mocks.list.mockResolvedValue([inst(A, ["admin"]), inst(B, ["teacher"])]);
    expect((await requireAdmin(A)).kind).toBe("staff");
    await expect(requireAdmin(B)).rejects.toMatchObject({ code: "FORBIDDEN", message: NO_PERMISSION });
    await expect(requireAdmin("cccccccc-cccc-4ccc-8ccc-cccccccccccc")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
