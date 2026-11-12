import { createHash, randomUUID } from "node:crypto";
import { readRows, runRpc } from "./db";
import { idOf, type Outcome } from "./session";
import { createStudent, SERVICE, teacherOf, type World } from "./world";

// Students with the accounts of phase 2 for the race tests, made only through the RPCs and committed: a student whose account is
// still to be created (pending), and one with a canonical account (its id remembered first, then the row of Auth, then the
// link) like the provisioning of T2.5b leaves them. In a scratch copy of the database there is no Auth service: the row of
// auth.users is written directly, which is also what the triggers of phase 2 see from GoTrue.

export type PendingStudent = { studentId: string; provisioningId: string };
export type ActiveStudent = PendingStudent & { authUserId: string };
export type TestCard = { studentId: string; tokenHash: string; passwordHash: string };

export async function pendingStudent(world: World): Promise<PendingStudent> {
  const studentId = await createStudent(world);
  const rows = await readRows<{ id: string }>("select id from app.account_provisioning where student_id = $1", [studentId]);
  const provisioningId = rows[0]?.id;
  if (provisioningId === undefined) throw new Error("Falta la fila de aprovisionamiento del estudiante de prueba.");
  return { studentId, provisioningId };
}

/** The email of the account of Auth of a student: its id at the synthetic domain. */
export const canonicalEmail = (authUserId: string) => `${authUserId}@estudiantes.usetiza.app`;

/**
 * The canonical account of a student, not linked yet: his id is remembered in his provisioning row (also in a sandbox one, which
 * stays not_applicable), then the row of Auth is born with the email <id>@estudiantes.usetiza.app (the trigger leaves it without a
 * password), then its app_users row. It is the order the provisioning of T2.5b follows, and the only one student_auth_link_guard and
 * the trigger of auth.users let through. The tests that link a student call this first and then link; none links an ordinary account.
 */
export async function studentAccount(studentId: string): Promise<string> {
  const authUserId = randomUUID();
  const remembered = await readRows<{ id: string }>("update app.account_provisioning set auth_user_id = $2 where student_id = $1 returning id", [studentId, authUserId]);
  if (remembered.length !== 1) throw new Error("Falta la fila de aprovisionamiento del estudiante de prueba.");
  await readRows("insert into auth.users (id, email) values ($1, $2)", [authUserId, canonicalEmail(authUserId)]);
  idOf(await runRpc(SERVICE, "internal_upsert_app_user", { p_user_id: authUserId, p_display_name: "Cuenta de estudiante" }));
  return authUserId;
}

export async function activeStudent(world: World): Promise<ActiveStudent> {
  const pending = await pendingStudent(world);
  const authUserId = randomUUID();
  const remembered = await runRpc(SERVICE, "internal_remember_student_account", { p_provisioning_id: pending.provisioningId, p_auth_user_id: authUserId });
  if (!remembered.ok || remembered.value.ok !== true) throw new Error("No se pudo recordar la cuenta del estudiante de prueba.");
  await readRows("insert into auth.users (id, email) values ($1, $2)", [authUserId, canonicalEmail(authUserId)]);
  idOf(await runRpc(SERVICE, "internal_upsert_app_user", { p_user_id: authUserId, p_display_name: "Cuenta de estudiante" }));
  idOf(await runRpc(SERVICE, "internal_link_student_user", { p_student_id: pending.studentId, p_user_id: authUserId }));
  return { ...pending, authUserId };
}

/** What a card of the request carries for a seed: a token hash and a password hash that always go together (the student is part of the digest: a token hash exists only once in the whole table). */
export function cardOf(studentId: string, seed: string): TestCard {
  const digest = (label: string) => createHash("sha256").update(`${label}:${studentId}:${seed}`).digest();
  return {
    studentId,
    tokenHash: digest("token").toString("hex"),
    passwordHash: `scrypt$15$8$1$${digest("salt").subarray(0, 16).toString("base64")}$${Buffer.concat([digest("hash-a"), digest("hash-b")]).toString("base64")}`,
  };
}

/** The args of issue_access_cards. */
export function issueArgs(groupId: string, cards: TestCard[], opKey: string = randomUUID()) {
  return { p_group_id: groupId, p_cards: JSON.stringify(cards), p_op_key: opKey };
}

export function issueAsTeacher(world: World, cards: TestCard[], opKey?: string): Promise<Outcome> {
  return runRpc(teacherOf(world), "issue_access_cards", issueArgs(world.groupId, cards, opKey));
}

export type CardState = { active: number; revoked: number; activeToken: string | null; version: number | null; passwordHash: string | null };

/** What the tables say about the cards and the credential of a student. */
export async function cardState(studentId: string): Promise<CardState> {
  const rows = await readRows<{ active: string; revoked: string; token: string | null; version: number | null; hash: string | null }>(
    `select count(*) filter (where c.status = 'active') as active, count(*) filter (where c.status = 'revoked') as revoked,
            (select encode(a.token_hash, 'hex') from app.access_cards a where a.student_id = $1 and a.status = 'active') as token,
            (select k.version from app.student_credentials k where k.student_id = $1) as version,
            (select k.password_hash from app.student_credentials k where k.student_id = $1) as hash
       from app.access_cards c where c.student_id = $1`,
    [studentId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("Falta el estado de las tarjetas.");
  return { active: Number(row.active), revoked: Number(row.revoked), activeToken: row.token, version: row.version, passwordHash: row.hash };
}
