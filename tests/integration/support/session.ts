import { Client } from "pg";

// A direct connection to the local database, for the concurrency tests: they need several
// connections at the same time, an open transaction held on purpose and the exact SQLSTATE of a
// failure, none of which PostgREST gives. It acts the way PostgREST does: claims of the caller in
// request.jwt.claims and SET LOCAL ROLE, so the RPCs see the same session they see in production.

export type Actor = { role: "service_role" } | { role: "authenticated"; userId: string };

export type RpcArg = string | number | null | string[];
export type RpcArgs = Record<string, RpcArg>;

export type Outcome =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; state: string; message: string; reason: string };

/** "ok", or "<sqlstate> <message> <detail>" (for an expected error: "P0001 CONFLICT role_conflict"). */
export function describeOutcome(outcome: Outcome): string {
  return outcome.ok ? "ok" : `${outcome.state} ${outcome.message} ${outcome.reason}`.trim();
}

/** The id an RPC answered. Throws when the outcome is an error or has no id: a test bug or a real one. */
export function idOf(outcome: Outcome): string {
  if (!outcome.ok) throw new Error(`Se esperaba un id y llegó ${describeOutcome(outcome)}.`);
  const id = outcome.value.id;
  if (typeof id !== "string") throw new Error("La RPC no devolvió un id (nulo o ausente).");
  return id;
}

const NAME = /^[a-z][a-z_]*$/;
const ARG = /^p_[a-z_]+$/;

type PgFailure = { code: string; message: string; detail?: string };

function isPgFailure(value: unknown): value is PgFailure {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function callSql(name: string, args: RpcArgs): { sql: string; values: RpcArg[] } {
  const keys = Object.keys(args);
  if (!NAME.test(name) || !keys.every((key) => ARG.test(key))) throw new Error("Nombre de RPC o de argumento inválido.");
  const named = keys.map((key, index) => `${key} => $${index + 1}`).join(", ");
  return { sql: `select api.${name}(${named}) as result`, values: keys.map((key) => args[key] ?? null) };
}

export class Session {
  private constructor(
    private readonly client: Client,
    readonly pid: number,
  ) {}

  static async open(url: string): Promise<Session> {
    const client = new Client({ connectionString: url });
    await client.connect();
    const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
    return new Session(client, rows[0]?.pid ?? 0);
  }

  /** Starts a transaction as the actor; it stays open until commit() or rollback(). */
  async begin(actor: Actor): Promise<void> {
    await this.client.query("begin");
    const claims = actor.role === "authenticated" ? { sub: actor.userId, role: actor.role } : { role: actor.role };
    await this.client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await this.client.query(actor.role === "authenticated" ? "set local role authenticated" : "set local role service_role");
  }

  /**
   * Starts a transaction as the database owner, for a test that plays another writer of the tables
   * (one that takes row locks with SQL through rows()). It stays open until commit() or rollback().
   */
  async beginAsOwner(): Promise<void> {
    await this.client.query("begin");
  }

  /** One RPC inside the open transaction. A failure aborts the transaction: roll it back. */
  async call(name: string, args: RpcArgs): Promise<Outcome> {
    const { sql, values } = callSql(name, args);
    try {
      const { rows } = await this.client.query<{ result: unknown }>(sql, values);
      const value = rows[0]?.result;
      return { ok: true, value: isRecord(value) ? value : {} };
    } catch (thrown) {
      if (!isPgFailure(thrown)) throw thrown;
      return { ok: false, state: thrown.code, message: thrown.message, reason: thrown.detail ?? "" };
    }
  }

  async commit(): Promise<void> {
    await this.client.query("commit");
  }

  async rollback(): Promise<void> {
    await this.client.query("rollback");
  }

  /** What this connection is waiting for right now (`advisory`, `transactionid`...), or null. */
  async waitEvent(observer: Session): Promise<string | null> {
    const { rows } = await observer.client.query<{ wait_event: string | null }>(
      "select wait_event from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'",
      [this.pid],
    );
    return rows[0]?.wait_event ?? null;
  }

  /** A query as the database owner: to check what the RPCs left behind or, after beginAsOwner(), to take row locks. */
  async rows<T extends Record<string, unknown>>(sql: string, values: string[] = []): Promise<T[]> {
    return (await this.client.query<T>(sql, values)).rows;
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}
