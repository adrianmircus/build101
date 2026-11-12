import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuthUser, getAuthUser } from "@/lib/server/repos/admin/auth-users";
import { callRpc } from "@/lib/server/repos/rpc";
import { createAdminClient } from "@/lib/server/db/admin";
import { provisionStudent } from "@/lib/server/services/admin/provisioning";
import { readRows } from "../support/db";
import { authAccountsOf, authRow, provisioningRow, purgeSchools, scene, watchFetch } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());
// The provisioning of the Auth account of a student (T2.5b, «Aprovisionar una cuenta de estudiante») against the local Supabase:
// one account whatever the order or the repetition, first ask and then create, a suppressed account never comes back and one that
// vanished comes back with the same id. Auth is real; a fetch that is made to fail plays an outage.

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
});
afterEach(() => vi.restoreAllMocks());
afterAll(purgeSchools, 60_000);

const admin = () => createAdminClient();
const remember = async (provisioningId: string, authUserId: string) =>
  callRpc(admin(), "internal_remember_student_account", { p_provisioning_id: provisioningId, p_auth_user_id: authUserId });

async function student() {
  const s = await scene(1);
  const only = s.students[0];
  if (only === undefined) throw new Error("Falta el estudiante.");
  return only;
}

const studentRow = async (studentId: string) =>
  (await readRows<{ user_id: string | null }>("select user_id::text from app.students where id = $1", [studentId]))[0];

describe("provisionStudent", () => {
  it("creates one account with no password: the id that was remembered, the synthetic email and the provisioning id in app_metadata", async () => {
    const s = await student();
    expect(await provisionStudent({ studentId: s.id, provisioningId: s.provisioningId })).toBe("active");

    const row = await provisioningRow(s.provisioningId);
    expect(row).toMatchObject({ status: "active", error_code: null });
    const id = row?.auth_user_id ?? "";
    const account = await authRow(id);
    expect(account).toEqual({ id, email: `${id}@estudiantes.usetiza.app`, password: "", provisioning: s.provisioningId });
    expect((await studentRow(s.id))?.user_id).toBe(id);
    expect(await authAccountsOf(s.provisioningId)).toBe(1);
  });

  it("asks Auth first and only then creates (getUserById before createUser), and a repeat only asks", async () => {
    const s = await student();
    const watch = watchFetch();
    await provisionStudent({ studentId: s.id, provisioningId: s.provisioningId });
    const first = watch.calls.filter((call) => call.path.startsWith("/auth/v1/admin/users"));
    expect(first.map((call) => call.method)).toEqual(["GET", "POST"]);

    watch.calls.length = 0;
    expect(await provisionStudent({ studentId: s.id, provisioningId: s.provisioningId })).toBe("active");
    expect(watch.calls.filter((call) => call.path.startsWith("/auth/v1/admin/users")).map((call) => call.method)).toEqual(["GET"]);
    watch.restore();
    expect(await authAccountsOf(s.provisioningId)).toBe(1);
  });

  it("two at the same time end in one account", async () => {
    const s = await student();
    const outcomes = await Promise.all([1, 2, 3].map(() => provisionStudent({ studentId: s.id, provisioningId: s.provisioningId })));
    expect(outcomes).toEqual(["active", "active", "active"]);
    expect(await authAccountsOf(s.provisioningId)).toBe(1);
    const row = await provisioningRow(s.provisioningId);
    expect((await studentRow(s.id))?.user_id).toBe(row?.auth_user_id);
  });

  describe("a retry after each step converges in a single account, with the id that was remembered", () => {
    const converges = async (s: Awaited<ReturnType<typeof student>>, id: string) => {
      expect(await provisionStudent({ studentId: s.id, provisioningId: s.provisioningId })).toBe("active");
      expect(await provisionStudent({ studentId: s.id, provisioningId: s.provisioningId })).toBe("active");
      const row = await provisioningRow(s.provisioningId);
      expect(row).toMatchObject({ status: "active", auth_user_id: id });
      expect(await authAccountsOf(s.provisioningId)).toBe(1);
      expect(await authRow(id)).toMatchObject({ email: `${id}@estudiantes.usetiza.app`, password: "" });
      expect((await studentRow(s.id))?.user_id).toBe(id);
    };

    it("after remembering the id and before Auth knows it", async () => {
      const s = await student();
      const id = randomUUID();
      expect(await remember(s.provisioningId, id)).toEqual({ ok: true, authUserId: id });
      await converges(s, id);
    });

    it("after Auth created the account and before the app user and the link", async () => {
      const s = await student();
      const id = randomUUID();
      await remember(s.provisioningId, id);
      await createAuthUser({ id, email: `${id}@estudiantes.usetiza.app`, appMetadata: { provisioning_id: s.provisioningId } });
      await converges(s, id);
    });

    it("after the app user and before the link", async () => {
      const s = await student();
      const id = randomUUID();
      await remember(s.provisioningId, id);
      await createAuthUser({ id, email: `${id}@estudiantes.usetiza.app`, appMetadata: { provisioning_id: s.provisioningId } });
      await callRpc(admin(), "internal_upsert_app_user", { p_user_id: id });
      await converges(s, id);
    });

    it("after the whole thing (an `active` row is a no-op)", async () => {
      const s = await student();
      await provisionStudent({ studentId: s.id, provisioningId: s.provisioningId });
      const id = (await provisioningRow(s.provisioningId))?.auth_user_id ?? "";
      await converges(s, id);
    });

    it("when Auth does not answer on the first try: nothing is marked, and the retry creates the account", async () => {
      const s = await student();
      const down = watchFetch((call) => (call.method === "POST" && call.path === "/auth/v1/admin/users" ? new Response("{}", { status: 503 }) : undefined));
      expect(await provisionStudent({ studentId: s.id, provisioningId: s.provisioningId })).toBe("uncertain");
      down.restore();
      const after = await provisioningRow(s.provisioningId);
      // The id was remembered before Auth was asked: the retry uses it, never another.
      expect(after).toMatchObject({ status: "pending", error_code: null });
      const id = after?.auth_user_id ?? "";
      expect(id).not.toBe("");
      expect(await authRow(id)).toBeUndefined();
      await converges(s, id);
    });

    it("when Auth cannot be asked: the answer is uncertain, nothing is created and nothing is marked", async () => {
      const s = await student();
      await remember(s.provisioningId, randomUUID());
      const down = watchFetch((call) => (call.method === "GET" && call.path.startsWith("/auth/v1/admin/users/") ? new Response("{}", { status: 500 }) : undefined));
      expect(await provisionStudent({ studentId: s.id, provisioningId: s.provisioningId })).toBe("uncertain");
      expect(down.calls.some((call) => call.method === "POST" && call.path === "/auth/v1/admin/users")).toBe(false);
      down.restore();
      expect(await provisioningRow(s.provisioningId)).toMatchObject({ status: "pending", error_code: null });
    });
  });

  it("an account that is not ours under the remembered id is account_mismatch: the row fails and Auth is left as it was", async () => {
    const s = await student();
    const id = randomUUID();
    await remember(s.provisioningId, id);
    await createAuthUser({ id, email: `${id}@estudiantes.usetiza.app`, appMetadata: { provisioning_id: randomUUID() } });
    const before = await authRow(id);
    expect(await provisionStudent({ studentId: s.id, provisioningId: s.provisioningId })).toBe("failed");
    expect(await provisioningRow(s.provisioningId)).toMatchObject({ status: "failed", error_code: "account_mismatch", auth_user_id: id });
    expect(await authRow(id)).toEqual(before);
    expect((await studentRow(s.id))?.user_id).toBeNull();
  });

  it("the account of a suppressed student (deleted) is never created again, and Auth is not even asked", async () => {
    const s = await student();
    const id = randomUUID();
    await remember(s.provisioningId, id);
    await readRows("update app.account_provisioning set status = 'deleted' where id = $1", [s.provisioningId]);
    const watch = watchFetch();
    expect(await provisionStudent({ studentId: s.id, provisioningId: s.provisioningId })).toBe("failed");
    expect(watch.calls.filter((call) => call.path.startsWith("/auth/v1/admin/"))).toEqual([]);
    watch.restore();
    expect(await getAuthUser(id)).toBeNull();
    expect((await provisioningRow(s.provisioningId))?.status).toBe("deleted");
  });

  it("a row that is not this student's, or that does not exist, stops before any call to Auth", async () => {
    const s = await student();
    const other = await student();
    const watch = watchFetch();
    expect(await provisionStudent({ studentId: s.id, provisioningId: other.provisioningId })).toBe("failed");
    expect(await provisionStudent({ studentId: randomUUID(), provisioningId: randomUUID() })).toBe("failed");
    expect(watch.calls.filter((call) => call.path.startsWith("/auth/v1/admin/"))).toEqual([]);
    watch.restore();
  });
});
