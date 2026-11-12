import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/server/db/admin";
import { deleteAuthUser, getAuthUser } from "@/lib/server/repos/admin/auth-users";
import { callRpc } from "@/lib/server/repos/rpc";
import { readRows } from "../support/db";
import { authAccountsOf, authRow, provisioningRow, purgeSchools, scene, withCard } from "./support";

vi.mock("next/headers", async () => (await import("../support/cookie-jar")).nextHeadersMock());
// The database is shared with other runs, and reconcile would also take up the rows they left half done. So the list of unfinished
// accounts is cut down to the students of the test: the same rows the RPC describes (a provisioning that started and did not finish,
// an active account that is gone from Auth), asked for these students only. The rest of reconcile is the real one.
const scope = vi.hoisted((): { students: string[] | null } => ({ students: null }));
vi.mock("@/lib/server/repos/admin/student-accounts", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/repos/admin/student-accounts")>("@/lib/server/repos/admin/student-accounts");
  const accounts = await vi.importActual<typeof import("@/lib/server/repos/admin/auth-users")>("@/lib/server/repos/admin/auth-users");
  return {
    ...actual,
    listUnfinishedAccounts: async (admin: Parameters<typeof actual.listUnfinishedAccounts>[0], limit: number) => {
      if (scope.students === null) return actual.listUnfinishedAccounts(admin, limit);
      const rows = (await actual.getStudentAccounts(admin, scope.students)).filter((row) => row.authUserId !== null);
      const unfinished = await Promise.all(rows.map(async (row) => (row.status === "active" ? (await accounts.getAuthUser(row.authUserId ?? "")) === null : row.status !== "deleted")));
      return rows.filter((_row, index) => unfinished[index]).slice(0, limit);
    },
  };
});


import { provisionStudent, reconcile } from "@/lib/server/services/admin/provisioning";
import { signInStudent } from "@/lib/server/services/student-auth";

// reconcile (T2.5b): takes up the provisionings that started and did not finish, recreates with the same id an active account that
// somebody deleted from Auth, and never recreates the account of a suppressed student. Auth is real.

beforeAll(() => {
  process.env.RATE_LIMIT_SECRET = "t".repeat(40);
});
afterEach(() => vi.restoreAllMocks());
afterAll(purgeSchools, 60_000);

const remember = async (provisioningId: string, authUserId: string) =>
  callRpc(createAdminClient(), "internal_remember_student_account", { p_provisioning_id: provisioningId, p_auth_user_id: authUserId });

async function student() {
  const s = await scene(1);
  const only = s.students[0];
  if (only === undefined) throw new Error("Falta el estudiante.");
  return only;
}

/** reconcile, over the rows of this student only. */
async function reconcileOnly(studentId: string) {
  scope.students = [studentId];
  try {
    return await reconcile(200);
  } finally {
    scope.students = null;
  }
}

const studentRow = async (studentId: string) =>
  (await readRows<{ user_id: string | null }>("select user_id::text from app.students where id = $1", [studentId]))[0];

describe("reconcile", () => {
  it("takes up a provisioning that started and did not finish, with the same id", async () => {
    const s = await student();
    const id = randomUUID();
    await remember(s.provisioningId, id);
    // A row that only remembered the id is `pending` with an id and no account: that is what reconcile picks up.
    const summary = await reconcileOnly(s.id);
    expect(summary).toEqual({ done: 1, failed: 0 });
    expect(await provisioningRow(s.provisioningId)).toMatchObject({ status: "active", auth_user_id: id });
    expect(await authAccountsOf(s.provisioningId)).toBe(1);
  });

  it("recreates with the same id an active account that somebody deleted from Auth, and keeps the identity of the student", async () => {
    const s = await student();
    await provisionStudent({ studentId: s.id, provisioningId: s.provisioningId });
    const id = (await provisioningRow(s.provisioningId))?.auth_user_id ?? "";
    await deleteAuthUser(id);
    expect(await getAuthUser(id)).toBeNull();

    expect(await reconcileOnly(s.id)).toEqual({ done: 1, failed: 0 });

    expect(await authAccountsOf(s.provisioningId)).toBe(1);
    expect(await authRow(id)).toMatchObject({ id, email: `${id}@estudiantes.usetiza.app`, password: "" });
    expect(await provisioningRow(s.provisioningId)).toMatchObject({ status: "active", auth_user_id: id });
    expect((await studentRow(s.id))?.user_id).toBe(id);
  });

  it("does not recreate the account of a suppressed student that is gone from Auth", async () => {
    const s = await student();
    await provisionStudent({ studentId: s.id, provisioningId: s.provisioningId });
    const id = (await provisioningRow(s.provisioningId))?.auth_user_id ?? "";
    await readRows("update app.account_provisioning set status = 'deleted' where id = $1", [s.provisioningId]);
    await deleteAuthUser(id);
    // The list of the RPC never has a deleted row, and nothing recreates it.
    expect(await reconcileOnly(s.id)).toEqual({ done: 0, failed: 0 });
    expect(await getAuthUser(id)).toBeNull();
    expect((await provisioningRow(s.provisioningId))?.status).toBe("deleted");
  });

  it("the student gets in again with the password of his card after his account was recreated", async () => {
    const { student: enrolled, card, userId, login } = await withCard();
    await deleteAuthUser(userId);
    // Without the account the student is not linked to anything: the login finds nothing and says the generic error.
    await expect(signInStudent(login())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await reconcileOnly(enrolled.id)).toEqual({ done: 1, failed: 0 });
    expect(await authRow(userId)).toMatchObject({ id: userId, password: "" });
    expect(await signInStudent(login(card.password))).toEqual({ next: "/estudiante" });
  });
});
