import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readPublicDbEnv } from "@/lib/server/db/env";
import { createAdminClient } from "@/lib/server/db/admin";
import { signOutOfTheJar } from "../support/cookie-jar";
import { mailIdsTo } from "../support/mailbox";
import { authRow, ip, jarAccessToken, purgeSchools, registeredSessionsOf, scene, sessionCookies, sessionsOf, tokenReads, withCard } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());
vi.mock("@/lib/server/auth/password-hash", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/auth/password-hash")>("@/lib/server/auth/password-hash");
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

import { DECOY_HASH, verifyPassword } from "@/lib/server/auth/password-hash";
import { findInstitution, signInStudent } from "@/lib/server/services/student-auth";

// The login of a student (T2.5b, «Cómo entra un estudiante») against the local Supabase: the password is checked by our server, the
// session is opened with no password in Auth and registered before the cookies, and every failure is the same and slow.
// The limits are in login-limits.test.ts and the card issued in the middle in login-race.test.ts.

const MIN_MS = 780; // 800 ms of the contract, minus the slop of a timer
const GENERIC = "El usuario o la contraseña no coinciden. Revisalos y probá de nuevo.";

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
});
beforeEach(() => {
  signOutOfTheJar();
  vi.mocked(verifyPassword).mockClear();
});
afterEach(() => vi.restoreAllMocks());
afterAll(purgeSchools, 60_000);

async function timed<T>(work: Promise<T>): Promise<{ elapsed: number; outcome: T | unknown }> {
  const started = Date.now();
  const outcome = await work.catch((thrown: unknown) => thrown);
  return { elapsed: Date.now() - started, outcome };
}

describe("signInStudent", () => {
  it("a right password opens the session, leaves the cookies, registers the session and sends no mail", async () => {
    const { login, userId } = await withCard();
    const address = `${userId}@estudiantes.usetiza.app`;
    const mailsBefore = (await mailIdsTo(address)).length;
    expect(await signInStudent(login())).toEqual({ next: "/estudiante" });

    expect(sessionCookies().length).toBeGreaterThan(0);
    expect(await sessionsOf(userId)).toBe(1);
    expect(await registeredSessionsOf(userId)).toBe(1);
    expect(await tokenReads(await jarAccessToken())).toBe(true);
    expect((await mailIdsTo(address)).length).toBe(mailsBefore);
  });

  it("the Auth account has no password before the login, and none after: nobody can use /token with it", async () => {
    const { login, userId, card } = await withCard();
    expect((await authRow(userId))?.password).toBe("");
    await signInStudent(login());
    expect((await authRow(userId))?.password).toBe("");
    const asked = await createAdminClient().auth.signInWithPassword({ email: `${userId}@estudiantes.usetiza.app`, password: card.password });
    expect(asked.error).not.toBeNull();
    expect(asked.data.session).toBeNull();
  });

  it("PUT /auth/v1/user with the session of the student does not give his account a password", async () => {
    const { login, userId } = await withCard();
    await signInStudent(login());
    const { url, publishableKey } = readPublicDbEnv();
    const authorization = { Authorization: `Bearer ${await jarAccessToken()}` };
    const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: authorization } });
    const changed = await client.auth.updateUser({ password: `${randomUUID()}${randomUUID()}` });
    expect(changed.error).not.toBeNull();
    expect((await authRow(userId))?.password).toBe("");
  });

  it("spaces and capitals do not matter: school, user and password are normalized", async () => {
    const { s, student, card, userId } = await withCard();
    const sloppy = card.password.split("-").join("  ").toUpperCase();
    const typed = { code: `  ${s.institution.code.toUpperCase()} `, username: ` ${student.username.toUpperCase()}`, password: ` ${sloppy} `, ip: ip() };
    expect(await signInStudent(typed)).toEqual({ next: "/estudiante" });
    expect(await registeredSessionsOf(userId)).toBe(1);
  });

  it("a school code that does not exist is said by name, not as a wrong password, and also takes 800 ms", async () => {
    const { card } = await withCard();
    const attempt = await timed(signInStudent({ code: `no-${randomUUID().slice(0, 12)}`, username: "nadie", password: card.password, ip: ip() }));
    expect(attempt.outcome).toMatchObject({ code: "NOT_FOUND", message: "No encontramos un colegio con ese código. Revisá que esté igual que en la tarjeta." });
    expect(attempt.elapsed).toBeGreaterThanOrEqual(MIN_MS);
    expect(vi.mocked(verifyPassword).mock.calls.at(-1)?.[1]).toBe(DECOY_HASH);
  });

  it("finds a school by its code, with its name; an unknown code is NOT_FOUND", async () => {
    const { s } = await withCard();
    expect(await findInstitution({ code: ` ${s.institution.code.toUpperCase()} `, ip: ip() })).toEqual({ code: s.institution.code, name: s.institution.name });
    await expect(findInstitution({ code: `no-${randomUUID().slice(0, 12)}`, ip: ip() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("an unknown user and a wrong password are the same FORBIDDEN, both go through scrypt (the unknown one against the decoy) and both take 800 ms", async () => {
    const { login, student } = await withCard();
    const wrong = await timed(signInStudent(login("sol-nube-tigre-47")));
    const wrongCall = vi.mocked(verifyPassword).mock.calls.at(-1);
    vi.mocked(verifyPassword).mockClear();
    const unknown = await timed(signInStudent({ ...login(), username: `nadie${student.username}` }));
    const unknownCall = vi.mocked(verifyPassword).mock.calls.at(-1);

    expect(wrong.outcome).toMatchObject({ code: "FORBIDDEN", message: GENERIC });
    expect(unknown.outcome).toMatchObject({ code: "FORBIDDEN", message: GENERIC });
    expect(wrong.elapsed).toBeGreaterThanOrEqual(MIN_MS);
    expect(unknown.elapsed).toBeGreaterThanOrEqual(MIN_MS);
    expect(vi.mocked(verifyPassword)).toHaveBeenCalledTimes(1);
    expect(wrongCall?.[1]).not.toBe(DECOY_HASH);
    expect(unknownCall?.[1]).toBe(DECOY_HASH);
    expect(sessionCookies()).toEqual([]);
  });

  it("a student whose account is not active (no card yet) gets the same generic error, after the same work", async () => {
    const s = await scene(1);
    const pending = s.students[0];
    const typed = { code: s.institution.code, username: pending ? pending.username : "", password: "sol-nube-tigre-47", ip: ip() };
    const attempt = await timed(signInStudent(typed));
    expect(attempt.outcome).toMatchObject({ code: "FORBIDDEN", message: GENERIC });
    expect(vi.mocked(verifyPassword).mock.calls.at(-1)?.[1]).toBe(DECOY_HASH);
  });
});
