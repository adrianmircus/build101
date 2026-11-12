import { execSync } from "node:child_process";
import { parse } from "pg-connection-string";
import { Session, type Actor, type Outcome, type RpcArgs } from "./session";

const LOCAL_DEFAULT = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
// Parameters that change where pg connects besides the authority of the URL.
const REDIRECTING_PARAMS = ["hostaddr", "service"];

/**
 * True only when pg would really connect to this machine. It validates the effective host (the one
 * pg uses: a `?host=` in the query wins over the authority) or a local socket, and refuses the
 * parameters that redirect the connection.
 */
export function isLocalDatabaseUrl(url: string): boolean {
  if (!/^postgres(ql)?:\/\//.test(url)) return false;
  let config: ReturnType<typeof parse>;
  try {
    config = parse(url);
  } catch {
    return false;
  }
  if (REDIRECTING_PARAMS.some((key) => Reflect.has(config, key))) return false;
  const host = config.host;
  if (typeof host !== "string" || host === "") return false;
  return LOCAL_HOSTS.has(host) || host.startsWith("/");
}

let cached: string | undefined;

function statusUrl(): string {
  try {
    const status: unknown = JSON.parse(execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    const found = typeof status === "object" && status !== null ? Reflect.get(status, "DB_URL") : null;
    return typeof found === "string" ? found : LOCAL_DEFAULT;
  } catch {
    return LOCAL_DEFAULT;
  }
}

/**
 * The local database. TIZA_RACE_DB_URL points the tests at another local database (a scratch copy
 * with a lock removed, to prove a test fails without it). Never anything that is not this machine:
 * these tests write and commit rows.
 */
export function databaseUrl(): string {
  if (cached) return cached;
  const url = process.env.TIZA_RACE_DB_URL || statusUrl();
  if (!isLocalDatabaseUrl(url)) throw new Error("Las pruebas de carreras solo corren contra una base local.");
  cached = url;
  return url;
}

/** True when the tests run against a scratch database instead of the shared local one. */
export function isScratchDatabase(): boolean {
  return Boolean(process.env.TIZA_RACE_DB_URL);
}

export async function openSession(): Promise<Session> {
  return Session.open(databaseUrl());
}

/** One RPC in its own transaction, committed when it succeeds. */
export async function runRpc(actor: Actor, name: string, args: RpcArgs): Promise<Outcome> {
  const session = await openSession();
  try {
    await session.begin(actor);
    const outcome = await session.call(name, args);
    if (outcome.ok) await session.commit();
    else await session.rollback();
    return outcome;
  } finally {
    await session.close();
  }
}

/** Reads with the database owner's rights. */
export async function readRows<T extends Record<string, unknown>>(sql: string, values: string[] = []): Promise<T[]> {
  const session = await openSession();
  try {
    return await session.rows<T>(sql, values);
  } finally {
    await session.close();
  }
}

/** The number a `select count(*)` returns. */
export async function countRows(sql: string, values: string[] = []): Promise<number> {
  const rows = await readRows<{ n: string }>(sql, values);
  return Number(rows[0]?.n ?? Number.NaN);
}
