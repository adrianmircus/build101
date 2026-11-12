import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { countRows, readRows } from "../support/db";
import { heldRace } from "../support/race";
import { describeOutcome } from "../support/session";
import {
  GENERATED,
  OUTPUTS,
  QUESTIONS,
  createStep,
  exerciseRow,
  finishStep,
  generationStatus,
  questionsOutput,
  record,
  recordStep,
  startGeneration,
  textOutput,
  versionRevision,
} from "./generations-support";
import { EXERCISE_ROW, at, exerciseEdit, fixture, heldRaceProbed } from "./version-ops-support";

// The outputs and the closing of a generation under concurrent writers (T1.4d). Every writer takes the
// version first, then the generation, then the exercises (app.lock_version_tree). Each test holds the first
// transaction open, starts the second on another connection, waits to see it blocked and only then lets the
// first commit. Without the lock the second one does not wait, reads what the first has not committed yet and
// decides on the old world: the assertions on the outcomes fail. Placeholder text only.

describe("race: closing a generation", () => {
  it("the last two exercises finish together: one closes it, the other finds it closed, and there is one generated event", async () => {
    const f = await fixture(2);
    const [one, two] = [at(f.adapted, 0), at(f.adapted, 1)];
    const generation = await startGeneration(f, "version");
    await record(generation, { kind: "exercise", output: textOutput("Uno"), exercise: one });
    await record(generation, { kind: "exercise", output: textOutput("Dos"), exercise: two });
    const held = await heldRace(finishStep(generation, "done"), finishStep(generation, "done"));
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok && held.first.value.changed).toBe(true);
    expect(held.second.ok && held.second.value).toEqual({ id: generation, status: "done", changed: false });
    expect(await countRows(GENERATED, [generation])).toBe(1);
    expect(await generationStatus(generation)).toBe("done");
  });

  it("one job ends in failure while another ends in success: the first to close decides, once", async () => {
    const f = await fixture(2);
    const generation = await startGeneration(f, "version");
    const held = await heldRace(finishStep(generation, "failed", "ai_timeout"), finishStep(generation, "done"));
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok && held.first.value.status).toBe("failed");
    expect(held.second.ok && held.second.value).toEqual({ id: generation, status: "failed", changed: false });
    expect(await countRows(GENERATED, [generation])).toBe(0);
  });

  it("an output that arrives after the generation closed is stored as obsolete and touches nothing", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const generation = await startGeneration(f, "version");
    const late = recordStep(generation, { kind: "exercise", output: textOutput("Tarde"), exercise });
    const held = await heldRace(finishStep(generation, "done"), late);
    expect(held.waitedOn).not.toBeNull();
    expect(held.second.ok && held.second.value.outcome).toBe("obsolete");
    expect(await exerciseRow(exercise)).toMatchObject({ revision: 1, body: "" });
    const stored = await readRows<{ outcome: string; body: string }>(
      "select outcome, output ->> 'body' as body from app.generation_outputs where generation_id = $1",
      [generation],
    );
    expect(stored).toEqual([{ outcome: "obsolete", body: "Tarde" }]);
  });

  it("a newer generation that commits first: the output of the old one is obsolete and closing it changes nothing", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const old = await startGeneration(f, "version");
    const held = await heldRace(createStep(f, { kind: "version" }), recordStep(old, { kind: "exercise", output: textOutput("Viejo"), exercise }));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.second.ok && held.second.value.outcome).toBe("obsolete");
    expect(await generationStatus(old)).toBe("superseded");
    expect(await exerciseRow(exercise)).toMatchObject({ revision: 1, body: "" });
    const closing = await heldRace(finishStep(old, "done"), finishStep(old, "done"));
    expect(closing.first.ok && closing.first.value).toEqual({ id: old, status: "superseded", changed: false });
    expect(await countRows(GENERATED, [old])).toBe(0);
  });
});

describe("race: the person wins", () => {
  it("a manual edit that commits first: the output that comes after is obsolete and the exercise is the teacher's", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const generation = await startGeneration(f, "version");
    const edit = exerciseEdit(f, { exercise, body: "Texto de la profe", opId: randomUUID() });
    const late = recordStep(generation, { kind: "exercise", output: textOutput("Texto de la IA"), exercise });
    const held = await heldRace(edit, late);
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.second.ok && held.second.value.outcome).toBe("obsolete");
    expect(await exerciseRow(exercise)).toMatchObject({ revision: 2, body: "Texto de la profe", status: "ready", written_by: null });
  });

  it("the questions that come after a manual edit of the text are obsolete too", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const generation = await startGeneration(f, "version");
    await record(generation, { kind: "exercise", output: textOutput("Texto de la IA"), exercise });
    const edit = exerciseEdit(f, { exercise, body: "Texto de la profe", opId: randomUUID(), revision: 2 });
    const held = await heldRace(edit, recordStep(generation, { kind: "gaze_questions", output: questionsOutput(), exercise }));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.second.ok && held.second.value.outcome).toBe("obsolete");
    expect(await countRows(QUESTIONS, [exercise])).toBe(0);
    expect(await exerciseRow(exercise)).toMatchObject({ revision: 3, body: "Texto de la profe" });
  });

  it("an output that commits first: the edit of the teacher, who saw the old revision, is a CONFLICT and does not overwrite it", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const generation = await startGeneration(f, "version");
    const edit = exerciseEdit(f, { exercise, body: "Texto de la profe", opId: randomUUID() });
    const held = await heldRace(recordStep(generation, { kind: "exercise", output: textOutput("Texto de la IA"), exercise }), edit);
    expect(held.first.ok && held.first.value.outcome).toBe("applied");
    expect(held.waitedOn).not.toBeNull();
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT revision_mismatch");
    expect(await exerciseRow(exercise)).toMatchObject({ revision: 2, body: "Texto de la IA", written_by: generation });
  });

  it("a change of configuration that commits first supersedes the generation: its output is obsolete", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const generation = await startGeneration(f, "version");
    const change = {
      actor: { role: "authenticated" as const, userId: f.o.world.teacher },
      rpc: "update_version_config",
      args: {
        p_version_id: f.version,
        p_revision: await versionRevision(f.version),
        p_config: JSON.stringify({ profiles: ["motor"], supports: [], interests: ["fútbol"] }),
        p_answer_mode: "gaze",
      },
    };
    const held = await heldRace(change, recordStep(generation, { kind: "exercise", output: textOutput("De la configuración vieja"), exercise }));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).not.toBeNull();
    expect(held.second.ok && held.second.value.outcome).toBe("obsolete");
    expect(await generationStatus(generation)).toBe("superseded");
    expect(await exerciseRow(exercise)).toMatchObject({ body: "", status: "pending" });
  });
});

describe("race: the same output twice, and the two stages of an exercise", () => {
  it("two copies of one output: the second waits, answers what was decided, and nothing is applied twice", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const generation = await startGeneration(f, "version");
    const step = recordStep(generation, { kind: "exercise", output: textOutput("Texto"), exercise });
    const held = await heldRaceProbed(step, step, { sql: EXERCISE_ROW, id: exercise });
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok && held.first.value.outcome).toBe("applied");
    expect(held.second).toEqual(held.first);
    expect(await countRows(OUTPUTS, [generation])).toBe(1);
    expect(await exerciseRow(exercise)).toMatchObject({ revision: 2, body: "Texto" });
  });

  it("the text and the questions of one exercise at the same time: both apply, in whichever order they take the lock", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const generation = await startGeneration(f, "version");
    const held = await heldRace(
      recordStep(generation, { kind: "gaze_questions", output: questionsOutput(), exercise }),
      recordStep(generation, { kind: "exercise", output: textOutput("Texto"), exercise }),
    );
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok && held.first.value.outcome).toBe("applied");
    expect(held.second.ok && held.second.value.outcome).toBe("applied");
    expect(await exerciseRow(exercise)).toMatchObject({ revision: 3, body: "Texto", status: "ready", written_by: generation });
    expect(await countRows(QUESTIONS, [exercise])).toBe(1);
  });
});
