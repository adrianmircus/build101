import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { original, type Original } from "../support/assessments";
import { countRows, runRpc } from "../support/db";
import { heldRace, stampede, type Step } from "../support/race";
import { describeOutcome, idOf } from "../support/session";
import { createWorld, teacherOf, type World } from "../support/world";
// T1.F3: a double submit of a creation. The lock of (institution, op_key) is taken before the lookup:
// without it the second copy does not block, finds no row (the first is not committed) and inserts,
// and the unique index answers it with a raw 23505 instead of the same result.
describe("race: create_assessment and add_exercise with the same op_key", () => {
  function createAssessment(world: World, opKey: string, topic = "Repaso"): Step {
    return {
      actor: teacherOf(world),
      rpc: "create_assessment",
      args: { p_group_id: world.groupId, p_kind: "worksheet", p_topic: topic, p_general_instructions: "Instrucciones", p_op_key: opKey },
    };
  }
  function addKeyed(o: Original, opKey: string, body = "Enunciado repetido"): Step {
    return {
      actor: teacherOf(o.world),
      rpc: "add_exercise",
      args: { p_assessment_id: o.assessmentId, p_label: "9", p_body: body, p_op_key: opKey, p_topic_id: null },
    };
  }
  const ASSESSMENTS = "select count(*)::text as n from app.assessments where group_id = $1";
  const EXERCISES = "select count(*)::text as n from app.assessment_exercises where assessment_id = $1";

  it("two creates of an assessment with the same op_key: the second waits and answers the same one", async () => {
    const world = await createWorld();
    const key = randomUUID();
    const held = await heldRace(createAssessment(world, key), createAssessment(world, key));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).toBe("advisory");
    expect(held.second).toEqual(held.first);
    expect(await countRows(ASSESSMENTS, [world.groupId])).toBe(1);
  });

  it("the same op_key with another topic waits and is CONFLICT op_key_reused", async () => {
    const world = await createWorld();
    const key = randomUUID();
    const held = await heldRace(createAssessment(world, key), createAssessment(world, key, "Otro tema"));
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT op_key_reused");
    expect(await countRows(ASSESSMENTS, [world.groupId])).toBe(1);
  });

  it("six creates at once with one op_key make one assessment, 10 times", async () => {
    const world = await createWorld();
    for (let round = 0; round < 10; round += 1) {
      const key = randomUUID();
      const outcomes = await stampede(Array.from({ length: 6 }, () => createAssessment(world, key, `Repaso ${round}`)));
      expect(outcomes.map(describeOutcome), `round ${round}`).toEqual(Array(6).fill("ok"));
      expect(new Set(outcomes.map(idOf)).size, `round ${round}`).toBe(1);
    }
    expect(await countRows(ASSESSMENTS, [world.groupId])).toBe(10);
  });

  it("two adds of an exercise with the same op_key: the second waits and answers the same one", async () => {
    const o = await original(1);
    const key = randomUUID();
    const held = await heldRace(addKeyed(o, key), addKeyed(o, key));
    expect(held.first.ok).toBe(true);
    // The op_key lock, taken before the lookup and before the assessment row.
    expect(held.waitedOn).toBe("advisory");
    expect(held.second).toEqual(held.first);
    expect(await countRows(EXERCISES, [o.assessmentId])).toBe(2);
  });

  it("the same op_key on two assessments at once: one adds, the other is CONFLICT op_key_reused", async () => {
    const o = await original(1);
    const created = await runRpc(teacherOf(o.world), "create_assessment", {
      p_group_id: o.world.groupId,
      p_kind: "exam",
      p_topic: "Otro",
      p_general_instructions: "",
      p_op_key: randomUUID(),
    });
    const other: Original = { ...o, assessmentId: idOf(created), exercises: [] };
    const key = randomUUID();
    const held = await heldRace(addKeyed(o, key), addKeyed(other, key));
    // Different assessment rows, the same key: only the op_key lock orders them.
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT op_key_reused");
    expect(await countRows(EXERCISES, [other.assessmentId])).toBe(0);
  });

  it("six adds at once with one op_key make one exercise, 10 times", async () => {
    const o = await original(0);
    for (let round = 0; round < 10; round += 1) {
      const key = randomUUID();
      const outcomes = await stampede(Array.from({ length: 6 }, () => addKeyed(o, key, `Enunciado ${round}`)));
      expect(outcomes.map(describeOutcome), `round ${round}`).toEqual(Array(6).fill("ok"));
      expect(new Set(outcomes.map(idOf)).size, `round ${round}`).toBe(1);
    }
    expect(await countRows(EXERCISES, [o.assessmentId])).toBe(10);
  });
});

