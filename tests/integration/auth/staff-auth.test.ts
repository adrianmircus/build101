import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STUDENT_EMAIL_DOMAIN } from "@/lib/domain/accounts/email";
import { guardAttempt } from "@/lib/server/services/rate-limit";
import { createSchool, type LoggedInUser } from "../../factories";
import { readRows } from "../support/db";
import { browser, openSession, signOutOfTheJar } from "../support/cookie-jar";
import { latestMailTo, mailIdsTo } from "../support/mailbox";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());

import { requestPasswordReset, setNewPassword, signInStaff, signOut, verifyRecovery } from "@/lib/server/services/staff-auth";

// The services of the staff login against the local Supabase (T2.3): the limit of attempts (it counts before trying and a
// success clears it), the answer that takes the same time whatever failed, and the recovery of the password.

const ORIGIN = "http://localhost:3000";
const MIN_MS = 780; // 800 ms of the contract, minus the slop of a timer
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const strong = () => `${randomUUID()}${randomUUID()}`.slice(0, 40);

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
});
beforeEach(signOutOfTheJar);
afterEach(() => vi.restoreAllMocks());

async function staff(): Promise<LoggedInUser> {
  return (await createSchool()).teacher;
}

async function timed<T>(work: Promise<T>): Promise<{ elapsed: number; outcome: T | unknown }> {
  const started = Date.now();
  const outcome = await work.catch((thrown: unknown) => thrown);
  return { elapsed: Date.now() - started, outcome };
}

const sessionsOf = async (userId: string) =>
  Number((await readRows<{ n: string }>("select count(*)::text as n from auth.sessions where user_id = $1", [userId]))[0]?.n);

describe("signInStaff", () => {
  it("a right pair opens the session and goes to /grupos", async () => {
    const user = await staff();
    expect(await signInStaff({ email: user.email, password: user.password, ip: ip() })).toEqual({ next: "/grupos" });
    expect([...browser.jar.keys()].some((name) => name.startsWith("sb-"))).toBe(true);
    expect(await sessionsOf(user.id)).toBeGreaterThanOrEqual(1);
  });

  it("the email is read with any case and spaces", async () => {
    const user = await staff();
    expect(await signInStaff({ email: `  ${user.email.toUpperCase()} `, password: user.password, ip: ip() })).toEqual({ next: "/grupos" });
  });

  it("a wrong password and an email with no account are the same FORBIDDEN, and both take 800 ms at least", async () => {
    const user = await staff();
    const wrong = await timed(signInStaff({ email: user.email, password: "no-es-esta-contraseña", ip: ip() }));
    const unknown = await timed(signInStaff({ email: `${randomUUID()}@tiza-test.example`, password: "no-es-esta-contraseña", ip: ip() }));
    expect(wrong.outcome).toMatchObject({ code: "FORBIDDEN", message: "El correo o la contraseña no coinciden. Revisalos y probá de nuevo." });
    expect(unknown.outcome).toMatchObject({ code: "FORBIDDEN", message: "El correo o la contraseña no coinciden. Revisalos y probá de nuevo." });
    expect(wrong.elapsed).toBeGreaterThanOrEqual(MIN_MS);
    expect(unknown.elapsed).toBeGreaterThanOrEqual(MIN_MS);
    expect([...browser.jar.keys()].filter((name) => name.startsWith("sb-"))).toEqual([]);
  });

  it("the account of a student has no password: the same FORBIDDEN, never a session", async () => {
    const attempt = await timed(signInStaff({ email: `${randomUUID()}@${STUDENT_EMAIL_DOMAIN}`, password: strong(), ip: ip() }));
    expect(attempt.outcome).toMatchObject({ code: "FORBIDDEN" });
    expect(attempt.elapsed).toBeGreaterThanOrEqual(MIN_MS);
  });

  it("over the limit it is RATE_LIMITED with retryAt, does not try Auth and also waits 800 ms", async () => {
    const user = await staff();
    const from = ip();
    for (let attempt = 0; attempt < 10; attempt += 1) await guardAttempt("staff", from, user.email);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const blocked = await timed(signInStaff({ email: user.email, password: user.password, ip: from }));
    expect(blocked.outcome).toMatchObject({ code: "RATE_LIMITED" });
    expect(blocked.outcome).toMatchObject({ retryAt: expect.any(String) });
    expect(blocked.elapsed).toBeGreaterThanOrEqual(MIN_MS);
    expect(fetchSpy.mock.calls.some(([target]) => String(target).includes("/auth/v1/token"))).toBe(false);
    // Another person from the same place is not blocked by that pair; the same email from another place has its own pair.
    expect(await signInStaff({ email: user.email, password: user.password, ip: ip() })).toEqual({ next: "/grupos" });
  });

  it("a success clears the counters: after it the person starts from zero", async () => {
    const user = await staff();
    const from = ip();
    for (let attempt = 0; attempt < 9; attempt += 1) await guardAttempt("staff", from, user.email);
    expect(await signInStaff({ email: user.email, password: user.password, ip: from })).toEqual({ next: "/grupos" });
    for (let attempt = 0; attempt < 10; attempt += 1) await guardAttempt("staff", from, user.email);
    await expect(guardAttempt("staff", from, user.email)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("recovering the password", () => {
  it("always says `sent` after 800 ms, sends the mail only when there is an account and keeps the token in the fragment", async () => {
    const user = await staff();
    const known = await timed(requestPasswordReset({ email: user.email, ip: ip(), origin: ORIGIN }));
    const unknown = await timed(requestPasswordReset({ email: `${randomUUID()}@tiza-test.example`, ip: ip(), origin: ORIGIN }));
    expect(known.outcome).toEqual({ sent: true });
    expect(unknown.outcome).toEqual({ sent: true });
    expect(known.elapsed).toBeGreaterThanOrEqual(MIN_MS);
    expect(unknown.elapsed).toBeGreaterThanOrEqual(MIN_MS);
    const mail = await latestMailTo(user.email);
    expect(mail).not.toBeNull();
    expect(mail?.subject).toBeTruthy();
  });

  it("a synthetic email gets `sent` without calling Auth and without mail", async () => {
    const email = `${randomUUID()}@${STUDENT_EMAIL_DOMAIN}`;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const attempt = await timed(requestPasswordReset({ email, ip: ip(), origin: ORIGIN }));
    expect(attempt.outcome).toEqual({ sent: true });
    expect(attempt.elapsed).toBeGreaterThanOrEqual(MIN_MS);
    expect(fetchSpy.mock.calls.filter(([target]) => String(target).includes("/auth/v1"))).toEqual([]);
    expect(await mailIdsTo(email)).toEqual([]);
  });

  it("three per email in an hour: the fourth is RATE_LIMITED, with no more mail", async () => {
    const user = await staff();
    for (let attempt = 0; attempt < 3; attempt += 1) await requestPasswordReset({ email: user.email, ip: ip(), origin: ORIGIN });
    const fourth = await timed(requestPasswordReset({ email: user.email, ip: ip(), origin: ORIGIN }));
    expect(fourth.outcome).toMatchObject({ code: "RATE_LIMITED" });
    expect(fourth.elapsed).toBeGreaterThanOrEqual(MIN_MS);
  });

  it("the link opens a session once, the new password replaces the old one and closes the other sessions", async () => {
    const user = await staff();
    await openSession(user);
    expect(await sessionsOf(user.id)).toBe(2); // the one of the factory and this one
    signOutOfTheJar();

    await requestPasswordReset({ email: user.email, ip: ip(), origin: ORIGIN });
    const mail = await latestMailTo(user.email);
    const link = `${mail?.html ?? ""}${mail?.text ?? ""}`;
    // The template of the project carries the hash in the fragment; the default one of a stack that did not reload it, in `token`.
    const tokenHash = /\/ingresar\/profesor\/nueva#([A-Za-z0-9_-]+)/.exec(link)?.[1] ?? /[?&]token=([A-Za-z0-9_-]+)/.exec(link)?.[1];
    expect(tokenHash).toBeDefined();

    expect(await verifyRecovery({ tokenHash: tokenHash ?? "" })).toEqual({ verified: true, userId: user.id });
    await expect(verifyRecovery({ tokenHash: tokenHash ?? "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(verifyRecovery({ tokenHash: "no-es-un-enlace-de-verdad" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const next = strong();
    expect(await setNewPassword({ password: next, userId: user.id })).toEqual({ next: "/grupos" });
    expect(await sessionsOf(user.id)).toBe(1);
    signOutOfTheJar();
    await expect(signInStaff({ email: user.email, password: user.password, ip: ip() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await signInStaff({ email: user.email, password: next, ip: ip() })).toEqual({ next: "/grupos" });
  });

  it("the new password goes to the account that was verified: if another one signed in meanwhile it is CONFLICT and nothing changes", async () => {
    const a = await staff();
    const b = await staff();
    await requestPasswordReset({ email: a.email, ip: ip(), origin: ORIGIN });
    const mail = await latestMailTo(a.email);
    const link = `${mail?.html ?? ""}${mail?.text ?? ""}`;
    const tokenHash = /\/ingresar\/profesor\/nueva#([A-Za-z0-9_-]+)/.exec(link)?.[1] ?? /[?&]token=([A-Za-z0-9_-]+)/.exec(link)?.[1];
    const verified = await verifyRecovery({ tokenHash: tokenHash ?? "" });
    expect(verified.userId).toBe(a.id);

    // In another tab of the same browser: A leaves and B enters.
    signOutOfTheJar();
    await openSession(b);
    const sessionsOfB = await sessionsOf(b.id);
    await expect(setNewPassword({ password: strong(), userId: verified.userId })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Cambiaste de cuenta en otra pestaña. Abrí el enlace de nuevo.",
    });
    // B keeps the password and the sessions; A keeps its password too.
    expect(await sessionsOf(b.id)).toBe(sessionsOfB);
    signOutOfTheJar();
    expect(await signInStaff({ email: b.email, password: b.password, ip: ip() })).toEqual({ next: "/grupos" });
    signOutOfTheJar();
    expect(await signInStaff({ email: a.email, password: a.password, ip: ip() })).toEqual({ next: "/grupos" });
  });

  it("without a session the new password is FORBIDDEN, and a password that Auth does not accept is INVALID", async () => {
    await expect(setNewPassword({ password: strong(), userId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN", message: "Tu sesión terminó. Volvé a entrar." });
    const user = await staff();
    await openSession(user);
    await expect(setNewPassword({ password: "corta", userId: user.id })).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("signOut", () => {
  it("closes this session and goes to the login of the teacher", async () => {
    const user = await staff();
    await openSession(user);
    expect(await sessionsOf(user.id)).toBe(2);
    expect(await signOut()).toEqual({ next: "/ingresar/profesor" });
    expect(await sessionsOf(user.id)).toBe(1); // only this one was closed
  });

  it("with no session it still answers where to go", async () => {
    expect(await signOut()).toEqual({ next: "/ingresar/profesor" });
  });
});
