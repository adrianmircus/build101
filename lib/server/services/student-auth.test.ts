import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";

// The decisions of the login of a student that do not need a database: what is checked and in which order, and that the decoy hash
// never opens a session. The flow against a real Auth is in tests/integration/accounts.

const mocks = vi.hoisted(() => ({
  studentLogin: vi.fn(),
  openStudentSession: vi.fn(),
  verifyPassword: vi.fn(),
  setSessionTokens: vi.fn(),
  guardAttempt: vi.fn(),
  clearSubject: vi.fn(),
}));

vi.mock("./admin/student-login", async () => {
  const actual = await vi.importActual<typeof import("./admin/student-login")>("./admin/student-login");
  return { ...actual, studentLogin: mocks.studentLogin, openStudentSession: mocks.openStudentSession };
});
vi.mock("../auth/password-hash", async () => {
  const actual = await vi.importActual<typeof import("../auth/password-hash")>("../auth/password-hash");
  return { ...actual, verifyPassword: mocks.verifyPassword };
});
vi.mock("../repos/auth-session", () => ({ setSessionTokens: mocks.setSessionTokens }));
vi.mock("./rate-limit", () => ({ guardAttempt: mocks.guardAttempt, clearSubject: mocks.clearSubject }));

import { DECOY_HASH } from "../auth/password-hash";
import { AuthBusyError } from "./admin/student-login";
import { signInStudent } from "./student-auth";

const WHO = { code: " Colegio-X ", username: "LuciaF ", password: "Sol Nube  Tigre-47", ip: "10.0.0.1" };
const REAL = { institutionFound: true, authUserId: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f", passwordHash: "scrypt$15$8$1$real", version: 3 };
const NONE = { institutionFound: true, authUserId: null, passwordHash: null, version: null };

const outcome = (work: Promise<unknown>) => work.then(() => null, (thrown: unknown) => thrown);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.guardAttempt.mockResolvedValue(undefined);
  mocks.clearSubject.mockResolvedValue(undefined);
  mocks.setSessionTokens.mockResolvedValue(undefined);
});

describe("signInStudent", () => {
  it("normalizes what was typed before checking and before counting", async () => {
    mocks.studentLogin.mockResolvedValue(REAL);
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.openStudentSession.mockResolvedValue({ accessToken: "a", refreshToken: "r" });
    await signInStudent(WHO);
    expect(mocks.guardAttempt).toHaveBeenCalledWith("student", "10.0.0.1", "colegio-x/luciaf");
    expect(mocks.studentLogin).toHaveBeenCalledWith("colegio-x", "luciaf");
    expect(mocks.verifyPassword).toHaveBeenCalledWith("sol-nube-tigre-47", REAL.passwordHash);
  });

  it("opens the session in the order of the contract and clears the counters of the subject at the end", async () => {
    const order: string[] = [];
    mocks.studentLogin.mockResolvedValue(REAL);
    mocks.verifyPassword.mockImplementation(async () => (order.push("scrypt"), true));
    mocks.openStudentSession.mockImplementation(async () => (order.push("open"), { accessToken: "a", refreshToken: "r" }));
    mocks.setSessionTokens.mockImplementation(async () => void order.push("cookies"));
    mocks.clearSubject.mockImplementation(async () => void order.push("clear"));
    await expect(signInStudent(WHO)).resolves.toEqual({ next: "/estudiante" });
    expect(order).toEqual(["scrypt", "open", "cookies", "clear"]);
    expect(mocks.openStudentSession).toHaveBeenCalledWith(REAL.authUserId, 3, undefined);
    expect(mocks.clearSubject).toHaveBeenCalledWith("student", "colegio-x/luciaf", "10.0.0.1");
  });

  it("checks an unknown user against the decoy hash (the same work) and never opens a session", async () => {
    mocks.studentLogin.mockResolvedValue(NONE);
    mocks.verifyPassword.mockResolvedValue(false);
    const failure = await outcome(signInStudent(WHO));
    expect(failure).toMatchObject({ code: "FORBIDDEN", message: "El usuario o la contraseña no coinciden. Revisalos y probá de nuevo." });
    expect(mocks.verifyPassword).toHaveBeenCalledTimes(1);
    expect(mocks.verifyPassword).toHaveBeenCalledWith("sol-nube-tigre-47", DECOY_HASH);
    expect(mocks.openStudentSession).not.toHaveBeenCalled();
    expect(mocks.setSessionTokens).not.toHaveBeenCalled();
  });

  it("never opens a session even if scrypt says the decoy matched", async () => {
    mocks.studentLogin.mockResolvedValue(NONE);
    mocks.verifyPassword.mockResolvedValue(true);
    expect(await outcome(signInStudent(WHO))).toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.openStudentSession).not.toHaveBeenCalled();
    expect(mocks.setSessionTokens).not.toHaveBeenCalled();
    expect(mocks.clearSubject).not.toHaveBeenCalled();
  });

  it("never opens a session when only part of the data of the account came, even with a match", async () => {
    mocks.verifyPassword.mockResolvedValue(true);
    for (const partial of [
      { ...REAL, authUserId: null },
      { ...REAL, version: null },
      { ...REAL, passwordHash: null },
    ]) {
      mocks.studentLogin.mockResolvedValue(partial);
      expect(await outcome(signInStudent(WHO))).toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks.openStudentSession).not.toHaveBeenCalled();
  });

  it("says a school code that does not exist by name, after the same scrypt work", async () => {
    mocks.studentLogin.mockResolvedValue({ institutionFound: false, authUserId: null, passwordHash: null, version: null });
    mocks.verifyPassword.mockResolvedValue(false);
    expect(await outcome(signInStudent(WHO))).toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.verifyPassword).toHaveBeenCalledWith("sol-nube-tigre-47", DECOY_HASH);
  });

  it("does not look at anything when the limit says no", async () => {
    mocks.guardAttempt.mockRejectedValue(new AppError("RATE_LIMITED", "Esperá.", { retryAt: "2026-11-12T12:00:00.000Z" }));
    expect(await outcome(signInStudent(WHO))).toMatchObject({ code: "RATE_LIMITED", retryAt: "2026-11-12T12:00:00.000Z" });
    expect(mocks.studentLogin).not.toHaveBeenCalled();
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });

  it("no cookies and no counters cleared when the bind refuses (a card was issued in the middle)", async () => {
    mocks.studentLogin.mockResolvedValue(REAL);
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.openStudentSession.mockResolvedValue(null);
    expect(await outcome(signInStudent(WHO))).toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.setSessionTokens).not.toHaveBeenCalled();
    expect(mocks.clearSubject).not.toHaveBeenCalled();
  });

  it("counts a 429 of Auth as a success: the counters are cleared and the person is told to wait a minute", async () => {
    mocks.studentLogin.mockResolvedValue(REAL);
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.openStudentSession.mockRejectedValue(new AuthBusyError());
    expect(await outcome(signInStudent(WHO))).toMatchObject({ code: "UNAVAILABLE", message: "Probá de nuevo en un minuto." });
    expect(mocks.clearSubject).toHaveBeenCalledWith("student", "colegio-x/luciaf", "10.0.0.1");
    expect(mocks.setSessionTokens).not.toHaveBeenCalled();
  });

  it("every failure takes 800 ms at least", async () => {
    mocks.studentLogin.mockResolvedValue(NONE);
    mocks.verifyPassword.mockResolvedValue(false);
    const started = Date.now();
    await outcome(signInStudent(WHO));
    expect(Date.now() - started).toBeGreaterThanOrEqual(780);
  });
});
