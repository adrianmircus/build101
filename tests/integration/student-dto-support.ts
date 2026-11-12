import { randomUUID } from "node:crypto";
import { original, type Original } from "./support/assessments";
import { readRows, runRpc } from "./support/db";
import { describeOutcome, idOf, type Actor } from "./support/session";
import { createStudent, createPerson, SERVICE, teacherOf } from "./support/world";
import { attemptOf, attemptRows } from "./races/publish-support";
import { at, OPTIONS } from "./races/version-ops-support";

// Shared by student-dto-leaks.test.ts (T1.5d). A class with two students of different profiles in the same group, each with a
// version published through the RPCs and committed: one looks (motor, gaze, with questions and a key), one types (dyslexia).
// Everything goes through the RPCs except the gaze questions, which no RPC writes yet. Placeholder text only.

export type Learner = { studentId: string; actor: Actor; userId: string; assignmentId: string; attemptId: string };
export type Class = { o: Original; gaze: Learner; typed: Learner; versions: string[]; questions: string[]; keyIds: string[] };

const configOf = (profile: string): string => JSON.stringify({ profiles: [profile], supports: [], interests: [] });

export async function must(actor: Actor, rpc: string, args: Record<string, string | number | null | string[]>): Promise<Record<string, unknown>> {
  const outcome = await runRpc(actor, rpc, args);
  if (!outcome.ok) throw new Error(`${rpc} falló: ${describeOutcome(outcome)}.`);
  return outcome.value;
}

export async function withAccount(o: Original): Promise<{ studentId: string; userId: string }> {
  const studentId = await createStudent(o.world);
  const userId = await createPerson();
  await must(SERVICE, "internal_link_student_user", { p_student_id: studentId, p_user_id: userId });
  return { studentId, userId };
}

async function revisionOf(version: string): Promise<number> {
  const rows = await readRows<{ revision: number }>("select revision from app.versions where id = $1", [version]);
  return at(rows, 0).revision;
}

/** A version of `answerMode` for the students, with the adapted text `body`, approved and published. Gaze: two questions and a key. */
export type PublishOptions = { students: string[]; answerMode: "typed" | "gaze"; body: string; profile: string };
export async function publishVersion(o: Original, { students, answerMode, body, profile }: PublishOptions): Promise<{ version: string; questions: string[]; key: string[] }> {
  const actor = teacherOf(o.world);
  const version = idOf(await runRpc(actor, "create_version", { p_assessment_id: o.assessmentId, p_config: configOf(profile), p_answer_mode: answerMode, p_op_key: randomUUID(), p_base_version_id: null }));
  const exercises = await readRows<{ id: string }>(
    "select ve.id from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = $1 order by e.position",
    [version],
  );
  for (const [index, row] of exercises.entries()) {
    await must(actor, "update_version_exercise", { p_version_exercise_id: row.id, p_revision: 1, p_body: `${body} ${index + 1}`, p_op_id: randomUUID() });
  }
  const questions: string[] = [];
  if (answerMode === "gaze") {
    for (const [index, row] of exercises.entries()) {
      const insert =
        "insert into app.version_questions (institution_id, version_id, version_exercise_id, position, stem, options) values ($1, $2, $3, $4, 'Elegí una', $5::jsonb) returning id";
      const written = await readRows<{ id: string }>(insert, [o.world.institutionId, version, row.id, String(index), OPTIONS]);
      const question = at(written, 0).id;
      questions.push(question);
      await must(actor, "set_question_key", { p_question_id: question, p_correct_option_id: "B", p_revision: null });
    }
    const content = { exercises: Object.fromEntries(exercises.map((row) => [row.id, { answer: "Base" }])), questions: Object.fromEntries(questions.map((id) => [id, "B"])) };
    await must(actor, "edit_answer_key", { p_version_id: version, p_content: JSON.stringify(content), p_base_revision_id: null });
  }
  await must(actor, "set_version_recipients", { p_version_id: version, p_revision: await revisionOf(version), p_student_ids: students, p_op_id: randomUUID() });
  await must(actor, "approve_version", { p_version_id: version, p_revision: await revisionOf(version), p_op_id: randomUUID() });
  await must(actor, "publish_version", { p_version_id: version, p_revision: await revisionOf(version), p_op_key: randomUUID(), p_answer_key_revision_id: null });
  const keys = await readRows<{ id: string }>("select id from app.question_keys where version_id = $1", [version]);
  return { version, questions, key: keys.map((row) => row.id) };
}

export async function learner(o: Original, account: { studentId: string; userId: string }): Promise<Learner> {
  const row = attemptOf(await attemptRows(o.assessmentId), account.studentId);
  return { ...account, actor: { role: "authenticated", userId: account.userId }, assignmentId: row.assignment, attemptId: row.id };
}

/** One group, a student who looks (motor) and one who types (dyslexia), each with their own published version. */
export async function buildClass(): Promise<Class> {
  const o = await original(2);
  const teacher = teacherOf(o.world);
  const looking = await withAccount(o);
  const typing = await withAccount(o);
  for (const [account, profile] of [[looking, "motor"], [typing, "dyslexia"]] as const) {
    await must(teacher, "set_student_needs", { p_student_id: account.studentId, p_profiles: [profile], p_supports: [], p_interests: [], p_op_id: randomUUID(), p_revision: null, p_review_due_on: null });
  }
  const gaze = await publishVersion(o, { students: [looking.studentId], answerMode: "gaze", body: "Ejercicio", profile: "motor" });
  const typed = await publishVersion(o, { students: [typing.studentId], answerMode: "typed", body: "Ejercicio", profile: "dyslexia" });
  return {
    o,
    gaze: await learner(o, looking),
    typed: await learner(o, typing),
    versions: [gaze.version, typed.version],
    questions: gaze.questions,
    keyIds: gaze.key,
  };
}
