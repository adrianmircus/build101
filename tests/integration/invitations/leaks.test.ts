import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/server/auth/tokens";
import { signOutOfTheJar } from "../support/cookie-jar";
import { adminSchool, purgeSchools, email, invitationRow, ip, ORIGIN, strongPassword, tokenSentTo } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());

import { acceptInvitationAsNewUser, inviteStaff, readInvitation, resendInvitation } from "@/lib/server/services/invitations";
import { requestPasswordReset, signInStaff } from "@/lib/server/services/staff-auth";
import { guardAttempt } from "@/lib/server/services/rate-limit";

// The proof of the criterion «ningún log con token o correo»: the flows of the invitations and of the login run with every
// console method captured, including the ones that fail, and nothing that identifies a person or opens a door may be in it:
// no token, no hash, no email, no password, no name.

const lines: string[] = [];
const secrets: string[] = [];
const remember = (...values: string[]) => void secrets.push(...values);

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
  }
});
afterAll(() => vi.restoreAllMocks());

afterAll(purgeSchools, 60_000);

describe("what the flows leave in the logs", () => {
  it("runs the invitation flows, the failures and the login, and no secret is in what was logged", async () => {
    const school = await adminSchool();
    await school.openAsAdmin();
    const guest = email();
    const second = email();
    const password = strongPassword();
    remember(school.owner.email, school.owner.password, guest, second, password, "Docente De Prueba");

    const request = { institutionId: school.institution.id, role: "teacher" as const, opKey: randomUUID(), origin: ORIGIN };
    // A mail that fails (the provider answers nothing) and one that goes out.
    process.env.MAIL_MAILPIT_URL = "http://127.0.0.1:1";
    await inviteStaff({ ...request, emails: [second] });
    delete process.env.MAIL_MAILPIT_URL;
    await inviteStaff({ ...request, opKey: randomUUID(), emails: [guest, school.teacher.email, "x@estudiantes.usetiza.app"] });
    const token = await tokenSentTo(guest);
    remember(token, hashToken(token), hashToken(token).slice(2));

    const row = await readInvitation({ token, ip: ip() });
    expect(row.email).toBe(guest);
    const found = await invitationRow(school.institution.id, guest);
    const resent = await resendInvitation({ institutionId: school.institution.id, invitationId: found?.id ?? "", revision: found?.revision ?? 1, origin: ORIGIN });
    expect(resent.mailSent).toBe(true);
    const newToken = await tokenSentTo(guest, 1);
    remember(newToken, hashToken(newToken));

    // Failures: a weak password, a token that does not exist, a login that fails, a block of the limit and a reset.
    signOutOfTheJar();
    await acceptInvitationAsNewUser({ token: newToken, displayName: "Docente De Prueba", password: "corta", ip: ip() }).catch(() => undefined);
    await readInvitation({ token: "c".repeat(43), ip: ip() }).catch(() => undefined);
    await signInStaff({ email: guest, password: "contraseña equivocada", ip: ip() }).catch(() => undefined);
    const crowded = ip();
    for (let attempt = 0; attempt < 11; attempt += 1) await guardAttempt("staff", crowded, guest).catch(() => undefined);
    await requestPasswordReset({ email: guest, ip: ip(), origin: ORIGIN });
    await requestPasswordReset({ email: `${randomUUID()}@estudiantes.usetiza.app`, ip: ip(), origin: ORIGIN });
    // And the one that works: a new account.
    await acceptInvitationAsNewUser({ token: newToken, displayName: "Docente De Prueba", password, ip: ip() });
    await signInStaff({ email: guest, password, ip: ip() });
    remember("contraseña equivocada");

    const text = lines.join("\n");
    expect(text.length).toBeGreaterThan(0); // the failures did log something: the check is not looking at an empty page
    for (const secret of new Set(secrets)) expect(text, `el log no debe llevar ${secret.slice(0, 4)}…`).not.toContain(secret);
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/); // no email of anybody
    expect(text).not.toContain("/invitacion#");
  });
});
