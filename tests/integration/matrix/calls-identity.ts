import { randomUUID } from "node:crypto";
import { callRpc } from "@/lib/server/repos/rpc";
import { createLoggedInUser } from "../../factories";
import { createPerson, SERVICE } from "../support/world";
import { readRows, runRpc } from "../support/db";
import { idOf } from "../support/session";
import type { Scene } from "./fixtures";
import { freshGroup, freshStudent } from "./resources";
import type { CallsOf } from "./types";

// How to call the operations of identity, groups and students (T1.2a, T1.2b) over a scene.

type IdentityRpc =
  | "internal_create_institution" | "internal_upsert_app_user" | "internal_add_membership" | "internal_revoke_membership"
  | "list_my_institutions" | "create_group" | "update_group" | "archive_group" | "restore_group" | "add_group_staff"
  | "remove_group_staff" | "internal_link_student_user" | "create_student" | "update_student" | "archive_student"
  | "restore_student" | "enroll_student" | "unenroll_student" | "list_my_groups" | "get_group" | "list_group_students";

const NAME = { p_name: "Grupo nuevo", p_school_year: 2027 };
const username = () => `est-${randomUUID().replaceAll("-", "").slice(0, 16)}`;

async function colleague(s: Scene) {
  return createLoggedInUser(s.adminClient, s.institution, "teacher");
}

async function membershipOf(s: Scene): Promise<string> {
  const userId = await createPerson();
  return idOf(await runRpc(SERVICE, "internal_add_membership", { p_institution_id: s.institution.id, p_user_id: userId, p_role: "teacher" }));
}

export const IDENTITY_CALLS: CallsOf<IdentityRpc> = {
  internal_create_institution: async () => ({ args: { p_name: "Colegio", p_code: `m-${randomUUID().slice(0, 12)}`, p_kind: "school" } }),
  internal_upsert_app_user: async (s) => ({ args: { p_user_id: s.owner.userId, p_display_name: "Docente" } }),
  internal_add_membership: async (s) => ({ args: { p_institution_id: s.institution.id, p_user_id: await createPerson(), p_role: "teacher" } }),
  internal_revoke_membership: async (s) => ({ args: { p_membership_id: await membershipOf(s) } }),
  list_my_institutions: async (s) => ({ args: {}, listing: true, target: s.institution.id, sharedWithPeers: true }),
  create_group: async (s) => ({ args: { p_institution_id: s.institution.id, ...NAME, p_subject_id: "math", p_op_key: randomUUID() } }),
  update_group: async (s) => {
    const group = await freshGroup(s);
    return { args: { p_group_id: group.id, p_revision: group.revision, ...NAME } };
  },
  archive_group: async (s) => {
    const group = await freshGroup(s);
    return { args: { p_group_id: group.id, p_revision: group.revision } };
  },
  restore_group: async (s) => {
    const group = await freshGroup(s);
    const archived = await callRpc(s.owner.client, "archive_group", { p_group_id: group.id, p_revision: group.revision });
    return { args: { p_group_id: group.id, p_revision: archived.revision } };
  },
  add_group_staff: async (s) => {
    const group = await freshGroup(s);
    const user = await colleague(s);
    return { args: { p_group_id: group.id, p_user_id: user.id, p_role: "co_teacher" } };
  },
  remove_group_staff: async (s) => {
    const group = await freshGroup(s);
    const user = await colleague(s);
    // Written as the database owner: add_group_staff is closed in a sandbox, and the row must exist to be removed.
    const row = "insert into app.group_staff (institution_id, group_id, user_id, role) values ($1, $2, $3, 'co_teacher')";
    await readRows(row, [s.institution.id, group.id, user.id]);
    return { args: { p_group_id: group.id, p_user_id: user.id } };
  },
  internal_link_student_user: async (s) => ({ args: { p_student_id: (await freshStudent(s)).id, p_user_id: await createPerson() } }),
  create_student: async (s) => ({ args: { p_group_id: s.groupId, p_display_name: "Estudiante de prueba", p_username: username(), p_op_key: randomUUID() } }),
  update_student: async (s) => {
    const student = await freshStudent(s);
    return { args: { p_student_id: student.id, p_revision: student.revision, p_display_name: "Otro nombre", p_username: username() } };
  },
  archive_student: async (s) => {
    const student = await freshStudent(s);
    return { args: { p_student_id: student.id, p_revision: student.revision } };
  },
  restore_student: async (s) => {
    const student = await freshStudent(s);
    const archived = await callRpc(s.owner.client, "archive_student", { p_student_id: student.id, p_revision: student.revision });
    return { args: { p_student_id: student.id, p_revision: archived.revision } };
  },
  enroll_student: async (s) => ({ args: { p_group_id: (await freshGroup(s)).id, p_student_id: (await freshStudent(s)).id } }),
  unenroll_student: async (s) => {
    const group = await freshGroup(s);
    const student = await freshStudent(s);
    await callRpc(s.owner.client, "enroll_student", { p_group_id: group.id, p_student_id: student.id });
    return { args: { p_group_id: group.id, p_student_id: student.id } };
  },
  list_my_groups: async (s) => ({ args: { p_institution_id: s.institution.id }, listing: true, target: s.groupId }),
  get_group: async (s) => ({ args: { p_group_id: s.groupId } }),
  list_group_students: async (s) => ({ args: { p_group_id: s.groupId }, listing: true, target: s.learner.studentId }),
};
