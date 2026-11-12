import { op, type MatrixRole, type Operation } from "./roles";

// The permissions matrix as data: operation x role, with the phase it applies from and the ticket
// that implements it. The matrix test (T1.8) calls each RPC as each role against the target
// fixtures; the UI decides which buttons to show from the same data. Internal RPCs are listed with
// no allowed role: users never execute them (service_role only).
//
// Decisions behind the rows (docs/contratos/fase-1.md, «Matriz de permisos»):
// - admin manages the institution (groups, staff, students, consents), but does not read needs,
//   notes, assessments or deliveries of groups they do not teach: least privilege for health data.
// - inclusion reads and edits needs institution-wide, never notes or deliveries.
// - the sandbox visitor is a teacher inside their sandbox, minus what creates real effects
//   (inviting staff); after expires_at they are denied everything.

const ANY_STAFF: MatrixRole[] = ["admin", "teacher_of_group", "teacher_other_group", "inclusion", "sandbox_anonymous"];
const ANY_TEACHER: MatrixRole[] = ["admin", "teacher_of_group", "teacher_other_group", "sandbox_anonymous"];
const MANAGERS: MatrixRole[] = ["admin", "teacher_of_group", "sandbox_anonymous"];
const READERS: MatrixRole[] = ["admin", "teacher_of_group", "inclusion", "sandbox_anonymous"];
const NEEDS: MatrixRole[] = ["teacher_of_group", "inclusion", "sandbox_anonymous"];
const STAFF: MatrixRole[] = ["teacher_of_group", "sandbox_anonymous"];
const STUDENT: MatrixRole[] = ["student"];

const IDENTITY: Operation[] = [
  op({ rpc: "internal_create_institution", ticket: "T1.2a" }),
  op({ rpc: "internal_upsert_app_user", ticket: "T1.2a" }),
  op({ rpc: "internal_add_membership", ticket: "T1.2a" }),
  op({ rpc: "internal_revoke_membership", ticket: "T1.2a" }),
  op({ rpc: "list_my_institutions", ticket: "T1.2a", allow: ANY_STAFF, own: STUDENT }),
  op({ rpc: "create_group", ticket: "T1.2a", allow: ANY_TEACHER }),
  op({ rpc: "update_group", ticket: "T1.2a", allow: MANAGERS }),
  op({ rpc: "archive_group", ticket: "T1.2a", allow: MANAGERS }),
  op({ rpc: "restore_group", ticket: "T1.2a", allow: MANAGERS }),
  op({ rpc: "add_group_staff", ticket: "T1.2a", allow: ["admin", "teacher_of_group"], note: "Solo el owner del grupo, o el admin. En la demo no se suman profes." }),
  op({ rpc: "remove_group_staff", ticket: "T1.2a", allow: ["admin", "teacher_of_group"], note: "Solo el owner del grupo, o el admin." }),
];

const STUDENTS: Operation[] = [
  op({ rpc: "internal_link_student_user", ticket: "T1.2b" }),
  op({ rpc: "create_student", ticket: "T1.2b", allow: MANAGERS, note: "En la demo no crea cuenta real." }),
  op({ rpc: "update_student", ticket: "T1.2b", allow: MANAGERS }),
  op({ rpc: "archive_student", ticket: "T1.2b", allow: MANAGERS }),
  op({ rpc: "restore_student", ticket: "T1.2b", allow: MANAGERS }),
  op({ rpc: "enroll_student", ticket: "T1.2b", allow: MANAGERS }),
  op({ rpc: "unenroll_student", ticket: "T1.2b", allow: MANAGERS }),
  op({ rpc: "list_my_groups", ticket: "T1.2b", allow: READERS, note: "Cada uno ve solo sus grupos; admin e inclusión, los de la institución." }),
  op({ rpc: "get_group", ticket: "T1.2b", allow: READERS }),
  op({ rpc: "list_group_students", ticket: "T1.2b", allow: READERS }),
];

const SENSITIVE: Operation[] = [
  op({ rpc: "set_student_needs", ticket: "T1.3a", allow: NEEDS }),
  op({ rpc: "set_student_interface", ticket: "T1.F8", allow: NEEDS, note: "Ajuste de accesibilidad que elige el staff; no se deriva del perfil." }),
  op({ rpc: "get_student_needs", ticket: "T1.3a", allow: NEEDS, note: "Auditada." }),
  op({ rpc: "get_group_needs", ticket: "T1.3a", allow: NEEDS, note: "Auditada." }),
  op({ rpc: "list_student_need_events", ticket: "T1.3a", allow: NEEDS, note: "Auditada." }),
  op({ rpc: "list_student_notes", ticket: "T1.3b", allow: STAFF, note: "Auditada." }),
  op({ rpc: "create_student_note", ticket: "T1.3b", allow: STAFF }),
  op({ rpc: "update_student_note", ticket: "T1.3b", allow: STAFF, note: "Solo quien la escribió." }),
  op({ rpc: "archive_student_note", ticket: "T1.3b", allow: STAFF, note: "Solo quien la escribió." }),
  op({ rpc: "list_student_consents", ticket: "T1.3b", allow: READERS, note: "Auditada." }),
  op({ rpc: "record_consent", ticket: "T1.3b", allow: MANAGERS }),
  op({ rpc: "revoke_consent", ticket: "T1.3b", allow: MANAGERS }),
];

const ASSESSMENTS: Operation[] = [
  op({ rpc: "create_assessment", ticket: "T1.4a", allow: STAFF }),
  op({ rpc: "update_assessment", ticket: "T1.4a", allow: STAFF }),
  op({ rpc: "archive_assessment", ticket: "T1.4a", allow: STAFF }),
  op({ rpc: "list_assessments", ticket: "T1.4a", allow: STAFF }),
  op({ rpc: "get_assessment", ticket: "T1.4a", allow: STAFF }),
  op({ rpc: "add_exercise", ticket: "T1.4a", allow: STAFF }),
  op({ rpc: "update_exercise", ticket: "T1.4a", allow: STAFF }),
  op({ rpc: "remove_exercise", ticket: "T1.4a", allow: STAFF }),
  op({ rpc: "reorder_exercises", ticket: "T1.4a", allow: STAFF }),
];

const VERSIONS: Operation[] = [
  op({ rpc: "create_version", ticket: "T1.4b", allow: STAFF }),
  op({ rpc: "update_version_config", ticket: "T1.4b", allow: STAFF }),
  op({ rpc: "set_version_recipients", ticket: "T1.4b", allow: STAFF }),
  op({ rpc: "archive_version", ticket: "T1.4b", allow: STAFF }),
  op({ rpc: "list_versions", ticket: "T1.4b", allow: STAFF }),
  op({ rpc: "get_version", ticket: "T1.4b", allow: STAFF, note: "Auditada." }),
  op({ rpc: "update_version_instructions", ticket: "T1.4c", allow: STAFF }),
  op({ rpc: "update_version_exercise", ticket: "T1.4c", allow: STAFF }),
  op({ rpc: "update_version_question", ticket: "T1.4c", allow: STAFF }),
  op({ rpc: "set_question_key", ticket: "T1.4c", allow: STAFF }),
  op({ rpc: "approve_version", ticket: "T1.4c", allow: STAFF }),
  op({ rpc: "reject_version", ticket: "T1.4c", allow: STAFF }),
  op({ rpc: "internal_create_generation", ticket: "T1.4d" }),
  op({ rpc: "internal_record_generation_output", ticket: "T1.4d" }),
  op({ rpc: "internal_finish_generation", ticket: "T1.4d" }),
  op({ rpc: "get_answer_key", ticket: "T1.4e", allow: STAFF }),
  op({ rpc: "edit_answer_key", ticket: "T1.4e", allow: STAFF }),
  op({ rpc: "confirm_answer_key", ticket: "T1.4e", allow: STAFF }),
  op({ rpc: "approve_answer_key", ticket: "T1.4e", allow: STAFF }),
  op({ rpc: "internal_record_answer_key_revision", ticket: "T1.4e" }),
];

const DELIVERY: Operation[] = [
  op({ rpc: "publish_version", ticket: "T1.5a", allow: STAFF }),
  op({ rpc: "student_open_attempt", ticket: "T1.5b", own: STUDENT }),
  op({ rpc: "student_start_attempt", ticket: "T1.5b", own: STUDENT }),
  op({ rpc: "student_save_draft", ticket: "T1.5b", own: STUDENT }),
  op({ rpc: "student_submit_attempt", ticket: "T1.5b", own: STUDENT }),
  op({ rpc: "list_assessment_attempts", ticket: "T1.5c", allow: STAFF }),
  op({ rpc: "get_attempt_for_grading", ticket: "T1.5c", allow: STAFF, note: "Auditada." }),
  op({ rpc: "grade_attempt", ticket: "T1.5c", allow: STAFF }),
  op({ rpc: "student_home", ticket: "T1.5d", own: STUDENT }),
  op({ rpc: "student_task_list", ticket: "T1.5d", own: STUDENT }),
  op({ rpc: "student_task", ticket: "T1.5d", own: STUDENT }),
  op({ rpc: "student_grades", ticket: "T1.5d", own: STUDENT }),
];

// Phase 2 (docs/contratos/fase-2.md). since: 2, so the phase 1 matrix run leaves them out until their tickets land.
const ACCOUNTS: Operation[] = [
  op({ rpc: "internal_revoke_user_sessions", ticket: "T2.7", since: 2 }),
  op({ rpc: "internal_rate_limit_hit", ticket: "T2.7", since: 2 }),
  op({ rpc: "internal_rate_limit_clear", ticket: "T2.7", since: 2 }),
  op({ rpc: "create_invitation", ticket: "T2.3", since: 2, allow: ["admin"], note: "No en un sandbox: es un efecto real." }),
  op({ rpc: "resend_invitation", ticket: "T2.3", since: 2, allow: ["admin"] }),
  op({ rpc: "revoke_invitation", ticket: "T2.3", since: 2, allow: ["admin"] }),
  op({ rpc: "mark_invitation_sent", ticket: "T2.3", since: 2, allow: ["admin"] }),
  op({ rpc: "list_invitations", ticket: "T2.3", since: 2, allow: ["admin"] }),
  op({ rpc: "list_institution_staff", ticket: "T2.3", since: 2, allow: ["admin"] }),
  op({ rpc: "list_enabled_subjects", ticket: "T2.3", since: 2, allow: ANY_TEACHER, note: "Lo usa quien crea un grupo: admin o profe." }),
  op({ rpc: "get_institution_summary", ticket: "T2.3", since: 2, allow: ["admin"] }),
  op({ rpc: "internal_get_invitation", ticket: "T2.3", since: 2 }),
  op({ rpc: "internal_create_invitation", ticket: "T2.3", since: 2 }),
  op({ rpc: "internal_finish_invitation_signup", ticket: "T2.3", since: 2 }),
  op({ rpc: "accept_invitation", ticket: "T2.3", since: 2, note: "Lo acepta quien tiene el correo de la invitación, sea cual sea su rol; ningún rol de la matriz lo es. Un estudiante no puede." }),
  op({ rpc: "list_taken_usernames", ticket: "T2.5a", since: 2, allow: ANY_TEACHER, note: "Admin o profe de la institución." }),
  op({ rpc: "list_group_accounts", ticket: "T2.5a", since: 2, allow: ["admin", "teacher_of_group", "sandbox_anonymous"], note: "No dice nada del perfil." }),
  op({ rpc: "begin_access_cards", ticket: "T2.5a", since: 2, allow: ["admin", "teacher_of_group"], note: "No en un sandbox." }),
  op({ rpc: "finish_access_cards", ticket: "T2.5a", since: 2, allow: ["admin", "teacher_of_group"], note: "Solo el mismo actor que empezó la emisión; otra persona recibe NOT_FOUND." }),
  op({ rpc: "internal_claim_card_password", ticket: "T2.5a", since: 2 }),
  op({ rpc: "internal_claim_provisioning", ticket: "T2.5a", since: 2 }),
  op({ rpc: "internal_get_student_accounts", ticket: "T2.5a", since: 2 }),
  op({ rpc: "internal_remember_student_account", ticket: "T2.5a", since: 2 }),
  op({ rpc: "internal_fail_student_account", ticket: "T2.5a", since: 2 }),
  op({ rpc: "internal_list_unfinished_accounts", ticket: "T2.5a", since: 2 }),
  op({ rpc: "internal_find_institution", ticket: "T2.5a", since: 2 }),
  op({ rpc: "internal_resolve_student_login", ticket: "T2.5a", since: 2 }),
  op({ rpc: "internal_resolve_access_card", ticket: "T2.5a", since: 2 }),
];

export const PERMISSIONS: readonly Operation[] = [...IDENTITY, ...STUDENTS, ...SENSITIVE, ...ASSESSMENTS, ...VERSIONS, ...DELIVERY, ...ACCOUNTS];

/** What the UI asks: may this role do this now? (own counts: the screen only offers it on own data). */
export function can(rpc: string, role: MatrixRole, phase: number): boolean {
  const row = PERMISSIONS.find((operation) => operation.rpc === rpc);
  return row !== undefined && row.since <= phase && row.access[role] !== "deny";
}

/** The rows the matrix test has to run in a phase. */
export function operationsFor(phase: number): Operation[] {
  return PERMISSIONS.filter((operation) => operation.since <= phase);
}
