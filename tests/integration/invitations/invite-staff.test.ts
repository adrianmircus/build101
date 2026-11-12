import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, afterAll } from "vitest";
import { callRpc } from "@/lib/server/repos/rpc";
import { hashToken } from "@/lib/server/auth/tokens";
import { openSession, signOutOfTheJar } from "../support/cookie-jar";
import { latestMailTo, mailIdsTo } from "../support/mailbox";
import { adminSchool, purgeSchools, email, invitationRow, ip, ORIGIN, tokenSentTo } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());

import { getInstitutionSummary, listInvitations, listStaff } from "@/lib/server/services/institution";
import { inviteStaff, readInvitation, resendInvitation, revokeInvitation } from "@/lib/server/services/invitations";

// What an admin does with invitations, through the services, against the local Supabase and Mailpit (T2.3): the mail goes out
// with the link in the fragment, a repeated request does not send twice, a lost mail is sent again with a new token, and
// the token that was replaced stops working.

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
});
beforeEach(signOutOfTheJar);
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MAIL_MAILPIT_URL;
});

afterAll(purgeSchools, 60_000);

describe("inviteStaff", () => {
  it("sends one mail per new email with the link in the fragment, and says why the others did not", async () => {
    const school = await adminSchool();
    await school.openAsAdmin();
    const newcomer = email();
    const request = { institutionId: school.institution.id, role: "teacher" as const, opKey: randomUUID(), origin: ORIGIN };
    const results = await inviteStaff({ ...request, emails: [newcomer, school.teacher.email, "x@estudiantes.usetiza.app"] });

    expect(results.map((row) => row.outcome)).toEqual(["sent", "already_member", "invalid_email"]);
    expect(results.map((row) => row.email)).toEqual([newcomer, school.teacher.email, "x@estudiantes.usetiza.app"]);
    expect(results[0]?.invitationId).toEqual(expect.any(String));
    expect(results[1]?.invitationId).toBeNull();

    const mail = await latestMailTo(newcomer);
    expect(mail?.subject).toBe(`Te invitaron a ${school.institution.name} en Tiza`);
    expect(mail?.text).toContain(`${ORIGIN}/invitacion#`);
    expect(mail?.text).toContain("como docente");
    expect(await mailIdsTo(school.teacher.email)).toEqual([]);
    expect(await invitationRow(school.institution.id, newcomer)).toMatchObject({ status: "pending", revision: 1, sent: true });

    const listed = await listInvitations(school.institution.id);
    expect(listed.map((row) => row.email)).toEqual([newcomer]);
    expect((await getInstitutionSummary(school.institution.id)).pendingInvitations).toBe(1);
    expect((await listStaff(school.institution.id)).map((row) => row.userId)).toContain(school.owner.id);
  });

  it("the link opens the page of that invitation for somebody with no session", async () => {
    const school = await adminSchool();
    await school.openAsAdmin();
    const guest = email();
    await inviteStaff({ institutionId: school.institution.id, emails: [guest], role: "inclusion", opKey: randomUUID(), origin: ORIGIN });
    const token = await tokenSentTo(guest);

    expect(await readInvitation({ token, ip: ip() })).toMatchObject({ email: guest, role: "inclusion", status: "pending", hasAccount: false, relation: "other", institutionName: school.institution.name });
    signOutOfTheJar();
    expect(await readInvitation({ token, ip: ip() })).toMatchObject({ relation: "none" });
    await expect(readInvitation({ token: "a".repeat(43), ip: ip() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("repeating the request with the same opKey does not send the mail twice", async () => {
    const school = await adminSchool();
    await school.openAsAdmin();
    const guest = email();
    const request = { institutionId: school.institution.id, emails: [guest], role: "teacher" as const, opKey: randomUUID(), origin: ORIGIN };
    expect((await inviteStaff(request))[0]?.outcome).toBe("sent");
    expect((await inviteStaff(request))[0]?.outcome).toBe("sent");
    expect(await mailIdsTo(guest)).toHaveLength(1);
    // Another request for the same email and role is not a repeat: there is one pending already.
    expect((await inviteStaff({ ...request, opKey: randomUUID() }))[0]?.outcome).toBe("invitation_pending");
  });

  it("a mail that did not go out is `mail_failed`; repeating the request sends it with a new token and the lost one stops working", async () => {
    const school = await adminSchool();
    await school.openAsAdmin();
    const guest = email();
    const request = { institutionId: school.institution.id, emails: [guest], role: "teacher" as const, opKey: randomUUID(), origin: ORIGIN };

    process.env.MAIL_MAILPIT_URL = "http://127.0.0.1:1";
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failed = await inviteStaff(request);
    expect(failed[0]?.outcome).toBe("mail_failed");
    expect(await invitationRow(school.institution.id, guest)).toMatchObject({ status: "pending", revision: 1, sent: false });
    expect((await listInvitations(school.institution.id))[0]?.sentAt).toBeNull();

    delete process.env.MAIL_MAILPIT_URL;
    const again = await inviteStaff(request);
    expect(again[0]?.outcome).toBe("sent");
    expect(await invitationRow(school.institution.id, guest)).toMatchObject({ status: "pending", revision: 2, sent: true });
    const token = await tokenSentTo(guest);
    expect(await readInvitation({ token, ip: ip() })).toMatchObject({ email: guest, status: "pending" });
  });

  it("only an admin of the institution invites: a teacher and another institution get FORBIDDEN and NOT_FOUND, and no mail", async () => {
    const school = await adminSchool();
    const other = await adminSchool();
    const guest = email();
    const request = { institutionId: school.institution.id, emails: [guest], role: "teacher" as const, opKey: randomUUID(), origin: ORIGIN };

    await other.openAsAdmin();
    await expect(inviteStaff(request)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await openSession(school.teacher);
    await expect(inviteStaff(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await mailIdsTo(guest)).toEqual([]);
  });
});

describe("resendInvitation and revokeInvitation", () => {
  async function invited() {
    const school = await adminSchool();
    await school.openAsAdmin();
    const guest = email();
    await inviteStaff({ institutionId: school.institution.id, emails: [guest], role: "teacher", opKey: randomUUID(), origin: ORIGIN });
    const first = await tokenSentTo(guest);
    const row = await invitationRow(school.institution.id, guest);
    if (row === undefined) throw new Error("Falta la invitación.");
    return { school, guest, first, row };
  }

  it("resending rotates the token: the mail with the new one goes out and the old one stops working", async () => {
    const { school, guest, first, row } = await invited();
    const resent = await resendInvitation({ institutionId: school.institution.id, invitationId: row.id, revision: row.revision, origin: ORIGIN });
    expect(resent).toMatchObject({ id: row.id, revision: row.revision + 1, mailSent: true });
    expect(await mailIdsTo(guest)).toHaveLength(2);
    const second = await tokenSentTo(guest, 1);
    expect(second).not.toBe(first);
    await expect(readInvitation({ token: first, ip: ip() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await readInvitation({ token: second, ip: ip() })).toMatchObject({ status: "pending" });
    expect(await invitationRow(school.institution.id, guest)).toMatchObject({ revision: row.revision + 1, sent: true });
  });

  it("a stale revision is CONFLICT and sends nothing", async () => {
    const { school, guest, row } = await invited();
    await resendInvitation({ institutionId: school.institution.id, invitationId: row.id, revision: row.revision, origin: ORIGIN });
    await expect(resendInvitation({ institutionId: school.institution.id, invitationId: row.id, revision: row.revision, origin: ORIGIN })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await mailIdsTo(guest)).toHaveLength(2);
  });

  it("a mark of a token that was replaced is revision_mismatch (the late one of a slow mail)", async () => {
    const { school, row } = await invited();
    await resendInvitation({ institutionId: school.institution.id, invitationId: row.id, revision: row.revision, origin: ORIGIN });
    const late = callRpc(school.owner.client, "mark_invitation_sent", { p_invitation_id: row.id, p_revision: row.revision });
    await expect(late).rejects.toMatchObject({ code: "CONFLICT", message: "Alguien cambió esto mientras lo editabas. Recargá para ver lo último." });
  });

  it("revoking closes the link: it reads as revoked and cannot be resent", async () => {
    const { school, first, row } = await invited();
    expect(await revokeInvitation({ institutionId: school.institution.id, invitationId: row.id, revision: row.revision })).toEqual({ id: row.id });
    expect(await readInvitation({ token: first, ip: ip() })).toMatchObject({ status: "revoked" });
    await expect(resendInvitation({ institutionId: school.institution.id, invitationId: row.id, revision: row.revision + 1, origin: ORIGIN })).rejects.toMatchObject({ code: "INVALID" });
    expect(await invitationRow(school.institution.id, (await readInvitation({ token: first, ip: ip() })).email)).toMatchObject({ status: "revoked" });
  });

  it("a spent hash is not used again, not even by an admin who sends it", async () => {
    const { school, first, row } = await invited();
    await resendInvitation({ institutionId: school.institution.id, invitationId: row.id, revision: row.revision, origin: ORIGIN });
    const reuse = callRpc(school.owner.client, "resend_invitation", { p_invitation_id: row.id, p_revision: row.revision + 1, p_token_hash: hashToken(first) });
    await expect(reuse).rejects.toMatchObject({ code: "INVALID" });
  });
});
