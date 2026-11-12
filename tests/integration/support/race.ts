import { openSession } from "./db";
import { Session, type Actor, type Outcome, type RpcArgs } from "./session";

// Two ways to race two RPCs on separate connections.
//
//   heldRace   deterministic. The first call runs and its transaction stays OPEN (it holds every
//              lock it took). The second call starts on another connection; we wait until it is
//              blocked on a lock (pg_stat_activity), then commit the first. So the second one runs
//              strictly after the first one's commit, as if it had really arrived in the middle.
//              If the function did not take the lock, the second call would not block: it would run
//              against a world without the first one's row, and the test fails on `waitedOn`.
//   stampede   not deterministic. Many calls on pre-opened connections released together.

export type Step = { actor: Actor; rpc: string; args: RpcArgs };
export type HeldResult = { first: Outcome; second: Outcome; waitedOn: string | null };

const WAIT_LIMIT_MS = 2_000;
const POLL_MS = 15;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function finish(session: Session, outcome: Outcome): Promise<void> {
  if (outcome.ok) await session.commit();
  else await session.rollback();
}

/** Waits until the call settles or its connection is blocked on a lock; returns what it waited on. */
export async function waitUntilBlocked(blocked: Session, observer: Session, settled: () => boolean): Promise<string | null> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (Date.now() < deadline && !settled()) {
    const event = await blocked.waitEvent(observer);
    if (event) return event;
    await sleep(POLL_MS);
  }
  return null;
}

export async function heldRace(first: Step, second: Step): Promise<HeldResult> {
  const [a, b, observer] = await Promise.all([openSession(), openSession(), openSession()]);
  try {
    await a.begin(first.actor);
    await b.begin(second.actor);
    const firstOutcome = await a.call(first.rpc, first.args);
    let done = false;
    const pending = b.call(second.rpc, second.args).finally(() => {
      done = true;
    });
    const waitedOn = await waitUntilBlocked(b, observer, () => done);
    await finish(a, firstOutcome);
    const secondOutcome = await pending;
    await finish(b, secondOutcome);
    return { first: firstOutcome, second: secondOutcome, waitedOn };
  } finally {
    await Promise.all([a.close(), b.close(), observer.close()]);
  }
}

/** Every step at once, each in its own transaction on its own connection. */
export async function stampede(steps: Step[]): Promise<Outcome[]> {
  const sessions = await Promise.all(steps.map(() => openSession()));
  try {
    await Promise.all(sessions.map((session, index) => session.begin(steps[index]?.actor ?? { role: "service_role" })));
    const outcomes = await Promise.all(
      sessions.map(async (session, index) => {
        const step = steps[index];
        if (!step) throw new Error("Falta el paso.");
        const outcome = await session.call(step.rpc, step.args);
        await finish(session, outcome);
        return outcome;
      }),
    );
    return outcomes;
  } finally {
    await Promise.all(sessions.map((session) => session.close()));
  }
}

// heldPair: the same idea as heldRace for two sides that are not both RPCs (an INSERT in Auth, a mark of erasure, a lock held on
// a row). The first side runs and its transaction stays open; the second starts on another connection; once it is blocked (or
// done) the first commits. A side runs as the database owner ("owner") or as an actor, the way PostgREST would.

export type Side<T> = { actor: Actor | "owner"; run: (session: Session) => Promise<T> };
export type Settled<T> = { ok: true; value: T } | { ok: false; code: string };
export type HeldPairResult<A, B> = { first: A; second: Settled<B>; waitedOn: string | null };

/** The SQLSTATE of a failure of `pg`, or "unknown". */
export function pgCode(thrown: unknown): string {
  const code: unknown = typeof thrown === "object" && thrown !== null ? Reflect.get(thrown, "code") : undefined;
  return typeof code === "string" ? code : "unknown";
}

async function openSide(session: Session, actor: Actor | "owner"): Promise<void> {
  if (actor === "owner") await session.beginAsOwner();
  else await session.begin(actor);
}

export async function heldPair<A, B>(first: Side<A>, second: Side<B>): Promise<HeldPairResult<A, B>> {
  const [a, b, observer] = await Promise.all([openSession(), openSession(), openSession()]);
  try {
    await Promise.all([openSide(a, first.actor), openSide(b, second.actor)]);
    const firstValue = await first.run(a);
    let done = false;
    const pending: Promise<Settled<B>> = second
      .run(b)
      .then(
        (value): Settled<B> => ({ ok: true, value }),
        (thrown: unknown): Settled<B> => ({ ok: false, code: pgCode(thrown) }),
      )
      .finally(() => {
        done = true;
      });
    const waitedOn = await waitUntilBlocked(b, observer, () => done);
    await a.commit();
    const settled = await pending;
    await (settled.ok ? b.commit() : b.rollback());
    return { first: firstValue, second: settled, waitedOn };
  } finally {
    await Promise.all([a.close(), b.close(), observer.close()]);
  }
}
