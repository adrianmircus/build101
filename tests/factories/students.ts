import { randomUUID } from "node:crypto";
import type { AdminClient } from "@/lib/server/db/admin";
import { upsertAppUser } from "@/lib/server/repos/admin/identity";
import { linkStudentUser } from "@/lib/server/repos/admin/students";
import { callRpc, type RpcDb } from "@/lib/server/repos/rpc";
import { readRows } from "../integration/support/db";
import { createUserClient, type TestClient } from "./clients";

// A student is always made through create_student, as the logged-in teacher of the group (which
// also enrolls them). Only a test that needs a logged-in student links an Auth account, with the
// internal RPC, as the account provisioning of T2.5 will.

export type StudentOptions = { displayName?: string; username?: string };

export type TestStudent = {
  id: string;
  revision: number;
  displayName: string;
  username: string;
};

export async function createStudent(
  teacher: RpcDb,
  groupId: string,
  options: StudentOptions = {},
): Promise<TestStudent> {
  const displayName = options.displayName ?? "Estudiante de prueba";
  // Unique inside the institution: the database rejects a repeated username.
  const username = options.username ?? `est-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const { id, revision } = await callRpc(teacher, "create_student", {
    p_group_id: groupId,
    p_display_name: displayName,
    p_username: username,
    p_op_key: randomUUID(),
  });
  return { id, revision, displayName, username };
}

export type LoggedInStudent = TestStudent & {
  userId: string;
  client: TestClient;
};

/** The student with an Auth account linked and a session open: what their own browser sees. */
export async function createLoggedInStudent(admin: AdminClient, student: TestStudent): Promise<LoggedInStudent> {
  const email = `${randomUUID()}@tiza-test.example`;
  const password = `${randomUUID()}${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`No se pudo crear el usuario de prueba (${error.code ?? "sin código"}).`);

  const userId = data.user.id;
  await upsertAppUser(admin, userId, student.displayName);
  await linkStudentUser(admin, student.id, userId);
  return {
    ...student,
    userId,
    client: await createUserClient({ email, password }),
  };
}

export type AuditRow = {
  action: string;
  entity: string;
  entity_id: string | null;
  student_ids: string[];
  institution_id: string;
};

/** What the audited reads of one request left in audit_log (read with the database owner's rights). */
export async function auditRows(requestId: string): Promise<AuditRow[]> {
  return readRows<AuditRow>(
    "select action, entity, entity_id, student_ids, institution_id from app.audit_log where request_id = $1 order by created_at",
    [requestId],
  );
}
