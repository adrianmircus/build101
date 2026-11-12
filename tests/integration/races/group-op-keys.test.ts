import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { countRows } from "../support/db";
import { heldRace, stampede, type Step } from "../support/race";
import { describeOutcome, idOf } from "../support/session";
import { createWorld, teacherOf, type World } from "../support/world";

// F3-4: a double submit of create_group. The lock of (institution, op_key) is taken before the lookup:
// without it the second copy does not block, finds no row (the first is not committed), inserts, waits
// on the unique index of the op_key (a transactionid wait, not advisory) and ends in a raw 23505.
describe("race: create_group with the same op_key", () => {
  function createGroup(world: World, opKey: string, name = "Grupo repetido"): Step {
    const args = { p_institution_id: world.institutionId, p_name: name, p_subject_id: "math", p_school_year: 2027, p_op_key: opKey };
    return { actor: teacherOf(world), rpc: "create_group", args };
  }
  const GROUPS = "select count(*)::text as n from app.groups where institution_id = $1 and op_key = $2";
  const OWNERS = "select count(*)::text as n from app.group_staff s join app.groups g on g.id = s.group_id where g.institution_id = $1 and g.op_key = $2 and s.role = 'owner'";

  it("two creates: the second waits on the advisory lock and answers the same group, with one group and one owner", async () => {
    const world = await createWorld();
    const key = randomUUID();
    const held = await heldRace(createGroup(world, key), createGroup(world, key));
    expect(held.first.ok).toBe(true);
    expect(held.waitedOn).toBe("advisory");
    expect(held.second).toEqual(held.first);
    expect(await countRows(GROUPS, [world.institutionId, key])).toBe(1);
    expect(await countRows(OWNERS, [world.institutionId, key])).toBe(1);
  });

  it("the same op_key with another name waits and is CONFLICT op_key_reused", async () => {
    const world = await createWorld();
    const key = randomUUID();
    const held = await heldRace(createGroup(world, key), createGroup(world, key, "Otro nombre"));
    expect(held.waitedOn).toBe("advisory");
    expect(describeOutcome(held.second)).toBe("P0001 CONFLICT op_key_reused");
    expect(await countRows(GROUPS, [world.institutionId, key])).toBe(1);
  });

  it("six creates at once with one op_key make one group and one owner, 10 times", async () => {
    const world = await createWorld();
    for (let round = 0; round < 10; round += 1) {
      const key = randomUUID();
      const outcomes = await stampede(Array.from({ length: 6 }, () => createGroup(world, key, `Grupo ${round}`)));
      expect(outcomes.map(describeOutcome), `round ${round}`).toEqual(Array(6).fill("ok"));
      expect(new Set(outcomes.map(idOf)).size, `round ${round}`).toBe(1);
      expect(await countRows(OWNERS, [world.institutionId, key]), `round ${round}`).toBe(1);
    }
  });
});
