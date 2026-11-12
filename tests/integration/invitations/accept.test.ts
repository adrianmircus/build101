import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi, afterAll } from "vitest";
import { createAdminClient } from "@/lib/server/db/admin";
import { hashToken } from "@/lib/server/auth/tokens";
import { createAuthUser } from "@/lib/server/repos/admin/auth-users";
import { createInvitedAccount, finishInvitationSignup } from "@/lib/server/services/admin/invitation-signup";
import { browser, openSession, signOutOfTheJar } from "../support/cookie-jar";
import { readRows } from "../support/db";
import { adminSchool, purgeSchools, authUsersWith, email, invitationRow, ip, membershipsOf, ORIGIN, strongPassword, tokenSentTo } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());

import { inviteStaff, readInvitation, acceptInvitation, acceptInvitationAsNewUser, revokeInvitation } from "@/lib/server/services/invitations";
import { signInStaff } from "@/lib/server/services/staff-auth";

// Accepting an invitation, both ways (T2.3), against the local Supabase: with an account and a session, and with no account.
// The rules that matter: the email decides, nobody changes the password of an account that already exists, two at once
// leave one account and one membership, and a revocation in the middle leaves an account with nothing.

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
});
beforeEach(signOutOfTheJar);

type Role = "teacher" | "admin" | "inclusion";

/** An admin invites `address`; returns the school and the token that came in the mail. The jar ends with no session. */
async function invite(address: string, role: Role = "teacher") {
  const school = await adminSchool();
  await school.openAsAdmin();
  const [row] = await inviteStaff({ institutionId: school.institution.id, emails: [address], role, opKey: randomUUID(), origin: ORIGIN });
  expect(row?.outcome).toBe("sent");
  const token = await tokenSentTo(address);
  signOutOfTheJar();
  return { school, token };
}

/** An account of Auth with a password and nothing else: no app_user and no membership, like one left by a cut signup. */
async function bareAccount(address = email()) {
  const password = strongPassword();
  const user = await createAuthUser({ id: randomUUID(), email: address, password, appMetadata: {} });
  return { id: user.id, email: address, password };
}

const passwordHashOf = async (userId: string) => (await readRows<{ hash: string }>("select encrypted_password as hash from auth.users where id = $1", [userId]))[0]?.hash;

afterAll(purgeSchools, 60_000);

describe("acceptInvitation: somebody with an account and a session", () => {
  it("adds the membership and creates the app_user that the account lacked; accepting again says the same", async () => {
    const account = await bareAccount();
    const { school, token } = await invite(account.email, "inclusion");
    await openSession(account);

    const accepted = await acceptInvitation({ token });
    expect(accepted).toEqual({ institutionId: school.institution.id, role: "inclusion", next: "/grupos" });
    expect(await membershipsOf(account.id, school.institution.id)).toBe(1);
    expect(await readRows("select 1 from app.app_users where id = $1", [account.id])).toHaveLength(1);
    expect(await invitationRow(school.institution.id, account.email)).toMatchObject({ status: "accepted" });

    expect(await acceptInvitation({ token })).toEqual(accepted);
    expect(await membershipsOf(account.id, school.institution.id)).toBe(1);
  });

  it("another account is FORBIDDEN, and it gets no membership and no app_user", async () => {
    const { school, token } = await invite(email());
    const stranger = await bareAccount();
    await openSession(stranger);
    await expect(acceptInvitation({ token })).rejects.toMatchObject({ code: "FORBIDDEN", message: "Esta invitación es para otro correo. Entrá con el correo al que llegó." });
    expect(await membershipsOf(stranger.id, school.institution.id)).toBe(0);
    expect(await readRows("select 1 from app.app_users where id = $1", [stranger.id])).toHaveLength(0);
  });

  it("an old JWT does not help after the email changed: the database reads the current email", async () => {
    const account = await bareAccount();
    const { school, token } = await invite(account.email);
    await openSession(account);
    const moved = await createAdminClient().auth.admin.updateUserById(account.id, { email: email(), email_confirm: true });
    expect(moved.error).toBeNull();
    await expect(acceptInvitation({ token })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await membershipsOf(account.id, school.institution.id)).toBe(0);
    expect(await invitationRow(school.institution.id, account.email)).toMatchObject({ status: "pending" });
  });

  it("two acceptances at once leave one membership", async () => {
    const account = await bareAccount();
    const { school, token } = await invite(account.email);
    await openSession(account);
    const both = await Promise.all([acceptInvitation({ token }), acceptInvitation({ token })]);
    expect(both[0]).toEqual(both[1]);
    expect(await membershipsOf(account.id, school.institution.id)).toBe(1);
  });

  it("a revoked invitation and a spent token say so", async () => {
    const account = await bareAccount();
    const { school, token } = await invite(account.email);
    const row = await invitationRow(school.institution.id, account.email);
    await school.openAsAdmin();
    await revokeInvitation({ institutionId: school.institution.id, invitationId: row?.id ?? "", revision: row?.revision ?? 0 });
    await openSession(account);
    await expect(acceptInvitation({ token })).rejects.toMatchObject({ code: "INVALID", message: expect.stringContaining("ya no está disponible") });
    await expect(acceptInvitation({ token: "b".repeat(43) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await membershipsOf(account.id, school.institution.id)).toBe(0);
  });
});

describe("acceptInvitationAsNewUser: somebody with no account", () => {
  it("creates the account, the app_user and the membership, accepts and leaves the session in the cookies", async () => {
    const address = email();
    const { school, token } = await invite(address, "teacher");
    const password = strongPassword();
    const accepted = await acceptInvitationAsNewUser({ token, displayName: "  Docente Nueva ", password, ip: ip() });

    expect(accepted).toEqual({ institutionId: school.institution.id, role: "teacher", next: "/grupos" });
    expect([...browser.jar.keys()].some((name) => name.startsWith("sb-"))).toBe(true);
    const rows = await readRows<{ id: string; name: string; confirmed: boolean; metadata: string | null }>(
      "select u.id, p.display_name as name, u.email_confirmed_at is not null as confirmed, u.raw_app_meta_data ->> 'invitation_id' as metadata from auth.users u join app.app_users p on p.id = u.id where lower(u.email) = $1",
      [address],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Docente Nueva", confirmed: true, metadata: (await invitationRow(school.institution.id, address))?.id });
    expect(await membershipsOf(rows[0]?.id ?? "", school.institution.id)).toBe(1);
    expect(await invitationRow(school.institution.id, address)).toMatchObject({ status: "accepted" });

    signOutOfTheJar();
    expect(await signInStaff({ email: address, password, ip: ip() })).toEqual({ next: "/grupos" });
  });

  it("with the same token again it is invitation_closed: no second account", async () => {
    const address = email();
    const { token } = await invite(address);
    await acceptInvitationAsNewUser({ token, displayName: "Docente", password: strongPassword(), ip: ip() });
    await expect(acceptInvitationAsNewUser({ token, displayName: "Docente", password: strongPassword(), ip: ip() })).rejects.toMatchObject({ code: "INVALID" });
    expect(await authUsersWith(address)).toBe(1);
  });

  it("an email that already has an account is CONFLICT (`ya tenés cuenta`) and its password does not change", async () => {
    const account = await bareAccount();
    const { school, token } = await invite(account.email);
    expect(await readInvitation({ token, ip: ip() })).toMatchObject({ hasAccount: true });
    const before = await passwordHashOf(account.id);

    await expect(acceptInvitationAsNewUser({ token, displayName: "Otra Persona", password: strongPassword(), ip: ip() })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Ya tenés una cuenta"),
    });
    expect(await passwordHashOf(account.id)).toBe(before);
    expect(await authUsersWith(account.email)).toBe(1);
    expect(await membershipsOf(account.id, school.institution.id)).toBe(0);
    expect([...browser.jar.keys()].filter((name) => name.startsWith("sb-"))).toEqual([]);
    // The way in is the one of «Ya tenés cuenta»: sign in with the password they know and accept.
    expect(await signInStaff({ email: account.email, password: account.password, ip: ip() })).toEqual({ next: "/grupos" });
    expect((await acceptInvitation({ token })).institutionId).toBe(school.institution.id);
  });

  it("the account of Auth is never created over an existing email, whatever calls it", async () => {
    const account = await bareAccount();
    const before = await passwordHashOf(account.id);
    await expect(
      createInvitedAccount({ tokenHash: hashToken("x"), invitationId: randomUUID(), email: account.email, password: strongPassword(), displayName: "Otra" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await passwordHashOf(account.id)).toBe(before);
  });

  it("two signups at once leave one account and one membership", async () => {
    const address = email();
    const { school, token } = await invite(address);
    const password = strongPassword();
    const results = await Promise.allSettled([
      acceptInvitationAsNewUser({ token, displayName: "Docente", password, ip: ip() }),
      acceptInvitationAsNewUser({ token, displayName: "Docente", password, ip: ip() }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((result) => result.status === "rejected");
    expect(lost).toMatchObject({ reason: { code: expect.stringMatching(/^(CONFLICT|INVALID)$/) } });
    expect(await authUsersWith(address)).toBe(1);
    const user = (await readRows<{ id: string }>("select id from auth.users where lower(email) = $1", [address]))[0];
    expect(await membershipsOf(user?.id ?? "", school.institution.id)).toBe(1);
  });

  it("a revocation between the account and the step that finishes leaves the account with no membership; inviting again and accepting with a session creates it", async () => {
    const address = email();
    const { school, token } = await invite(address);
    const tokenHash = hashToken(token);
    const password = strongPassword();
    const { userId } = await createInvitedAccount({ tokenHash, invitationId: (await invitationRow(school.institution.id, address))?.id ?? "", email: address, password, displayName: "Docente" });

    const row = await invitationRow(school.institution.id, address);
    await school.openAsAdmin();
    await revokeInvitation({ institutionId: school.institution.id, invitationId: row?.id ?? "", revision: row?.revision ?? 0 });
    signOutOfTheJar();

    await expect(finishInvitationSignup({ tokenHash, userId, displayName: "Docente" })).rejects.toMatchObject({ code: "INVALID" });
    expect(await membershipsOf(userId, school.institution.id)).toBe(0);
    expect(await readRows("select 1 from app.app_users where id = $1", [userId])).toHaveLength(0);

    await school.openAsAdmin();
    await inviteStaff({ institutionId: school.institution.id, emails: [address], role: "teacher", opKey: randomUUID(), origin: ORIGIN });
    const second = await tokenSentTo(address, 1);
    signOutOfTheJar();
    // The page now says «ya tenés cuenta»; the person enters with the password they chose and accepts.
    expect(await readInvitation({ token: second, ip: ip() })).toMatchObject({ hasAccount: true });
    await signInStaff({ email: address, password, ip: ip() });
    expect((await acceptInvitation({ token: second })).institutionId).toBe(school.institution.id);
    expect(await membershipsOf(userId, school.institution.id)).toBe(1);
    expect(await readRows("select 1 from app.app_users where id = $1", [userId])).toHaveLength(1);
  });

  it("an expired invitation makes no account", async () => {
    const address = email();
    const { school, token } = await invite(address);
    await readRows("update app.invitations set expires_at = now() - interval '1 minute' where institution_id = $1 and email = $2", [school.institution.id, address]);
    await expect(acceptInvitationAsNewUser({ token, displayName: "Docente", password: strongPassword(), ip: ip() })).rejects.toMatchObject({ code: "INVALID" });
    expect(await authUsersWith(address)).toBe(0);
  });

  it("a password that Auth does not accept is INVALID and leaves no account", async () => {
    const address = email();
    const { token } = await invite(address);
    await expect(acceptInvitationAsNewUser({ token, displayName: "Docente", password: "corta", ip: ip() })).rejects.toMatchObject({ code: "INVALID" });
    expect(await authUsersWith(address)).toBe(0);
  });
});
