import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/lib/errors";

const signIn = vi.fn();
const readCardAction = vi.fn();
vi.mock("@/app/ingresar/estudiante/actions", () => ({
  signInStudentAction: signIn,
  readAccessCardAction: readCardAction,
  findInstitutionAction: vi.fn(),
}));

const { runLogin } = await import("./login-flow");
const { readCard } = await import("./read-card");

const values = { code: "sanjose", username: "luciaf", password: "nube tigre 47" };

beforeEach(() => vi.clearAllMocks());

describe("runLogin", () => {
  it("manda lo escrito tal cual y sigue al destino que dice el servidor", async () => {
    signIn.mockResolvedValue(ok({ next: "/estudiante" }));
    expect(await runLogin(values)).toEqual({ kind: "in", next: "/estudiante" });
    expect(signIn).toHaveBeenCalledWith(values);
  });

  it("con muchos intentos trae la hora para volver", async () => {
    signIn.mockResolvedValue(fail("RATE_LIMITED", "Esperá.", { retryAt: "2026-11-12T15:40:00.000Z" }));
    expect(await runLogin(values)).toEqual({ kind: "pause", retryAt: "2026-11-12T15:40:00.000Z" });
  });

  it("si los servicios todavía no responden (UNAVAILABLE), es un aviso genérico", async () => {
    signIn.mockResolvedValue(fail("UNAVAILABLE", "Todavía no está disponible."));
    expect(await runLogin(values)).toEqual({ kind: "notice", notice: { kind: "unavailable" } });
  });

  it("si se corta la conexión, también", async () => {
    signIn.mockRejectedValue(new TypeError("fetch failed"));
    expect(await runLogin(values)).toEqual({ kind: "notice", notice: { kind: "unavailable" } });
  });

  it("datos que no coinciden: un solo aviso, sin decir cuál", async () => {
    signIn.mockResolvedValue(fail("FORBIDDEN", "No coinciden."));
    expect(await runLogin(values)).toEqual({ kind: "notice", notice: { kind: "wrong" } });
  });
});

describe("readCard", () => {
  const token = "A".repeat(43);

  it("una tarjeta buena trae colegio y usuario, nunca un nombre", async () => {
    readCardAction.mockResolvedValue(ok({ institutionCode: "sanjose", institutionName: "Colegio San José", username: "luciaf" }));
    expect(await readCard(token)).toEqual({ kind: "card", code: "sanjose", name: "Colegio San José", username: "luciaf" });
    expect(readCardAction).toHaveBeenCalledWith({ token });
  });

  it("una tarjeta vieja no sirve; sin servicio, es otro mensaje; con límite, una pausa", async () => {
    readCardAction.mockResolvedValueOnce(fail("NOT_FOUND", "x"));
    expect(await readCard(token)).toEqual({ kind: "unusable" });
    readCardAction.mockResolvedValueOnce(fail("UNAVAILABLE", "x"));
    expect(await readCard(token)).toEqual({ kind: "unavailable" });
    readCardAction.mockResolvedValueOnce(fail("RATE_LIMITED", "x", { retryAt: "2026-11-12T15:40:00.000Z" }));
    expect(await readCard(token)).toEqual({ kind: "pause", retryAt: "2026-11-12T15:40:00.000Z" });
  });
});
