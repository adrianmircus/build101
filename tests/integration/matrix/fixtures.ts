import { randomUUID } from "node:crypto";
import { createAdminClient, type AdminClient } from "@/lib/server/db/admin";
import { callRpc } from "@/lib/server/repos/rpc";
import {
  createGroup,
  createInstitution,
  createUserClient,
  uniqueCode,
  createLoggedInUser,
  type TestClient,
  type TestInstitution,
} from "../../factories";
import { createLoggedInStudent, createStudent } from "../../factories/students";
import type { Actor } from "../support/session";

// The world of the permissions matrix (T1.8): one scene per kind of institution, each with one
// target group and one logged-in user per role of lib/domain/permissions/roles.ts. Everything is
// made through the factories and the RPCs. Placeholder text only.

export type Member = { userId: string; client: TestClient; actor: Actor };
export type Learner = Member & { studentId: string };

export type Scene = {
  kind: "school" | "sandbox";
  institution: TestInstitution;
  groupId: string;
  /** A second group of the same institution, taught only by `otherTeacher`. */
  otherGroupId: string;
  /** Teacher and owner of the target group (in a sandbox: its visitor). */
  owner: Member;
  admin: Member;
  inclusion: Member;
  otherTeacher: Member;
  /** The student of the target group whose resources the student operations are called on. */
  learner: Learner;
  /** Another student of the same group. */
  peer: Learner;
  adminClient: AdminClient;
};

export type World = { school: Scene; sandbox: Scene; outsider: Member; adminClient: AdminClient };

type Account = { id: string; email: string; password: string; client: TestClient };

function memberOf(user: Pick<Account, "id" | "client">): Member {
  return { userId: user.id, client: user.client, actor: { role: "authenticated", userId: user.id } };
}

async function member(admin: AdminClient, institution: TestInstitution, role: "admin" | "teacher" | "inclusion") {
  return memberOf(await createLoggedInUser(admin, institution, role));
}

async function learnerOf(admin: AdminClient, owner: Member, groupId: string): Promise<Learner> {
  const student = await createStudent(owner.client, groupId);
  const account = await createLoggedInStudent(admin, student);
  return { ...memberOf({ id: account.userId, client: account.client }), studentId: student.id };
}

type Opening = { institution: TestInstitution; owner: Member };

async function openSchool(admin: AdminClient): Promise<Opening> {
  const institution = await createInstitution(admin);
  return { institution, owner: await member(admin, institution, "teacher") };
}

/** A sandbox of the anonymous demo: a plain user who owns it, as the sandbox rules ask. */
async function openSandbox(admin: AdminClient): Promise<Opening> {
  const email = `${randomUUID()}@tiza-test.example`;
  const password = `${randomUUID()}${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`No se pudo crear el visitante del sandbox (${error.code ?? "sin código"}).`);
  await callRpc(admin, "internal_upsert_app_user", { p_user_id: data.user.id, p_display_name: "Visitante" });
  const code = uniqueCode("sb");
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const created = await callRpc(admin, "internal_create_institution", {
    p_name: `Sandbox ${code}`, p_code: code, p_kind: "sandbox", p_expires_at: expiresAt, p_owner_user_id: data.user.id,
  });
  await callRpc(admin, "internal_add_membership", { p_institution_id: created.id, p_user_id: data.user.id, p_role: "teacher" });
  const client = await createUserClient({ email, password });
  return { institution: { id: created.id, code, name: `Sandbox ${code}` }, owner: memberOf({ id: data.user.id, client }) };
}

/** An institution of that kind with its target group and one account for every role. */
export async function buildScene(admin: AdminClient, kind: "school" | "sandbox"): Promise<Scene> {
  const { institution, owner } = kind === "school" ? await openSchool(admin) : await openSandbox(admin);
  const otherTeacher = await member(admin, institution, "teacher");
  const group = await createGroup(owner.client, institution.id);
  const other = await createGroup(otherTeacher.client, institution.id);
  return {
    kind,
    institution,
    groupId: group.id,
    otherGroupId: other.id,
    owner,
    otherTeacher,
    admin: await member(admin, institution, "admin"),
    inclusion: await member(admin, institution, "inclusion"),
    learner: await learnerOf(admin, owner, group.id),
    peer: await learnerOf(admin, owner, group.id),
    adminClient: admin,
  };
}

/** Both scenes and a teacher of another institution who must be denied everything. */
export async function buildWorld(): Promise<World> {
  const adminClient = createAdminClient();
  const school = await buildScene(adminClient, "school");
  const sandbox = await buildScene(adminClient, "sandbox");
  const elsewhere = await createInstitution(adminClient);
  const outsider = await member(adminClient, elsewhere, "teacher");
  // The outsider has a group of their own: their listings are not empty, they just lack the target.
  await callRpc(outsider.client, "create_group", {
    p_institution_id: elsewhere.id,
    p_name: "Grupo ajeno",
    p_subject_id: "math",
    p_school_year: 2027,
    p_op_key: randomUUID(),
  });
  return { school, sandbox, outsider, adminClient };
}

/** The JWT of a logged-in member, for the REST probes. */
export async function accessTokenOf(who: Member): Promise<string> {
  const { data } = await who.client.auth.getSession();
  const token = data.session?.access_token;
  if (token === undefined) throw new Error("El usuario de prueba no tiene sesión.");
  return token;
}
