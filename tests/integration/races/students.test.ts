import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { countRows } from "../support/db";
import { heldRace, stampede, type Step } from "../support/race";
import { describeOutcome } from "../support/session";
import { createWorld, teacherOf, type World } from "../support/world";

// W2-1 and W2-2 (e): create_student with the same op_key, at the same time.

const WITH_USERNAME = "select count(*)::text as n from app.students where institution_id = $1 and username = $2";

function create(world: World, username: string, opKey: string): Step {
  return {
    actor: teacherOf(world),
    rpc: "create_student",
    args: { p_group_id: world.groupId, p_display_name: "Estudiante de prueba", p_username: username, p_op_key: opKey },
  };
}

const username = () => `c${randomUUID().replaceAll("-", "").slice(0, 12)}`;

describe("race: create_student with the same op_key", () => {
  it("the same identity answers the same result and makes one student", async () => {
    const world = await createWorld();
    const [name, opKey] = [username(), randomUUID()];
    const held = await heldRace(create(world, name, opKey), create(world, name, opKey));
    expect(held.first.ok).toBe(true);
    // Without the (institution, op_key) lock the second call does not find the key and answers
    // CONFLICT username_taken instead of the original result.
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("ok");
    expect(held.second).toEqual(held.first);
    expect(await countRows(WITH_USERNAME, [world.institutionId, name])).toBe(1);
  });

  it("another identity is CONFLICT op_key_reused and makes no student", async () => {
    const world = await createWorld();
    const [name, other, opKey] = [username(), username(), randomUUID()];
    const held = await heldRace(create(world, name, opKey), create(world, other, opKey));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT op_key_reused");
    expect(await countRows(WITH_USERNAME, [world.institutionId, other])).toBe(0);
  });

  it("holds when both run at once, 15 times", async () => {
    const world = await createWorld();
    for (let round = 0; round < 15; round += 1) {
      const [name, other, opKey] = [username(), username(), randomUUID()];
      const same = await stampede([create(world, name, opKey), create(world, name, opKey)]);
      expect(same.map(describeOutcome), `same identity, round ${round}`).toEqual(["ok", "ok"]);
      expect(same[1], `round ${round}`).toEqual(same[0]);
      expect(await countRows(WITH_USERNAME, [world.institutionId, name])).toBe(1);

      const fresh = randomUUID();
      const differ = await stampede([create(world, other, fresh), create(world, username(), fresh)]);
      expect(differ.map(describeOutcome).sort(), `another identity, round ${round}`).toEqual(["P0001 CONFLICT op_key_reused", "ok"]);
    }
  });
});
