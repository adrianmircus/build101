import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getActor: vi.fn(), getClaims: vi.fn(), signOut: vi.fn() }));
vi.mock("./actor", () => ({ getActor: mocks.getActor }));
vi.mock("../repos/auth-session", () => ({ getClaims: mocks.getClaims, signOut: mocks.signOut }));
// connection() only works inside a request: here it is a no-op.
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { cleanStaleSession, loginAfterClean, loginGate } from "./login-gate";

const CLAIMS = { userId: "u", sessionId: null, email: null };
const STAFF = { kind: "staff", userId: "u", institutions: [] };
const STUDENT = { kind: "student", userId: "u", institutionId: "i" };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getActor.mockResolvedValue(null);
  mocks.getClaims.mockResolvedValue(null);
});

describe("loginGate", () => {
  it("un actor del mismo tipo va al inicio", async () => {
    mocks.getActor.mockResolvedValue(STAFF);
    await expect(loginGate("staff")).rejects.toThrow("REDIRECT /grupos");
    mocks.getActor.mockResolvedValue(STUDENT);
    await expect(loginGate("student")).rejects.toThrow("REDIRECT /estudiante");
  });

  it("un actor del otro tipo ve el login", async () => {
    mocks.getActor.mockResolvedValue(STUDENT);
    await expect(loginGate("staff")).resolves.toBeUndefined();
    mocks.getActor.mockResolvedValue(STAFF);
    await expect(loginGate("student")).resolves.toBeUndefined();
  });

  it("sin claims ni actor: el login, sin viaje de limpieza", async () => {
    await expect(loginGate("student")).resolves.toBeUndefined();
  });

  it("claims sin actor (sesión cerrada por una tarjeta nueva): limpia y vuelve al login, nunca al inicio", async () => {
    mocks.getClaims.mockResolvedValue(CLAIMS);
    await expect(loginGate("student")).rejects.toThrow("REDIRECT /ingresar/sesion?a=student");
    await expect(loginGate("staff")).rejects.toThrow("REDIRECT /ingresar/sesion?a=staff");
  });

  it("después de la limpieza (?limpia=1), o donde no se puede limpiar, muestra el login aunque los claims sigan", async () => {
    mocks.getClaims.mockResolvedValue(CLAIMS);
    await expect(loginGate("student", { cleaned: true })).resolves.toBeUndefined();
    await expect(loginGate("student", { canClean: false })).resolves.toBeUndefined();
  });

  it("si la base no responde no redirige ni limpia: una sesión que puede estar bien no se toca", async () => {
    mocks.getActor.mockRejectedValue(new Error("caída"));
    await expect(loginGate("staff")).resolves.toBeUndefined();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});

describe("cleanStaleSession", () => {
  it("cierra la sesión local solo si la base no la reconoce", async () => {
    await cleanStaleSession();
    expect(mocks.signOut).toHaveBeenCalledWith("local");
  });

  it("nunca cierra una sesión viva", async () => {
    mocks.getActor.mockResolvedValue(STUDENT);
    await cleanStaleSession();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("si la base o Auth fallan, no lanza ni cierra", async () => {
    mocks.getActor.mockRejectedValue(new Error("caída"));
    await expect(cleanStaleSession()).resolves.toBeUndefined();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});

describe("loginAfterClean", () => {
  it("solo conoce los dos logins, con la marca; lo demás va al del profe", () => {
    expect(loginAfterClean("student")).toBe("/ingresar/estudiante?limpia=1");
    expect(loginAfterClean("staff")).toBe("/ingresar/profesor?limpia=1");
    expect(loginAfterClean("https://malo.example")).toBe("/ingresar/profesor?limpia=1");
    expect(loginAfterClean(null)).toBe("/ingresar/profesor?limpia=1");
  });
});
