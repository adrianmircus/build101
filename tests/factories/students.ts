import { randomUUID } from "node:crypto";
import type { AdminClient } from "@/lib/server/db/admin";
import { upsertAppUser } from "@/lib/server/repos/admin/identity";
import { linkStudentUser } from "@/lib/server/repos/admin/students";
import { callRpc, type RpcDb } from "@/lib/server/repos/rpc";
import { readRows } from "../integration/support/db";
import { createMagicLinkClient, sessionIdOf, type TestClient } from "./clients";

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

/** A hash in the format of the column (the real one is made by the server); no test checks a password with it. */
const PLACEHOLDER_HASH = `scrypt$15$8$1$${Buffer.alloc(16, 1).toString("base64")}$${Buffer.alloc(64, 2).toString("base64")}`;

/**
 * The student with a canonical Auth account linked, and no session: his id is remembered in the provisioning row before the
 * account is created, its email is <id>@estudiantes.usetiza.app and it has no password (docs/contratos/fase-2.md). It also gets a
 * credential of version 1 (as if a card had been issued), which a registered session needs. A sandbox student has no active
 * account in real life; the tests of phase 1 link one anyway, and this does the same.
 */
export async function createStudentAccount(admin: AdminClient, student: TestStudent): Promise<{ userId: string; email: string }> {
  const userId = randomUUID();
  const email = `${userId}@estudiantes.usetiza.app`;
  await readRows("update app.account_provisioning set auth_user_id = $2 where student_id = $1", [student.id, userId]);
  const { error } = await admin.auth.admin.createUser({ id: userId, email, email_confirm: true });
  if (error) throw new Error(`No se pudo crear el usuario de prueba (${error.code ?? "sin código"}).`);

  await upsertAppUser(admin, userId, student.displayName);
  await linkStudentUser(admin, student.id, userId);
  await readRows(
    `with grp as (select e.institution_id, e.group_id from app.enrollments e where e.student_id = $1 and e.ended_at is null limit 1),
          issue as (insert into app.access_card_issues (institution_id, group_id, op_key, op_identity)
                      select institution_id, group_id, gen_random_uuid(), repeat('0', 64) from grp returning id, institution_id)
     insert into app.student_credentials (institution_id, student_id, password_hash, issue_id)
       select institution_id, $1, $2, id from issue`,
    [student.id, PLACEHOLDER_HASH],
  );
  return { userId, email };
}

/** The last step of the login of a student (the bind): registers a session of his account with the current version of his credential, as our server does after the password. */
export async function bindStudentSession(admin: AdminClient, userId: string, sessionId: string): Promise<void> {
  const rows = await readRows<{ version: number }>(
    "select c.version from app.student_credentials c join app.students s on s.id = c.student_id where s.user_id = $1",
    [userId],
  );
  const version = rows[0]?.version;
  if (version === undefined) throw new Error("El estudiante de prueba no tiene credencial.");
  const bound = await callRpc(admin, "internal_bind_student_session", { p_auth_user_id: userId, p_session_id: sessionId, p_version: version });
  if (!bound.ok) throw new Error("No se pudo registrar la sesión de prueba del estudiante.");
}

/**
 * The student with a session open: what his own browser sees. The account has the fixed shape of phase 2 and a credential; the
 * session comes from a magic link, as the student login does, and is registered like the login does (the bind), because a session
 * of a student that our server did not register reads nothing (F2C-75).
 */
export async function createLoggedInStudent(admin: AdminClient, student: TestStudent): Promise<LoggedInStudent> {
  const { userId, email } = await createStudentAccount(admin, student);
  const client = await createMagicLinkClient(admin, email);
  await bindStudentSession(admin, userId, await sessionIdOf(client));
  return { ...student, userId, client };
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
