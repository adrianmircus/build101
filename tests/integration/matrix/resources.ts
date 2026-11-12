import { randomUUID } from "node:crypto";
import { callRpc } from "@/lib/server/repos/rpc";
import { createGroup } from "../../factories";
import { CONFIG, createTestAssessment } from "../../factories/assessments";
import { createStudent } from "../../factories/students";
import { readRows } from "../support/db";
import { attemptOf, attemptRows } from "../races/publish-support";
import type { Scene } from "./fixtures";

// What each operation of the matrix is called on. Every call makes its own resources, as the owner
// of the scene, so an operation that changes them never gets in the way of another one.

export type RevisionTable = "assessments" | "assessment_exercises" | "versions" | "version_exercises" | "version_questions";

export async function revisionOf(table: RevisionTable, id: string): Promise<number> {
  const rows = await readRows<{ revision: number }>(`select revision from app.${table} where id = $1`, [id]);
  const row = rows[0];
  if (row === undefined) throw new Error("Falta la fila de prueba.");
  return row.revision;
}

export async function instructionsRevisionOf(versionId: string): Promise<number> {
  const rows = await readRows<{ revision: number }>("select instructions_revision as revision from app.versions where id = $1", [versionId]);
  const row = rows[0];
  if (row === undefined) throw new Error("Falta la versión de prueba.");
  return row.revision;
}

export const freshStudent = (s: Scene) => createStudent(s.owner.client, s.groupId);
export const freshGroup = (s: Scene) => createGroup(s.owner.client, s.institution.id);
export const freshAssessment = (s: Scene, exercises = 1) => createTestAssessment(s.owner.client, s.groupId, exercises);

export const OPTIONS = [
  { id: "A", text: "Uno" },
  { id: "B", text: "Dos" },
  { id: "C", text: "Tres" },
];

export type VersionFixture = { assessmentId: string; versionId: string; adapted: string[]; questions: string[] };

/** A version of a new assessment, in `answerMode`, with its adapted exercises still as copied. */
export async function freshVersion(s: Scene, answerMode: "typed" | "gaze" = "typed", exercises = 1): Promise<VersionFixture> {
  const assessment = await freshAssessment(s, exercises);
  const version = await callRpc(s.owner.client, "create_version", {
    p_assessment_id: assessment.id,
    p_config: CONFIG,
    p_answer_mode: answerMode,
    p_op_key: randomUUID(),
  });
  const rows = await readRows<{ id: string }>(
    "select ve.id from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = $1 order by e.position",
    [version.id],
  );
  return { assessmentId: assessment.id, versionId: version.id, adapted: rows.map((row) => row.id), questions: [] };
}

/** A gaze version with one question (options A, B, C) in its first exercise, and the correct option set. */
export async function gazeVersion(s: Scene, withKey = true): Promise<VersionFixture> {
  const v = await freshVersion(s, "gaze");
  const [first] = v.adapted;
  if (first === undefined) throw new Error("La versión de prueba no tiene ejercicios.");
  const insert =
    "insert into app.version_questions (institution_id, version_id, version_exercise_id, position, stem, options) values ($1, $2, $3, 0, 'Elegí una', $4::jsonb) returning id";
  const written = await readRows<{ id: string }>(insert, [s.institution.id, v.versionId, first, JSON.stringify(OPTIONS)]);
  const question = written[0];
  if (question === undefined) throw new Error("No se pudo crear la pregunta de prueba.");
  if (withKey) await callRpc(s.owner.client, "set_question_key", { p_question_id: question.id, p_correct_option_id: "B" });
  return { ...v, questions: [question.id] };
}

/** A typed version with its text written and recipients set: ready to be approved. */
export async function readyVersion(s: Scene, students: string[] = [s.learner.studentId]): Promise<VersionFixture> {
  const v = await freshVersion(s);
  const owner = s.owner.client;
  for (const id of v.adapted) {
    const revision = await revisionOf("version_exercises", id);
    await callRpc(owner, "update_version_exercise", { p_version_exercise_id: id, p_revision: revision, p_body: "Adaptado", p_op_id: randomUUID() });
  }
  const recipients = { p_version_id: v.versionId, p_revision: await revisionOf("versions", v.versionId), p_student_ids: students, p_op_id: randomUUID() };
  await callRpc(owner, "set_version_recipients", recipients);
  return v;
}

/** The same, approved. */
export async function approvedVersion(s: Scene): Promise<VersionFixture> {
  const v = await readyVersion(s);
  const approval = { p_version_id: v.versionId, p_revision: await revisionOf("versions", v.versionId), p_op_id: randomUUID() };
  await callRpc(s.owner.client, "approve_version", approval);
  return v;
}

export type Published = VersionFixture & { attemptId: string; assignmentId: string; publicationId: string };

/** The approved version published to the learner: their attempt is open. */
export async function publishedVersion(s: Scene): Promise<Published> {
  const v = await approvedVersion(s);
  const published = await callRpc(s.owner.client, "publish_version", {
    p_version_id: v.versionId,
    p_revision: await revisionOf("versions", v.versionId),
    p_op_key: randomUUID(),
  });
  const row = attemptOf(await attemptRows(v.assessmentId), s.learner.studentId);
  return { ...v, attemptId: row.id, assignmentId: row.assignment, publicationId: published.publicationId };
}

/** The learner started and handed in their attempt. */
export async function submittedAttempt(s: Scene): Promise<Published> {
  const p = await publishedVersion(s);
  const started = await callRpc(s.learner.client, "student_start_attempt", { p_attempt_id: p.attemptId });
  await callRpc(s.learner.client, "student_submit_attempt", { p_attempt_id: p.attemptId, p_revision: started.draftRevision });
  return p;
}
