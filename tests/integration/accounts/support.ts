import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import { readPublicDbEnv } from "@/lib/server/db/env";
import type { Database } from "@/lib/server/db/types";
import { type AdminClient, createAdminClient } from "@/lib/server/db/admin";
import { callRpc } from "@/lib/server/repos/rpc";
import { issueAccessCards } from "@/lib/server/services/student-accounts";
import { createGroup, createSchool, createUserClient, type LoggedInUser, type TestInstitution, uniqueCode } from "../../factories";
import { createStudent, type TestStudent } from "../../factories/students";
import { browser, openSession } from "../support/cookie-jar";
import { readRows } from "../support/db";

// Shared by the tests of the student accounts (T2.5b): a school with a teacher whose session is in the jar of the «browser», a group
// and students made only through create_student (so each has its `pending` row of provisioning, as in the panel), and the small
// questions about what Auth and the database ended up with. Every test makes its own school, so tests never share rows.

export const ORIGIN = "http://localhost:3000";
export const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

const used = new Set<string>();

/** Removes the institutions of the tests (their students, cards, credentials and provisioning rows go with them). */
export async function purgeSchools(): Promise<void> {
  const ids = [...used];
  used.clear();
  if (ids.length > 0) await readRows("delete from app.institutions where id = any(string_to_array($1, ',')::uuid[])", [ids.join(",")]);
}

export type Scene = {
  admin: AdminClient;
  institution: TestInstitution;
  teacher: LoggedInUser;
  groupId: string;
  students: Array<TestStudent & { provisioningId: string }>;
};

/** A school, a teacher, a group and `count` students, each with its provisioning row pending. The teacher's session is in the jar. */
export async function scene(count = 2): Promise<Scene> {
  const school = await createSchool();
  used.add(school.institution.id);
  const group = await createGroup(school.teacher.client, school.institution.id);
  const students: Scene["students"] = [];
  for (let index = 0; index < count; index += 1) {
    const tag = randomUUID().replaceAll("-", "").slice(0, 10);
    const student = await createStudent(school.teacher.client, group.id, { displayName: `Alumna Número${tag} Apellido${tag}`, username: `u${tag}` });
    const rows = await readRows<{ id: string }>("select id from app.account_provisioning where student_id = $1", [student.id]);
    const provisioningId = rows[0]?.id;
    if (provisioningId === undefined) throw new Error("Falta la fila de aprovisionamiento del estudiante de prueba.");
    students.push({ ...student, provisioningId });
  }
  await openSession(school.teacher);
  return { ...school, groupId: group.id, students };
}

/** A sandbox (the demo): it never gets accounts or cards. */
export async function sandboxScene(): Promise<{ groupId: string; studentId: string; teacher: LoggedInUser }> {
  const admin = createAdminClient();
  // A sandbox is owned by a plain visitor and expires: that is what the rules of the database ask.
  const email = `${randomUUID()}@tiza-test.example`;
  const password = `${randomUUID()}${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`No se pudo crear el visitante del sandbox (${error.code ?? "sin código"}).`);
  await callRpc(admin, "internal_upsert_app_user", { p_user_id: data.user.id, p_display_name: "Visitante" });
  const code = uniqueCode("sb");
  const created = await callRpc(admin, "internal_create_institution", {
    p_name: `Sandbox ${code}`,
    p_code: code,
    p_kind: "sandbox",
    p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    p_owner_user_id: data.user.id,
  });
  used.add(created.id);
  await callRpc(admin, "internal_add_membership", { p_institution_id: created.id, p_user_id: data.user.id, p_role: "teacher" });
  const teacher: LoggedInUser = { id: data.user.id, email, password, client: await createUserClient({ email, password }) };
  const group = await createGroup(teacher.client, created.id);
  const student = await createStudent(teacher.client, group.id);
  await openSession(teacher);
  return { groupId: group.id, studentId: student.id, teacher };
}

/** The session of the teacher of the scene goes back to the jar (a login of a student leaves its own there). */
export async function asTeacher(s: { teacher: LoggedInUser }): Promise<void> {
  await openSession(s.teacher);
}

export function sessionCookies(): string[] {
  return [...browser.jar.keys()].filter((name) => name.startsWith("sb-"));
}

/** The access token of the session that is in the jar now. */
export async function jarAccessToken(): Promise<string> {
  const { url, publishableKey } = readPublicDbEnv();
  const client = createServerClient(url, publishableKey, {
    cookies: { getAll: () => [...browser.jar].map(([name, value]) => ({ name, value })), setAll: () => undefined },
  });
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (token === undefined) throw new Error("No hay sesión en el jar.");
  return token;
}

/** The refresh token of the session that is in the jar now. */
export async function jarSessionTokens(): Promise<{ accessToken: string; refreshToken: string }> {
  const { url, publishableKey } = readPublicDbEnv();
  const client = createServerClient(url, publishableKey, {
    cookies: { getAll: () => [...browser.jar].map(([name, value]) => ({ name, value })), setAll: () => undefined },
  });
  const session = (await client.auth.getSession()).data.session;
  if (session === null) throw new Error("No hay sesión en el jar.");
  return { accessToken: session.access_token, refreshToken: session.refresh_token };
}

/** What a request that carries only an access token in its header sees (the session cookie is not needed to replay a token). */
export function clientWith(accessToken: string) {
  const { url, publishableKey } = readPublicDbEnv();
  return createClient<Database, "api">(url, publishableKey, {
    db: { schema: "api" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** True if that token still reads a student RPC (the session is alive and registered); false if the database refuses it. */
export async function tokenReads(accessToken: string): Promise<boolean> {
  try {
    await callRpc(clientWith(accessToken), "student_home", {});
    return true;
  } catch (thrown) {
    if (typeof thrown === "object" && thrown !== null && Reflect.get(thrown, "code") === "FORBIDDEN") return false;
    throw thrown;
  }
}

export type CallLog = { method: string; path: string };

function describeCall(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): CallLog {
  const request = input instanceof Request ? input : null;
  const url = new URL(request === null ? String(input) : request.url);
  const method = init?.method ?? request?.method ?? "GET";
  return { method: method.toUpperCase(), path: url.search === "" ? url.pathname : `${url.pathname}?…` };
}

/** Records every request that goes through `fetch` (method and path, never the body) and, with `answer`, can replace the answer of some. */
export function watchFetch(answer?: (call: CallLog) => Response | undefined) {
  const original = globalThis.fetch;
  const calls: CallLog[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const call = describeCall(input, init);
    calls.push(call);
    return answer?.(call) ?? original(input, init);
  });
  return { calls, restore: () => spy.mockRestore() };
}

/** A call with the secret key: the admin API of Auth, or an internal_* RPC. */
export const isAdminCall = (call: CallLog) => call.path.startsWith("/auth/v1/admin/") || /\/rpc\/internal_/.test(call.path);

export type AuthRow = { id: string; email: string; password: string; provisioning: string | null };

/** What the table of Auth says about an account. */
export async function authRow(id: string): Promise<AuthRow | undefined> {
  return (
    await readRows<AuthRow>(
      "select id::text, email, coalesce(encrypted_password, '') as password, raw_app_meta_data ->> 'provisioning_id' as provisioning from auth.users where id = $1",
      [id],
    )
  )[0];
}

export async function provisioningRow(provisioningId: string) {
  return (
    await readRows<{ status: string; auth_user_id: string | null; error_code: string | null; attempts: number }>(
      "select status, auth_user_id::text, error_code, attempts from app.account_provisioning where id = $1",
      [provisioningId],
    )
  )[0];
}

export async function countRows(sql: string, values: string[]): Promise<number> {
  return Number((await readRows<{ n: string }>(sql, values))[0]?.n);
}

export const authAccountsOf = (provisioningId: string) =>
  countRows("select count(*)::text as n from auth.users where raw_app_meta_data ->> 'provisioning_id' = $1", [provisioningId]);

export const sessionsOf = (userId: string) => countRows("select count(*)::text as n from auth.sessions where user_id = $1", [userId]);
export const registeredSessionsOf = (userId: string) =>
  countRows("select count(*)::text as n from app.student_sessions ss join app.students s on s.id = ss.student_id where s.user_id = $1", [userId]);

export const credentialOf = async (studentId: string) =>
  (await readRows<{ hash: string; version: number }>("select password_hash as hash, version from app.student_credentials where student_id = $1", [studentId]))[0];

/** The value, or a failure of the test: keeps the tests linear (no `?.` and `??` chains over data that must be there). */
export function required<T>(value: T | null | undefined, what = "un dato de la prueba"): T {
  if (value === null || value === undefined) throw new Error(`Falta ${what}.`);
  return value;
}

/** The token that is in the fragment of the QR url of a card. */
export function qrToken(qrUrl: string): string {
  return required(/#([A-Za-z0-9_-]{43})$/.exec(qrUrl)?.[1], "el token del QR");
}

/** The Auth id that the provisioning row of a student remembers. */
export async function authUserOf(student: { provisioningId: string }): Promise<string> {
  return required((await provisioningRow(student.provisioningId))?.auth_user_id, "el id de la cuenta de Auth");
}

export type Student = Scene["students"][number];

/** A school with one student that has an account and a card. The jar is left empty (nobody is signed in). */
export async function withCard() {
  const s = await scene(1);
  const student = required(s.students[0], "el estudiante");
  const { cards } = await issueAccessCards({ groupId: s.groupId, studentIds: [student.id], opKey: randomUUID(), origin: ORIGIN });
  const card = required(cards[0], "la tarjeta");
  const userId = await authUserOf(student);
  const login = (password: string = card.password, from: string = ip()) => ({ code: s.institution.code, username: student.username, password, ip: from });
  browser.jar = new Map();
  return { s, student, card, userId, login };
}

/** The teacher issues a new card for the student, and the jar is left empty again. */
export async function issueAgain(s: Scene, studentId: string): Promise<{ password: string; qrUrl: string }> {
  await asTeacher(s);
  const { cards } = await issueAccessCards({ groupId: s.groupId, studentIds: [studentId], opKey: randomUUID(), origin: ORIGIN });
  browser.jar = new Map();
  return required(cards[0], "la tarjeta nueva");
}
