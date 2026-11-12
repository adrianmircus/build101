import { randomUUID } from "node:crypto";
import { describe, expect, it, afterAll } from "vitest";
import { hashToken, newToken } from "@/lib/server/auth/tokens";
import { createAuthUser } from "@/lib/server/repos/admin/auth-users";
import { callRpc } from "@/lib/server/repos/rpc";
import { countRows } from "../support/db";
import { heldRace } from "../support/race";
import { describeOutcome } from "../support/session";
import { SERVICE } from "../support/world";
import { adminSchool, purgeSchools, email, strongPassword } from "./support";

// Two connections on the same invitation (T2.3), with the lessons of phase 1: the first call keeps its transaction open with its
// locks, the second starts, is seen BLOCKED in pg_stat_activity, and only then does the first commit. If an RPC did not take the
// lock of the invitation before reading it, the second would not block and would run against a world without the first one.
// The lock is the advisory one of (institution, email) and, under it, the row of the invitation FOR UPDATE.

async function made(role: "teacher" | "admin" | "inclusion" = "teacher") {
  const school = await adminSchool();
  const address = email();
  const token = newToken();
  const created = await callRpc(school.owner.client, "create_invitation", {
    p_institution_id: school.institution.id,
    p_email: address,
    p_role: role,
    p_token_hash: hashToken(token),
    p_op_key: randomUUID(),
  });
  return { school, address, token, invitationId: created.id };
}

const MEMBERS = "select count(*)::text as n from app.memberships where user_id = $1 and institution_id = $2 and revoked_at is null";

afterAll(purgeSchools, 60_000);

describe("race: create_invitation with the same op_key", () => {
  it("the second waits on the advisory lock and answers the same invitation, replayed, with one row", async () => {
    const school = await adminSchool();
    const address = email();
    const opKey = randomUUID();
    const step = () => ({
      actor: { role: "authenticated" as const, userId: school.owner.id },
      rpc: "create_invitation",
      args: { p_institution_id: school.institution.id, p_email: address, p_role: "teacher", p_token_hash: hashToken(newToken()), p_op_key: opKey },
    });
    const held = await heldRace(step(), step());
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).toBe("advisory");
    expect(held.second.ok).toBe(true);
    if (held.first.ok && held.second.ok) {
      expect(held.second.value).toMatchObject({ id: held.first.value.id, replayed: true });
      expect(held.first.value.replayed).toBe(false);
    }
    expect(await countRows("select count(*)::text as n from app.invitations where institution_id = $1 and email = $2", [school.institution.id, address])).toBe(1);
  });
});

describe("race: two acceptances of the same invitation", () => {
  it("the second waits on the advisory lock, answers the same and leaves one membership", async () => {
    const { school, address, token } = await made();
    const account = await createAuthUser({ id: randomUUID(), email: address, password: strongPassword(), appMetadata: {} });
    const step = () => ({ actor: { role: "authenticated" as const, userId: account.id }, rpc: "accept_invitation", args: { p_token_hash: hashToken(token) } });
    const held = await heldRace(step(), step());
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).toBe("advisory");
    expect(held.second).toEqual(held.first);
    expect(await countRows(MEMBERS, [account.id, school.institution.id])).toBe(1);
  });
});

describe("race: a revocation and the signup that is finishing", () => {
  it("revoked first: the signup waits, finds it closed and leaves no membership", async () => {
    const { school, address, token, invitationId } = await made();
    const account = await createAuthUser({ id: randomUUID(), email: address, password: strongPassword(), appMetadata: { invitation_id: invitationId } });
    const revoke = { actor: { role: "authenticated" as const, userId: school.owner.id }, rpc: "revoke_invitation", args: { p_invitation_id: invitationId, p_revision: 1 } };
    const finish = { actor: SERVICE, rpc: "internal_finish_invitation_signup", args: { p_token_hash: hashToken(token), p_user_id: account.id, p_display_name: "Docente" } };
    const held = await heldRace(revoke, finish);
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("P0001 INVALID invitation_closed");
    expect(await countRows(MEMBERS, [account.id, school.institution.id])).toBe(0);
  });

  it("finished first: the revocation waits and finds it accepted, so the membership stays", async () => {
    const { school, address, token, invitationId } = await made();
    const account = await createAuthUser({ id: randomUUID(), email: address, password: strongPassword(), appMetadata: { invitation_id: invitationId } });
    const finish = { actor: SERVICE, rpc: "internal_finish_invitation_signup", args: { p_token_hash: hashToken(token), p_user_id: account.id, p_display_name: "Docente" } };
    const revoke = { actor: { role: "authenticated" as const, userId: school.owner.id }, rpc: "revoke_invitation", args: { p_invitation_id: invitationId, p_revision: 1 } };
    const held = await heldRace(finish, revoke);
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("P0001 INVALID invitation_closed");
    expect(await countRows(MEMBERS, [account.id, school.institution.id])).toBe(1);
  });
});

describe("race: a resend and a late mark", () => {
  it("the mark of the old revision waits for the resend and is revision_mismatch", async () => {
    const { school, invitationId } = await made();
    const admin = { role: "authenticated" as const, userId: school.owner.id };
    const resend = { actor: admin, rpc: "resend_invitation", args: { p_invitation_id: invitationId, p_revision: 1, p_token_hash: hashToken(newToken()) } };
    const mark = { actor: admin, rpc: "mark_invitation_sent", args: { p_invitation_id: invitationId, p_revision: 1 } };
    const held = await heldRace(resend, mark);
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect(await countRows("select count(*)::text as n from app.invitations where id = $1 and sent_at is null and revision = 2", [invitationId])).toBe(1);
  });
});
