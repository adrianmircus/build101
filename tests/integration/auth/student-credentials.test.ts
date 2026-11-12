import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGroup, createSchool } from "../../factories";
import { createLoggedInStudent, createStudent } from "../../factories/students";
import { createAdminClient } from "@/lib/server/db/admin";
import { readRows } from "../support/db";

// F2C-47: the password of a student lives in our database and the Auth account of a student has none. Nobody puts one there:
// PUT /auth/v1/user with the session of a student writes encrypted_password, and the trigger app.student_auth_guard on
// auth.users refuses it, always. The real endpoint, through supabase-js, with the session of a logged-in student.

async function student() {
  const school = await createSchool();
  const group = await createGroup(school.teacher.client, school.institution.id);
  const created = await createStudent(school.teacher.client, group.id);
  return createLoggedInStudent(school.admin, created);
}

async function authRow(userId: string): Promise<{ hash: string; email: string }> {
  const rows = await readRows<{ hash: string; email: string }>("select coalesce(encrypted_password, '') as hash, email from auth.users where id = $1", [userId]);
  return rows[0] ?? { hash: "", email: "" };
}

describe("a student cannot put a password on, or change the email of, his Auth account", () => {
  it("PUT /auth/v1/user with his session fails for the password and leaves the account as it was", async () => {
    const me = await student();
    const before = await authRow(me.userId);

    const password = await me.client.auth.updateUser({ password: `${randomUUID()}${randomUUID()}` });
    expect(password.error).not.toBeNull();
    expect(await authRow(me.userId)).toEqual(before);
  });

  it("asking for another email does not change it either: the confirmation is the update the guard refuses", async () => {
    const me = await student();
    const before = await authRow(me.userId);
    // Auth keeps the new address in email_change until the link sent to it is used; that confirmation is the UPDATE of
    // email, which the guard refuses (pgTAP 040 covers the UPDATE itself).
    await me.client.auth.updateUser({ email: `${randomUUID()}@tiza-test.example` });
    expect(await authRow(me.userId)).toEqual(before);
  });

  it("createUser without a password for a remembered id leaves encrypted_password NULL (F2C-65)", async () => {
    const school = await createSchool();
    const group = await createGroup(school.teacher.client, school.institution.id);
    const created = await createStudent(school.teacher.client, group.id);
    const id = randomUUID();
    await readRows("update app.account_provisioning set auth_user_id = $2 where student_id = $1", [created.id, id]);
    const { error } = await createAdminClient().auth.admin.createUser({ id, email: `${id}@estudiantes.usetiza.app`, email_confirm: true });
    expect(error).toBeNull();
    const rows = await readRows<{ hash: string | null }>("select encrypted_password as hash from auth.users where id = $1", [id]);
    expect(rows[0]?.hash).toBeNull();
  });

  it("a staff user still changes his password as ever", async () => {
    const school = await createSchool();
    const changed = await school.teacher.client.auth.updateUser({ password: `${randomUUID()}${randomUUID()}` });
    expect(changed.error).toBeNull();
  });
});
