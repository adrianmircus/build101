import { openSession } from "../support/db";
import { describe, expect, it } from "vitest";
import { waitUntilBlocked } from "../support/race";
import { describeOutcome, type RpcArgs, type Session } from "../support/session";
import { SERVICE, teacherOf } from "../support/world";
import { GENERATION_ROW, KEY_ROW, confirm, edit, firstKey, record } from "./answer-keys-support";
import { startGeneration } from "./generations-support";
import { fixture, type Fixture } from "./version-ops-support";

// The lock order of the key RPCs (T1.4e): the version first, then the running key generations, then the key row.
// A connection holds ONLY the version (FOR UPDATE as owner), the RPC starts on another one and waits on it, and a
// third connection tries the key row and the running generations with NOWAIT. If the RPC had taken any of them
// before the version, NOWAIT fails with 55P03. Placeholder text only.

async function tryLocks(
  prober: Session,
  version: string,
): Promise<{ key: string; generation: string }> {
  const state = { key: "free", generation: "free" };
  for (const [name, sql] of [
    ["key", KEY_ROW],
    ["generation", GENERATION_ROW],
  ] as const) {
    try {
      await prober.rows(sql, [version]);
    } catch (thrown) {
      const locked =
        typeof thrown === "object" && thrown !== null && Reflect.get(thrown, "code") === "55P03";
      state[name] = locked ? "locked" : "error";
      await prober.rollback();
      await prober.beginAsOwner();
    }
  }
  return state;
}

describe("race: the lock order of the key RPCs is the version first", () => {
  async function probe(
    f: Fixture,
    actor: "teacher" | "service",
    step: { rpc: string; args: RpcArgs },
  ) {
    const [holder, caller, observer, prober] = await Promise.all([
      openSession(),
      openSession(),
      openSession(),
      openSession(),
    ]);
    try {
      await holder.beginAsOwner();
      await holder.rows("select id from app.versions where id = $1 for update", [f.version]);
      await caller.begin(actor === "teacher" ? teacherOf(f.o.world) : SERVICE);
      let done = false;
      const pending = caller.call(step.rpc, step.args).finally(() => {
        done = true;
      });
      const waitedOn = await waitUntilBlocked(caller, observer, () => done);
      await prober.beginAsOwner();
      const state = await tryLocks(prober, f.version);
      await prober.rollback();
      await holder.rollback();
      const outcome = await pending;
      if (outcome.ok) await caller.commit();
      else await caller.rollback();
      return { waitedOn, ...state, result: describeOutcome(outcome) };
    } finally {
      await Promise.all([holder.close(), caller.close(), observer.close(), prober.close()]);
    }
  }

  it("edit_answer_key waits on the version and holds neither the key nor its generations", async () => {
    const f = await fixture(2);
    await startGeneration(f, "answer_key");
    const step = edit(f, { answer: "Uno" });
    const held = await probe(f, "teacher", step);
    expect(held.waitedOn).not.toBeNull();
    expect(held).toMatchObject({ key: "free", generation: "free", result: "ok" });
  });

  it("confirm_answer_key waits on the version and holds neither", async () => {
    const f = await fixture(2);
    const base = await firstKey(f);
    await startGeneration(f, "answer_key");
    const step = confirm(f, base);
    const held = await probe(f, "teacher", step);
    expect(held.waitedOn).not.toBeNull();
    expect(held).toMatchObject({ key: "free", generation: "free", result: "ok" });
  });

  it("internal_record_answer_key_revision waits on the version and holds neither", async () => {
    const f = await fixture(2);
    const generation = await startGeneration(f, "answer_key");
    const step = record(generation, f, "De la IA");
    const held = await probe(f, "service", step);
    expect(held.waitedOn).not.toBeNull();
    expect(held).toMatchObject({ key: "free", generation: "free", result: "ok" });
  });
});
