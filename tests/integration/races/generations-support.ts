import { randomUUID } from "node:crypto";
import { readRows, runRpc } from "../support/db";
import type { Step } from "../support/race";
import { idOf } from "../support/session";
import { SERVICE } from "../support/world";
import { at, type Fixture } from "./version-ops-support";

// Shared by generations.test.ts and generations-create.test.ts (races of T1.4d). The internal RPCs run as
// service_role, the edits of the teacher as authenticated. Placeholder text only.

const HASH = "a".repeat(64);

export type Kind = "version" | "exercise" | "answer_key";

export const createStep = (f: Fixture, s: { kind: Kind; op?: string; target?: string }): Step => ({
  actor: SERVICE,
  rpc: "internal_create_generation",
  args: {
    p_version_id: f.version,
    p_kind: s.kind,
    p_op_key: s.op ?? randomUUID(),
    p_inputs: JSON.stringify({ exercises: ["Enunciado"] }),
    p_profiles_hash: HASH,
    p_profiles_revision: "r1",
    p_prompt_version: "p1",
    p_required_jobs: 2,
    p_target_exercise_id: s.target ?? null,
    p_requested_by: null,
  },
});

export const textOutput = (body: string): string => JSON.stringify({ body, changes: [{ what: "Frases cortas", why: "Apoyo de lectura" }] });
export const questionsOutput = (): string =>
  JSON.stringify({
    questions: [
      {
        stem: "Pregunta",
        options: [
          { id: "A", text: "Uno" },
          { id: "B", text: "Dos" },
        ],
      },
    ],
  });

export type OutputSpec = { kind: "exercise" | "gaze_questions" | "instructions"; output: string; exercise?: string };

export const recordStep = (generation: string, s: OutputSpec): Step => ({
  actor: SERVICE,
  rpc: "internal_record_generation_output",
  args: { p_generation_id: generation, p_kind: s.kind, p_output: s.output, p_version_exercise_id: s.exercise ?? null },
});

export const finishStep = (generation: string, status: "done" | "failed" | "cancelled", code?: string): Step => ({
  actor: SERVICE,
  rpc: "internal_finish_generation",
  args: { p_generation_id: generation, p_status: status, p_error_code: code ?? null },
});

/** A generation made and committed, as a job would have found it. */
export async function startGeneration(f: Fixture, kind: Kind, target?: string): Promise<string> {
  const step = createStep(f, { kind, target });
  return idOf(await runRpc(step.actor, step.rpc, step.args));
}

/** An output recorded and committed. */
export async function record(generation: string, s: OutputSpec): Promise<void> {
  const step = recordStep(generation, s);
  const outcome = await runRpc(step.actor, step.rpc, step.args);
  if (!outcome.ok) throw new Error("La salida de preparación no se pudo guardar.");
}

export async function generationStatus(id: string): Promise<string> {
  const rows = await readRows<{ status: string }>("select status from app.generations where id = $1", [id]);
  return at(rows, 0).status;
}

export const GENERATED = "select count(*)::text as n from app.version_events where generation_id = $1 and kind = 'generated'";
export const OUTPUTS = "select count(*)::text as n from app.generation_outputs where generation_id = $1";
export const RUNNING = "select count(*)::text as n from app.generations where version_id = $1 and status = 'running'";
export const QUESTIONS = "select count(*)::text as n from app.version_questions where version_exercise_id = $1";

type ExerciseRow = { revision: number; body: string; status: string; current: string | null; written_by: string | null };
export async function exerciseRow(id: string): Promise<ExerciseRow> {
  const rows = await readRows<ExerciseRow>(
    "select revision, body, status, current_generation_id as current, written_by_generation_id as written_by from app.version_exercises where id = $1",
    [id],
  );
  return at(rows, 0);
}

export async function versionRevision(id: string): Promise<number> {
  return at(await readRows<{ revision: number }>("select revision from app.versions where id = $1", [id]), 0).revision;
}
