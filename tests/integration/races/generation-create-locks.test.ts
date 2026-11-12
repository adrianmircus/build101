import { describe, expect, it } from "vitest";
import { countRows, openSession } from "../support/db";
import { waitUntilBlocked } from "../support/race";
import { idOf, type Session } from "../support/session";
import { SERVICE } from "../support/world";
import { RUNNING, createStep, exerciseRow, generationStatus, startGeneration, type Kind } from "./generations-support";
import { EXERCISE_ROW, at, fixture, type Fixture } from "./version-ops-support";

// T14d-2: internal_create_generation takes the version (app.lock_version_tree) before the running generations
// and the adapted exercises, the order the edits of T1.4c keep. Whoever takes a generation or an exercise first
// and then waits for the version can deadlock with an edit that goes version -> exercise. A plain "it waited"
// does not show that (without the lock it would still wait on the generations, the exercises or a foreign key),
// so the check does not depend on what the call waits for: a connection holds ONLY the version (FOR UPDATE as
// owner), the RPC starts on another one as service_role and blocks, and a third connection tries the running
// generations of the version and its adapted exercises with NOWAIT. If the RPC took any of them before the
// version (lock_version_tree removed or delayed), NOWAIT fails with 55P03. Placeholder text only.

const GENERATION_ROWS = "select id from app.generations where version_id = $1 and status = 'running' for update nowait";
const EXERCISE_ROWS = "select id from app.version_exercises where version_id = $1 for update nowait";

function codeOf(error: unknown): string {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : "error";
}

// Each probe in its own savepoint: a NOWAIT failure aborts the transaction and would hide the next answer (25P02).
async function nowait(prober: Session, sql: string, id: string): Promise<string> {
  await prober.rows("savepoint probe");
  return prober.rows(sql, [id]).then(
    () => prober.rows("release savepoint probe").then(() => "free"),
    (error: unknown) => prober.rows("rollback to savepoint probe").then(() => codeOf(error)),
  );
}

type Held = { waitedOn: string | null; generations: string; exercises: string; target: string; created: boolean; id: string };

async function holdingTheVersion(f: Fixture, kind: Kind, target?: string): Promise<Held> {
  const step = createStep(f, { kind, target });
  const [holder, caller, observer, prober] = await Promise.all([openSession(), openSession(), openSession(), openSession()]);
  try {
    await holder.beginAsOwner();
    await holder.rows("select id from app.versions where id = $1 for update", [f.version]);
    await caller.begin(SERVICE);
    let done = false;
    const pending = caller.call(step.rpc, step.args).finally(() => {
      done = true;
    });
    const waitedOn = await waitUntilBlocked(caller, observer, () => done);
    await prober.beginAsOwner();
    const held: Held = {
      waitedOn,
      generations: await nowait(prober, GENERATION_ROWS, f.version),
      exercises: await nowait(prober, EXERCISE_ROWS, f.version),
      target: target ? await nowait(prober, EXERCISE_ROW, target) : "free",
      created: false,
      id: "",
    };
    await prober.rollback();
    await holder.rollback();
    const outcome = await pending;
    if (outcome.ok) {
      held.created = outcome.value.created === true;
      held.id = idOf(outcome);
      await caller.commit();
    } else {
      await caller.rollback();
      throw new Error(`La creación falló: ${outcome.state} ${outcome.reason}`);
    }
    return held;
  } finally {
    await Promise.all([holder.close(), caller.close(), observer.close(), prober.close()]);
  }
}

describe("race: creating a generation takes the version before the generations and the exercises", () => {
  it("kind version waits on the version and holds neither the running generations nor the exercises", async () => {
    const f = await fixture(2);
    const before = await startGeneration(f, "version");
    const held = await holdingTheVersion(f, "version");
    expect(held.waitedOn).not.toBeNull();
    expect(held).toMatchObject({ generations: "free", exercises: "free", created: true });
    expect(await generationStatus(before)).toBe("superseded");
    expect(await generationStatus(held.id)).toBe("running");
    expect(await countRows(RUNNING, [f.version])).toBe(1);
  });

  it("kind exercise waits on the version and holds neither the running generations nor the exercises", async () => {
    const f = await fixture(2);
    const [one, two] = [at(f.adapted, 0), at(f.adapted, 1)];
    const before = await startGeneration(f, "exercise", one);
    const held = await holdingTheVersion(f, "exercise", one);
    expect(held.waitedOn).not.toBeNull();
    expect(held).toMatchObject({ generations: "free", exercises: "free", target: "free", created: true });
    expect(await generationStatus(before)).toBe("superseded");
    expect(await exerciseRow(one)).toMatchObject({ status: "generating", current: held.id });
    expect(await exerciseRow(two)).toMatchObject({ current: null });
  });

  it("kind answer_key waits on the version and holds neither the running generations nor the exercises", async () => {
    const f = await fixture(2, true);
    const before = await startGeneration(f, "answer_key");
    const other = await startGeneration(f, "version");
    const held = await holdingTheVersion(f, "answer_key");
    expect(held.waitedOn).not.toBeNull();
    expect(held).toMatchObject({ generations: "free", exercises: "free", created: true });
    expect(await generationStatus(before)).toBe("superseded");
    expect(await generationStatus(other)).toBe("running");
    expect(await generationStatus(held.id)).toBe("running");
  });
});
