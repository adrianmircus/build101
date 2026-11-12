import { describe, expect, it } from "vitest";
import { countRows, readRows } from "../support/db";
import { heldRace } from "../support/race";
import { RUNNING, createStep, exerciseRow, generationStatus } from "./generations-support";
import { at, fixture } from "./version-ops-support";

// Creating generations under concurrent callers (T1.4d). The same request twice waits on the advisory lock of
// (institution, op_key) before any row lock; different requests on one version are ordered by the version
// row (app.lock_version_tree). Without those locks the second call does not wait: a copy inserts a second
// generation and hits the unique index (a raw 23505), and two generations of the same exercise are both
// running. Placeholder text only.

const count = (version: string) => countRows("select count(*)::text as n from app.generations where version_id = $1", [version]);

describe("race: creating a generation", () => {
  it("two copies of the same request: the second waits on the advisory lock and answers the same generation", async () => {
    const f = await fixture(2);
    const step = createStep(f, { kind: "version" });
    const held = await heldRace(step, step);
    expect(held.waitedOn).toBe("advisory");
    expect(held.first.ok && held.first.value.created).toBe(true);
    expect(held.second.ok && held.second.value).toEqual({ id: held.first.ok ? held.first.value.id : null, created: false });
    expect(await count(f.version)).toBe(1);
  });

  it("two regenerations of different exercises coexist: both run, each owns its exercise", async () => {
    const f = await fixture(2);
    const [one, two] = [at(f.adapted, 0), at(f.adapted, 1)];
    const held = await heldRace(createStep(f, { kind: "exercise", target: one }), createStep(f, { kind: "exercise", target: two }));
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok && held.first.value.created).toBe(true);
    expect(held.second.ok && held.second.value.created).toBe(true);
    const [first, second] = [held.first.ok ? String(held.first.value.id) : "", held.second.ok ? String(held.second.value.id) : ""];
    expect(await generationStatus(first)).toBe("running");
    expect(await generationStatus(second)).toBe("running");
    expect(await exerciseRow(one)).toMatchObject({ status: "generating", current: first });
    expect(await exerciseRow(two)).toMatchObject({ status: "generating", current: second });
    expect(await countRows(RUNNING, [f.version])).toBe(2);
  });

  it("two regenerations of the same exercise: the second replaces the first, and only one runs", async () => {
    const f = await fixture(1);
    const exercise = at(f.adapted, 0);
    const held = await heldRace(createStep(f, { kind: "exercise", target: exercise }), createStep(f, { kind: "exercise", target: exercise }));
    expect(held.waitedOn).not.toBeNull();
    expect(held.first.ok && held.first.value.created).toBe(true);
    expect(held.second.ok && held.second.value.created).toBe(true);
    const [first, second] = [held.first.ok ? String(held.first.value.id) : "", held.second.ok ? String(held.second.value.id) : ""];
    expect(await generationStatus(first)).toBe("superseded");
    expect(await generationStatus(second)).toBe("running");
    expect(await countRows(RUNNING, [f.version])).toBe(1);
    expect(await exerciseRow(exercise)).toMatchObject({ current: second });
  });

  it("a version generation and an exercise regeneration at the same time: the version one, last, takes everything", async () => {
    const f = await fixture(2);
    const exercise = at(f.adapted, 0);
    const held = await heldRace(createStep(f, { kind: "exercise", target: exercise }), createStep(f, { kind: "version" }));
    expect(held.waitedOn).not.toBeNull();
    const [first, second] = [held.first.ok ? String(held.first.value.id) : "", held.second.ok ? String(held.second.value.id) : ""];
    expect(await generationStatus(first)).toBe("superseded");
    expect(await generationStatus(second)).toBe("running");
    expect(await countRows(RUNNING, [f.version])).toBe(1);
    const owned = await readRows<{ n: string }>("select count(*)::text as n from app.version_exercises where version_id = $1 and current_generation_id = $2", [f.version, second]);
    expect(owned[0]?.n).toBe("2");
  });
});
