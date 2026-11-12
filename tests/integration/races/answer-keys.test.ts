import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readRows, runRpc } from "../support/db";
import { heldRace, type Step } from "../support/race";
import { describeOutcome } from "../support/session";
import { teacherOf } from "../support/world";
import {
  confirm,
  edit,
  keyRow,
  record,
  revisionIdOf,
  revisions,
  firstKey,
} from "./answer-keys-support";
import { startGeneration } from "./generations-support";
import { at, exerciseEdit, fixture } from "./version-ops-support";

// The answer key under concurrent writers (T1.4e). Every writer of the key takes the version first, then the
// running key generations, then the key row (app.lock_version_tree). Each test keeps the first transaction open,
// starts the second on another connection, waits to see it blocked and only then lets the first commit. Without
// the lock the second one does not wait: it reads the world before the first one, compares its base with a
// current revision that is about to change and either writes a second revision from the same base or hits the
// unique index (23505): the assertions on the outcomes fail. Placeholder text only.

describe("race: two writers of the key from the same base", () => {
  it("two edits of the first key: the first wins, the second finds a current revision and is a CONFLICT", async () => {
    const f = await fixture(2);
    const held = await heldRace(edit(f, { answer: "Uno" }), edit(f, { answer: "Dos" }));
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok).toBe(true);
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect(await revisions(f.version)).toHaveLength(1);
  });

  it("two edits from the same base: one revision 2, the other CONFLICT, never two revision 2", async () => {
    const f = await fixture(2);
    const base = await firstKey(f);
    const held = await heldRace(edit(f, { answer: "Uno", base }), edit(f, { answer: "Dos", base }));
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok && held.first.value.number).toBe(2);
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect((await revisions(f.version)).map((row) => row.number)).toEqual([1, 2]);
    expect((await keyRow(f.version)).current).toBe(
      held.first.ok ? String(held.first.value.revisionId) : null,
    );
  });

  it("two confirmations from the same base: the second is a CONFLICT", async () => {
    const f = await fixture(2);
    const base = await firstKey(f);
    const held = await heldRace(confirm(f, base), confirm(f, base));
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok && held.first.value.number).toBe(2);
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect(await revisions(f.version)).toHaveLength(2);
  });

  it("an edit and a confirmation from the same base: whoever commits first wins and the other is a CONFLICT", async () => {
    const f = await fixture(2);
    const base = await firstKey(f);
    const held = await heldRace(edit(f, { answer: "Uno", base }), confirm(f, base));
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok).toBe(true);
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect((await revisions(f.version)).map((row) => row.source)).toEqual(["edited", "edited"]);
  });
});

describe("race: a generated key that arrives late", () => {
  it("after an edit of the teacher (the person wins): obsolete, and the edit stays the current revision", async () => {
    const f = await fixture(2);
    const generation = await startGeneration(f, "answer_key");
    const held = await heldRace(
      edit(f, { answer: "De la profe" }),
      record(generation, f, "De la IA"),
    );
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok).toBe(true);
    expect(held.second.ok && held.second.value.outcome).toBe("obsolete");
    const rows = await revisions(f.version);
    expect(rows.map((row) => row.source)).toEqual(["edited", "generated"]);
    expect((await keyRow(f.version)).current).toBe(at(rows, 0).id);
    expect((await keyRow(f.version)).generation).toBeNull();
  });

  it("after an edit of an exercise (the content moved): obsolete, with the snapshot of its generation, and not current", async () => {
    const f = await fixture(2);
    const generation = await startGeneration(f, "answer_key");
    const edited = exerciseEdit(f, {
      exercise: at(f.adapted, 0),
      body: "Texto de la profe",
      opId: randomUUID(),
    });
    const held = await heldRace(edited, record(generation, f, "De la IA"));
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok).toBe(true);
    expect(held.second.ok && held.second.value.outcome).toBe("obsolete");
    expect((await keyRow(f.version)).current).toBeNull();
    const stored = await readRows<{ stale: boolean }>(
      "select r.exercise_revisions <> (select jsonb_object_agg(ve.id::text, ve.revision) from app.version_exercises ve where ve.version_id = r.version_id) as stale from app.answer_key_revisions r where r.version_id = $1",
      [f.version],
    );
    expect(stored).toEqual([{ stale: true }]);
  });

  it("before the edit of the exercise: it is applied, and the edit then leaves the key stale without touching the revision", async () => {
    const f = await fixture(2);
    const generation = await startGeneration(f, "answer_key");
    const edited = exerciseEdit(f, {
      exercise: at(f.adapted, 0),
      body: "Texto de la profe",
      opId: randomUUID(),
    });
    const held = await heldRace(record(generation, f, "De la IA"), edited);
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok && held.first.value.outcome).toBe("applied");
    expect(held.second.ok).toBe(true);
    const key = await keyRow(f.version);
    expect(key.current).toBe(at(await revisions(f.version), 0).id);
    expect(key.stale).toBe(true);
  });

  it("before an edit of the teacher from an empty key: the generated one is the current, and the edit is a CONFLICT", async () => {
    const f = await fixture(2);
    const generation = await startGeneration(f, "answer_key");
    const held = await heldRace(
      record(generation, f, "De la IA"),
      edit(f, { answer: "De la profe" }),
    );
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok && held.first.value.outcome).toBe("applied");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect(await revisions(f.version)).toHaveLength(1);
  });

  it("the same job twice: one revision, and the second answers the stored one", async () => {
    const f = await fixture(2);
    const generation = await startGeneration(f, "answer_key");
    const held = await heldRace(
      record(generation, f, "De la IA"),
      record(generation, f, "De la IA"),
    );
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok && held.second.ok && held.second.value).toEqual(
      held.first.ok ? held.first.value : null,
    );
    expect(await revisions(f.version)).toHaveLength(1);
    const outputs = await readRows<{ n: string }>(
      "select count(*)::text as n from app.generation_outputs where generation_id = $1 and kind = 'answer_key'",
      [generation],
    );
    expect(at(outputs, 0).n).toBe("1");
  });
});

describe("race: a confirmation takes the correct options of the moment it runs", () => {
  it("a correct option that commits first is the one the confirmation writes", async () => {
    const f = await fixture(2, true);
    const teacher = teacherOf(f.o.world);
    for (const question of f.questions) {
      const outcome = await runRpc(teacher, "set_question_key", {
        p_question_id: question,
        p_correct_option_id: "A",
        p_revision: null,
      });
      if (!outcome.ok) throw new Error(describeOutcome(outcome));
    }
    const all = Object.fromEntries(f.questions.map((question) => [question, "A"]));
    const base = revisionIdOf(
      await runRpc(teacher, "edit_answer_key", edit(f, { answer: "Base", questions: all }).args),
    );
    const change: Step = {
      actor: teacher,
      rpc: "set_question_key",
      args: { p_question_id: at(f.questions, 0), p_correct_option_id: "B", p_revision: 1 },
    };
    const held = await heldRace(change, confirm(f, base));
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok).toBe(true);
    expect(held.second.ok).toBe(true);
    const rows = await readRows<{ option: string; matches: boolean }>(
      "select r.content -> 'questions' ->> $2 as option, app.answer_key_matches(r.id, r.version_id) as matches from app.answer_key_revisions r where r.version_id = $1 and r.number = 2",
      [f.version, at(f.questions, 0)],
    );
    expect(rows).toEqual([{ option: "B", matches: true }]);
  });
});
