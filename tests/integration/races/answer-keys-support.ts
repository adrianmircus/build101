import { readRows, runRpc } from "../support/db";
import type { Step } from "../support/race";
import { describeOutcome, type Outcome } from "../support/session";
import { SERVICE, teacherOf } from "../support/world";
import { at, type Fixture } from "./version-ops-support";

// Shared by answer-keys.test.ts and answer-keys-locks.test.ts (races of T1.4e). Placeholder text only.

export const content = (
  f: Fixture,
  answer: string,
  questions: Record<string, string> = {},
): string =>
  JSON.stringify({
    exercises: Object.fromEntries(f.adapted.map((id) => [id, { answer }])),
    questions,
  });

export const edit = (
  f: Fixture,
  s: { answer: string; base?: string | null; questions?: Record<string, string> },
): Step => ({
  actor: teacherOf(f.o.world),
  rpc: "edit_answer_key",
  args: {
    p_version_id: f.version,
    p_content: content(f, s.answer, s.questions),
    p_base_revision_id: s.base ?? null,
  },
});
export const confirm = (f: Fixture, base: string): Step => ({
  actor: teacherOf(f.o.world),
  rpc: "confirm_answer_key",
  args: { p_version_id: f.version, p_base_revision_id: base },
});
export const record = (generation: string, f: Fixture, answer: string): Step => ({
  actor: SERVICE,
  rpc: "internal_record_answer_key_revision",
  args: { p_generation_id: generation, p_content: content(f, answer) },
});
export type KeyRow = {
  current: string | null;
  generation: string | null;
  status: string;
  stale: boolean;
};
export async function keyRow(version: string): Promise<KeyRow> {
  const rows = await readRows<KeyRow>(
    "select current_revision_id::text as current, current_generation_id::text as generation, status, stale from app.answer_keys where version_id = $1",
    [version],
  );
  return at(rows, 0);
}
export async function revisions(
  version: string,
): Promise<{ id: string; number: number; source: string }[]> {
  return readRows<{ id: string; number: number; source: string }>(
    "select id::text as id, number, source from app.answer_key_revisions where version_id = $1 order by number",
    [version],
  );
}
export const KEY_ROW = "select id from app.answer_keys where version_id = $1 for update nowait";
export const GENERATION_ROW =
  "select id from app.generations where version_id = $1 and kind = 'answer_key' and status = 'running' for update nowait";

export function revisionIdOf(outcome: Outcome): string {
  if (!outcome.ok || typeof outcome.value.revisionId !== "string")
    throw new Error(`Se esperaba una revisión y llegó ${describeOutcome(outcome)}.`);
  return outcome.value.revisionId;
}

/** The first key, committed: the base of the races. */
export async function firstKey(f: Fixture): Promise<string> {
  const step = edit(f, { answer: "Base" });
  return revisionIdOf(await runRpc(step.actor, step.rpc, step.args));
}
