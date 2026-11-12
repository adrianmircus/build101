import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGroup, createSchool } from "../../factories";
import { createLoggedInStudent, createStudent } from "../../factories/students";
import { openSession, readRows } from "../support/db";

// F2C-47: a student does not change his own credentials in Auth. PUT /auth/v1/user with the session of the student writes
// encrypted_password or email; the trigger app.student_credentials_guard on auth.users refuses it unless the account holds a
// live lease (the minutes of a card issue). The real endpoint, through supabase-js, with the session of a logged-in student.

async function student() {
  const school = await createSchool();
  const group = await createGroup(school.teacher.client, school.institution.id);
  const created = await createStudent(school.teacher.client, group.id);
  return createLoggedInStudent(school.admin, created);
}

async function leaseFor(studentId: string, interval: string) {
  const session = await openSession();
  try {
    await session.rows(`update app.account_provisioning set lease_until = clock_timestamp() + interval '${interval}', lease_holder = $2 where student_id = $1`, [studentId, randomUUID()]);
  } finally {
    await session.close();
  }
}

async function passwordHash(userId: string): Promise<string> {
  return (await readRows<{ h: string }>("select encrypted_password as h from auth.users where id = $1", [userId]))[0]?.h ?? "";
}

describe("a student cannot change his credentials in Auth", () => {
  it("PUT /auth/v1/user with his session fails for the password and leaves the email as it was", async () => {
    const me = await student();
    const before = await passwordHash(me.userId);
    const emailBefore = (await readRows<{ email: string }>("select email from auth.users where id = $1", [me.userId]))[0]?.email;

    const password = await me.client.auth.updateUser({ password: `${randomUUID()}${randomUUID()}` });
    expect(password.error).not.toBeNull();
    // The email does not change on the PUT: Auth keeps the new address in email_change until the link sent to it is used, and
    // that confirmation is the UPDATE of email that the guard refuses (the pgTAP test 040 covers the UPDATE itself).
    await me.client.auth.updateUser({ email: `${randomUUID()}@tiza-test.example` });

    expect(await passwordHash(me.userId)).toBe(before);
    expect((await readRows<{ email: string }>("select email from auth.users where id = $1", [me.userId]))[0]?.email).toBe(emailBefore);
  });

  it("the same call goes through while the account holds a live lease (the minutes of a card issue)", async () => {
    const me = await student();
    const before = await passwordHash(me.userId);
    await leaseFor(me.id, "5 minutes");
    const changed = await me.client.auth.updateUser({ password: `${randomUUID()}${randomUUID()}` });
    expect(changed.error).toBeNull();
    expect(await passwordHash(me.userId)).not.toBe(before);
  });

  it("and fails again once the lease expired", async () => {
    const me = await student();
    await leaseFor(me.id, "-1 minute");
    const refused = await me.client.auth.updateUser({ password: `${randomUUID()}${randomUUID()}` });
    expect(refused.error).not.toBeNull();
  });
});
