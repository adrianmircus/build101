import { randomUUID } from "node:crypto";
import { original, type Original } from "../support/assessments";
import { readRows, runRpc } from "../support/db";
import type { Step } from "../support/race";
import { describeOutcome, idOf } from "../support/session";
import { createStudent, teacherOf } from "../support/world";
import { at } from "./version-ops-support";

// Shared by publish.test.ts and publish-locks.test.ts (races of T1.5a). A typed version that can be published: ready,
// with recipients, approved. Built only through the RPCs and committed. Placeholder text only.

const CONFIG = JSON.stringify({ profiles: ["motor"], supports: [], interests: [] });

export type Ready = { o: Original; version: string; adapted: string[]; students: string[] };

export async function versionRevision(version: string): Promise<number> {
  const rows = await readRows<{ revision: number }>("select revision from app.versions where id = $1", [version]);
  return at(rows, 0).revision;
}

/** A typed version with p_exercises adapted exercises ready, p_students recipients and its approval. */
export async function ready(exercises: number, students: number): Promise<Ready> {
  const o = await original(exercises);
  const ids: string[] = [];
  for (let index = 0; index < students; index += 1) ids.push(await createStudent(o.world));
  return readyOn(o, ids);
}

/** Another typed version, ready and approved, of the same original and for the given recipients (T1.F5: two versions of one assessment). */
export async function readyOn(o: Original, students: string[]): Promise<Ready> {
  const actor = teacherOf(o.world);
  const version = idOf(
    await runRpc(actor, "create_version", { p_assessment_id: o.assessmentId, p_config: CONFIG, p_answer_mode: "typed", p_op_key: randomUUID(), p_base_version_id: null }),
  );
  const rows = await readRows<{ id: string }>(
    "select ve.id from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = $1 order by e.position",
    [version],
  );
  const adapted = rows.map((row) => row.id);
  for (const [index, id] of adapted.entries()) {
    idOf(await runRpc(actor, "update_version_exercise", { p_version_exercise_id: id, p_revision: 1, p_body: `Adaptado ${index + 1}`, p_op_id: randomUUID() }));
  }
  idOf(await runRpc(actor, "set_version_recipients", { p_version_id: version, p_revision: await versionRevision(version), p_student_ids: students, p_op_id: randomUUID() }));
  idOf(await runRpc(actor, "approve_version", { p_version_id: version, p_revision: await versionRevision(version), p_op_id: randomUUID() }));
  return { o, version, adapted, students };
}

/** The teacher publishes the version at its current revision (or the given one). */
export async function publishStep(r: Ready, s: { op?: string; revision?: number } = {}): Promise<Step> {
  return {
    actor: teacherOf(r.o.world),
    rpc: "publish_version",
    args: { p_version_id: r.version, p_revision: s.revision ?? (await versionRevision(r.version)), p_op_key: s.op ?? randomUUID(), p_answer_key_revision_id: null },
  };
}

export async function publishedIds(version: string): Promise<string[]> {
  const rows = await readRows<{ id: string }>("select id from app.publications where version_id = $1 order by published_at", [version]);
  return rows.map((row) => row.id);
}

export type AttemptRow = { id: string; assignment: string; student: string; status: string; publication: string; number: number };
export async function attemptRows(assessment: string): Promise<AttemptRow[]> {
  return readRows<AttemptRow>(
    `select t.id::text as id, t.assignment_id::text as assignment, a.student_id::text as student, t.status, t.publication_id::text as publication, t.number
       from app.assignment_attempts t join app.assignments a on a.id = t.assignment_id
      where t.assessment_id = $1 and t.superseded_at is null order by a.student_id`,
    [assessment],
  );
}

export function attemptOf(rows: AttemptRow[], student: string): AttemptRow {
  const found = rows.find((row) => row.student === student);
  if (!found) throw new Error("Falta el intento del estudiante.");
  return found;
}

/** Publishes now, in its own transaction, and answers the publication. */
export async function publishNow(r: Ready): Promise<string> {
  const step = await publishStep(r);
  const outcome = await runRpc(step.actor, step.rpc, step.args);
  if (!outcome.ok || typeof outcome.value.publicationId !== "string") throw new Error(`Se esperaba una publicación y llegó ${describeOutcome(outcome)}.`);
  return outcome.value.publicationId;
}
