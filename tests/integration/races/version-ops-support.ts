import { randomUUID } from "node:crypto";
import { original, type Original } from "../support/assessments";
import { openSession, readRows, runRpc } from "../support/db";
import { waitUntilBlocked, type Step } from "../support/race";
import { idOf, type Outcome } from "../support/session";
import { teacherOf } from "../support/world";

// Shared by version-ops.test.ts and version-ops-targets.test.ts (races of T1.4c). Placeholder text only.

const CONFIG = JSON.stringify({ profiles: ["motor"], supports: [], interests: [] });
export const OPTIONS = JSON.stringify([
  { id: "A", text: "Uno" },
  { id: "B", text: "Dos" },
  { id: "C", text: "Tres" },
]);

export type Fixture = { o: Original; version: string; adapted: string[]; questions: string[] };

export function at<T>(list: T[], index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error("Falta el elemento de la prueba.");
  return found;
}

/** A version of a new assessment, with its adapted exercises and (optionally) two questions in the first one and one in the second. */
export async function fixture(exercises: number, withQuestions = false): Promise<Fixture> {
  const o = await original(exercises);
  const args = { p_assessment_id: o.assessmentId, p_config: CONFIG, p_answer_mode: "gaze", p_op_key: randomUUID(), p_base_version_id: null };
  const version = idOf(await runRpc(teacherOf(o.world), "create_version", args));
  const rows = await readRows<{ id: string }>(
    "select ve.id from app.version_exercises ve join app.assessment_exercises e on e.id = ve.exercise_id where ve.version_id = $1 order by e.position",
    [version],
  );
  const adapted = rows.map((row) => row.id);
  const questions: string[] = [];
  if (withQuestions) {
    for (const [index, target] of [0, 0, 1].entries()) {
      const insert =
        "insert into app.version_questions (institution_id, version_id, version_exercise_id, position, stem, options) values ($1, $2, $3, $4, 'Enunciado', $5::jsonb) returning id";
      const written = await readRows<{ id: string }>(insert, [o.world.institutionId, version, at(adapted, target), String(index), OPTIONS]);
      questions.push(at(written, 0).id);
    }
  }
  return { o, version, adapted, questions };
}

const actor = (f: Fixture) => teacherOf(f.o.world);
export const exerciseEdit = (f: Fixture, s: { exercise: string; body: string; opId: string; revision?: number }): Step => ({
  actor: actor(f),
  rpc: "update_version_exercise",
  args: { p_version_exercise_id: s.exercise, p_revision: s.revision ?? 1, p_body: s.body, p_op_id: s.opId },
});
export const instructionsEdit = (f: Fixture, s: { text: string; opId: string }): Step => ({
  actor: actor(f),
  rpc: "update_version_instructions",
  args: { p_version_id: f.version, p_revision: 1, p_general_instructions: s.text, p_op_id: s.opId },
});
export const questionEdit = (f: Fixture, s: { question: string; stem: string; opId: string }): Step => ({
  actor: actor(f),
  rpc: "update_version_question",
  args: { p_question_id: s.question, p_revision: 1, p_stem: s.stem, p_options: OPTIONS, p_op_id: s.opId },
});
export const keyEdit = (f: Fixture, s: { question: string; option: string }): Step => ({
  actor: actor(f),
  rpc: "set_question_key",
  args: { p_question_id: s.question, p_correct_option_id: s.option, p_revision: null },
});
export const approval = (f: Fixture, s: { revision: number; opId?: string }): Step => ({
  actor: actor(f),
  rpc: "approve_version",
  args: { p_version_id: f.version, p_revision: s.revision, p_op_id: s.opId ?? randomUUID() },
});
export const rejection = (f: Fixture, s: { revision: number; opId: string }): Step => ({
  actor: actor(f),
  rpc: "reject_version",
  args: { p_version_id: f.version, p_revision: s.revision, p_reasons: ["no_adapta", "confuso"], p_op_id: s.opId },
});

/** Writes every adapted exercise by hand: the version becomes ready and its revision is the number of exercises plus one. */
export async function fill(f: Fixture): Promise<number> {
  for (const exercise of f.adapted) {
    const step = exerciseEdit(f, { exercise, body: "Texto de la persona", opId: randomUUID() });
    idOf(await runRpc(actor(f), "update_version_exercise", step.args));
  }
  return 1 + f.adapted.length;
}

export type Probed = { first: Outcome; second: Outcome; waitedOn: string | null; probe: "free" | "locked" | "none" };
export type Probe = { sql: string; id: string };
export const EXERCISE_ROW = "select id from app.version_exercises where id = $1 for update nowait";
export const QUESTION_ROW = "select id from app.version_questions where id = $1 for update nowait";
export const EVENTS = "select count(*)::text as n from app.version_events where op_id = $1";

async function settle(outcome: Outcome, session: { commit: () => Promise<void>; rollback: () => Promise<void> }): Promise<void> {
  if (outcome.ok) await session.commit();
  else await session.rollback();
}

/**
 * heldRace plus a probe: while the second call is blocked, a third connection tries to lock one row of the
 * second call's own target with NOWAIT. "free" means the second call has not touched its target yet, which
 * is what taking the version lock first guarantees.
 */
export async function heldRaceProbed(first: Step, second: Step, probe: Probe): Promise<Probed> {
  const [a, b, observer, prober] = await Promise.all([openSession(), openSession(), openSession(), openSession()]);
  try {
    await a.begin(first.actor);
    await b.begin(second.actor);
    const firstOutcome = await a.call(first.rpc, first.args);
    let done = false;
    const pending = b.call(second.rpc, second.args).finally(() => {
      done = true;
    });
    const waitedOn = await waitUntilBlocked(b, observer, () => done);
    let state: Probed["probe"] = "none";
    if (waitedOn !== null) {
      await prober.beginAsOwner();
      try {
        await prober.rows(probe.sql, [probe.id]);
        state = "free";
      } catch (thrown) {
        state = typeof thrown === "object" && thrown !== null && Reflect.get(thrown, "code") === "55P03" ? "locked" : "none";
      } finally {
        await prober.rollback();
      }
    }
    await settle(firstOutcome, a);
    const secondOutcome = await pending;
    await settle(secondOutcome, b);
    return { first: firstOutcome, second: secondOutcome, waitedOn, probe: state };
  } finally {
    await Promise.all([a.close(), b.close(), observer.close(), prober.close()]);
  }
}

type ExerciseState = { revision: number; body: string; status: string };
export async function exerciseState(id: string): Promise<ExerciseState> {
  const rows = await readRows<ExerciseState>("select revision, body, status from app.version_exercises where id = $1", [id]);
  return at(rows, 0);
}
type VersionState = { revision: number; approved_revision: number | null };
export async function versionState(id: string): Promise<VersionState> {
  const rows = await readRows<VersionState>("select revision, approved_revision from app.versions where id = $1", [id]);
  return at(rows, 0);
}
