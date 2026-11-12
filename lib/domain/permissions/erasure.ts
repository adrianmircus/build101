import { APP_TABLES, type AppTable } from "./tables";

// What erasing one student does to each table that holds data about them, directly, by pseudonym
// or derived from their profile (R3-7). docs/PRIVACIDAD-DATOS.md (T1.9) expands each row field by
// field; its test checks that it covers exactly these tables with these rules. T9.5 implements it.
//
//   delete      the student's rows go.
//   unlink      the row stays, without the link to the student.
//   redact      the row stays; the parts about the student (their entry, a name in free text) go.
//   keep        the row stays as is, for the reason given.
//   by_version  follows the version. An individual version is one that, in all its history,
//               only this student received: every version_recipients row and every attempt on
//               its publications is theirs. It is deleted with everything hanging from it, so no
//               other student's delivery can go with it. Any other version is shared: it stays,
//               without them as recipient, and any free text naming them is redacted.
//
// How redaction coexists with immutable history: rows of a shared version (events, outputs, key
// revisions, the publication, the generation's inputs) reject UPDATE. T9.5 runs the whole erasure
// in one transaction opened with app.begin_erasure(<marked erasure>): only there do the guards let
// a redaction through (20261111130800_platform.sql), and 004_contract_redaction proves it.
//
// Order of an erasure (T9.5), so that what is kept is never personal:
//   1. mark it (erasures, status 'marked') and unlink the pseudonym;
//   2. delete the student's Storage objects, then the rows by these rules, with redactions inside
//      app.begin_erasure;
//   3. delete the Auth account with the admin API: that cascades app_users and memberships, and
//      leaves account_provisioning.auth_user_id pointing at no account;
//   4. only then move the erasure to 'done' and copy it out of the database.
//
// Operations of the creations (T1.F4): op_key and op_identity of assessments, assessment_exercises and
// versions are a hash of the text as it was created. The erasure of a student nulls them on every row
// of the groups where the student was ever enrolled (and on every version they received), whatever the
// text says now, so it runs in step 2 before the enrollments are deleted. Groups keep theirs: a group
// name is not personal.

export type ErasureRule = "delete" | "unlink" | "redact" | "keep" | "by_version";
// `nullifies` lists the columns of a kept or redacted row that go to NULL: the link to the student and
// anything from which a candidate identity can be checked (T9.5 sets them; the doc marks each `desvincula`).
export type ErasureEntry = { rule: ErasureRule; why: string; nullifies?: readonly string[] };

export const ERASURE_RULES = {
  app_users: { rule: "delete", why: "Su usuario de la plataforma; se va en cascada al borrar la cuenta de Auth (paso 3)." },
  memberships: { rule: "delete", why: "Su membresía de estudiante; se va en cascada con app_users al borrar la cuenta de Auth." },
  students: { rule: "delete", why: "Es el estudiante." },
  enrollments: { rule: "delete", why: "Dice en qué grupos estuvo." },
  student_pseudonyms: { rule: "unlink", why: "Mantiene la integridad de lo que se conserva; sin el vínculo no lleva a nadie, pero lo que quede atado sigue siendo personal salvo justificación." },
  account_provisioning: {
    rule: "keep",
    why: "La marca deleted y el op_key impiden que reconcile_accounts recree la cuenta. Sin nombre ni vínculo con el estudiante; op_identity (sha256 de grupo y username) se pone en nulo porque permite comprobar usernames candidatos; auth_user_id deja de ser personal porque la cuenta de Auth se borra antes de cerrar la supresión (paso 3).",
    nullifies: ["student_id", "op_identity"],
  },
  access_cards: { rule: "delete", why: "Sus tarjetas de acceso (su id y el hash del token); se van en cascada al borrar al estudiante." },
  access_card_issues: { rule: "redact", why: "La emisión es del grupo; solo se saca el id del estudiante de student_ids, dentro de la supresión (la guardia lo permite solo ahí). Una emisión que quedaría sin estudiantes se borra entera." },
  student_needs: { rule: "delete", why: "Dato de salud." },
  student_need_events: { rule: "delete", why: "Historial de un dato de salud." },
  student_notes: { rule: "delete", why: "Notas privadas sobre el estudiante." },
  consents: { rule: "delete", why: "Consentimientos del estudiante; se borran después de sus efectos." },
  files: { rule: "delete", why: "Formularios firmados e informes del estudiante: primero el objeto, después la fila." },
  version_recipients: { rule: "delete", why: "Dice qué versión recibió, lo que junto con la configuración revela su perfil." },
  versions: {
    rule: "by_version",
    why: "Una versión individual es atribuible; una compartida responde a varios estudiantes. op_key y op_identity (sha256 de la configuración del alta, tal como se creó) se ponen en nulo en toda versión de los grupos donde estuvo inscripto alguna vez y en toda de la que fue destinatario, sin mirar la configuración actual: editada a algo neutro sigue permitiendo comprobar nombres candidatos.",
    nullifies: ["op_key", "op_identity"],
  },
  version_exercises: { rule: "by_version", why: "Texto adaptado a su perfil cuando la versión es individual." },
  version_questions: { rule: "by_version", why: "Preguntas de mirada de su versión." },
  question_keys: { rule: "by_version", why: "Clave de las preguntas de su versión." },
  generations: { rule: "by_version", why: "Entradas de la IA: configuración, intereses e instrucciones; en una compartida se redacta el texto libre que lo nombre." },
  generation_outputs: { rule: "by_version", why: "Salida de la IA para su versión; en una compartida se redacta si lo nombra." },
  version_events: { rule: "by_version", why: "Feedback de su versión; en una compartida se le saca de recipients_changed (data) y se redacta el texto que lo nombre, también en result." },
  answer_keys: { rule: "by_version", why: "Clave de su versión." },
  answer_key_revisions: { rule: "by_version", why: "Revisiones de la clave de su versión." },
  publications: { rule: "by_version", why: "Copia de su versión; una compartida se conserva para los demás." },
  assignments: { rule: "delete", why: "Sus tareas." },
  assignment_attempts: { rule: "delete", why: "Sus intentos." },
  submissions: { rule: "delete", why: "Sus respuestas." },
  grades: { rule: "delete", why: "Sus notas." },
  group_analyses: { rule: "redact", why: "Se borra su parte del resultado y su etiqueta del mapa de seudónimos; el resto es del grupo." },
  operations: { rule: "redact", why: "El resultado del análisis de un grupo tiene su parte; un documento leído puede nombrarlo." },
  assessment_exercises: {
    rule: "redact",
    why: "El original es del profe; si su texto nombra al estudiante, se redacta. op_key y op_identity (sha256 del texto del alta, tal como se creó) se ponen en nulo en todo ejercicio de los grupos donde estuvo inscripto alguna vez, sin mirar el texto actual.",
    nullifies: ["op_key", "op_identity"],
  },
  assessments: {
    rule: "redact",
    why: "El tema y las instrucciones generales son texto libre del profe: si nombran al estudiante, se redactan. op_key y op_identity (sha256 del texto del alta, tal como se creó) se ponen en nulo en todo práctico de los grupos donde estuvo inscripto alguna vez, sin mirar el texto actual.",
    nullifies: ["op_key", "op_identity"],
  },
  presets: { rule: "redact", why: "El nombre y la configuración son texto libre del profe (por ejemplo «Paula TDAH»): si nombran al estudiante, se redactan." },
  feedback_events: { rule: "delete", why: "Señales de uso por seudónimo: no hay justificación para tratarlas como disociadas." },
  audit_log: { rule: "keep", why: "Registro de accesos, cinco años. Sus ids ya no llevan a nadie." },
  erasures: { rule: "keep", why: "Es el registro de la supresión, sin datos personales." },
  notifications: { rule: "delete", why: "Avisos a profes que apuntan a sus tareas y entregas." },
  import_runs: { rule: "redact", why: "Se sacan del mapa de ids las entradas que lo nombran." },
} as const satisfies Partial<Record<AppTable, ErasureEntry>>;

/** Tables with data about a student, in the order of APP_TABLES. */
export const STUDENT_DATA_TABLES: readonly AppTable[] = APP_TABLES.filter((table) => Object.hasOwn(ERASURE_RULES, table));
