import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuthAdminError, createAuthUser, deleteAuthUser, exchangeMagicLink, getAuthUser, magicLinkToken } from "@/lib/server/repos/admin/auth-users";
import { readRows } from "../support/db";

// The admin API of Auth against the local Supabase (T2.3): create, read and delete a user, and the two halves of the magic link
// that T2.5b uses to open a session without a password and without cookies.

const fresh = () => ({ id: randomUUID(), email: `${randomUUID()}@tiza-test.example` });
const password = () => `${randomUUID()}${randomUUID()}`;
const sessionsOf = async (userId: string) =>
  Number((await readRows<{ n: string }>("select count(*)::text as n from auth.sessions where user_id = $1", [userId]))[0]?.n);

describe("createAuthUser, getAuthUser and deleteAuthUser", () => {
  it("creates a confirmed user with the id and the metadata asked for, reads it back and deletes it for good", async () => {
    const { id, email } = fresh();
    const created = await createAuthUser({ id, email, password: password(), appMetadata: { invitation_id: "inv-1" }, userMetadata: { display_name: "Docente" } });
    expect(created).toMatchObject({ id, email, appMetadata: expect.objectContaining({ invitation_id: "inv-1" }) });
    const rows = await readRows<{ confirmed: boolean; name: string | null }>(
      "select email_confirmed_at is not null as confirmed, raw_user_meta_data ->> 'display_name' as name from auth.users where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ confirmed: true, name: "Docente" });

    expect(await getAuthUser(id)).toMatchObject({ id, email });
    await deleteAuthUser(id);
    expect(await getAuthUser(id)).toBeNull();
    expect(await readRows("select 1 from auth.users where id = $1", [id])).toHaveLength(0);
  });

  it("an email that is taken is `exists`, and the account that had it keeps its password", async () => {
    const { id, email } = fresh();
    await createAuthUser({ id, email, password: password(), appMetadata: {} });
    const hashOf = () => readRows<{ hash: string }>("select encrypted_password as hash from auth.users where id = $1", [id]);
    const before = await hashOf();
    const clash = await createAuthUser({ id: randomUUID(), email, password: password(), appMetadata: {} }).catch((thrown: unknown) => thrown);
    expect(clash).toBeInstanceOf(AuthAdminError);
    expect(clash).toMatchObject({ kind: "exists" });
    expect(await hashOf()).toEqual(before);
    await deleteAuthUser(id);
  });

  it("a user that does not exist is null, and deleting it again is not an error", async () => {
    const { id } = fresh();
    expect(await getAuthUser(id)).toBeNull();
    await expect(deleteAuthUser(id)).resolves.toBeUndefined();
  });
});

describe("magicLinkToken and exchangeMagicLink", () => {
  it("make a session with its id and tokens, with no mail and no cookies, and the link works once", async () => {
    const { id, email } = fresh();
    await createAuthUser({ id, email, password: password(), appMetadata: {} });

    const link = await magicLinkToken(email);
    expect(link).toMatchObject({ userId: id, verificationType: "magiclink" });
    expect(link.hashedToken.length).toBeGreaterThan(10);

    const session = await exchangeMagicLink(link.hashedToken);
    expect(session.userId).toBe(id);
    expect(session.accessToken.split(".")).toHaveLength(3);
    expect(session.refreshToken.length).toBeGreaterThan(5);
    const stored = await readRows<{ user_id: string }>("select user_id from auth.sessions where id = $1", [session.sessionId]);
    expect(stored).toEqual([{ user_id: id }]);
    expect(await sessionsOf(id)).toBe(1);

    const again = await exchangeMagicLink(link.hashedToken).catch((thrown: unknown) => thrown);
    expect(again).toBeInstanceOf(AuthAdminError);
    expect(again).toMatchObject({ kind: "invalid" });
    expect(await sessionsOf(id)).toBe(1);
    await deleteAuthUser(id);
  });

  it("a token that never existed is `invalid`", async () => {
    await expect(exchangeMagicLink("0".repeat(64))).rejects.toMatchObject({ kind: "invalid" });
  });
});
