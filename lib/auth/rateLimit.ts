import "server-only";
import { createHash } from "node:crypto";

// Failed logins, counted in windows of 15 minutes. Only failures count, and a right password clears them.
// - 10 per IP + username: someone guessing one account from one place.
// - 30 per username from any IP: the same, spread across many places.
// No limit per IP alone: a whole school goes out through one IP, and a class mistyping would lock everyone out.
// Generous on purpose: students with dysgraphia or motor difficulties mistype more.
export const WINDOW_SECONDS = 15 * 60;
export const MAX_PER_IP_AND_USER = 10;
export const MAX_PER_USER = 30;

// Where the counters live. Each counter expires WINDOW_SECONDS after its first failure.
export type Store = {
  get(key: string): Promise<number>;
  increment(key: string): Promise<number>;
  clear(key: string): Promise<void>;
};

// Usernames are minors' data: the keys carry a hash, never the name or the IP.
function keys(ip: string, username: string): { pair: string; user: string } {
  const hash = (value: string) => createHash("sha256").update(value).digest("base64url").slice(0, 22);
  const user = username.trim().toLowerCase().slice(0, 64);
  return { pair: `login:pair:${hash(`${ip}|${user}`)}`, user: `login:user:${hash(user)}` };
}

export async function isLocked(ip: string, username: string, store = defaultStore()): Promise<boolean> {
  const { pair, user } = keys(ip, username);
  const [byPair, byUser] = await Promise.all([store.get(pair), store.get(user)]);
  return byPair >= MAX_PER_IP_AND_USER || byUser >= MAX_PER_USER;
}

export async function recordFailure(ip: string, username: string, store = defaultStore()): Promise<void> {
  const { pair, user } = keys(ip, username);
  await Promise.all([store.increment(pair), store.increment(user)]);
}

export async function recordSuccess(ip: string, username: string, store = defaultStore()): Promise<void> {
  const { pair, user } = keys(ip, username);
  await Promise.all([store.clear(pair), store.clear(user)]);
}

// In this server's memory: enough locally, and on Vercel it holds per instance. A cap keeps a flood of made-up
// usernames from growing it without end.
export function memoryStore(now: () => number = Date.now, maxKeys = 10_000): Store {
  const counters = new Map<string, { count: number; expires: number }>();
  const live = (key: string) => {
    const entry = counters.get(key);
    if (entry && entry.expires <= now()) counters.delete(key);
    return counters.get(key);
  };
  return {
    async get(key) {
      return live(key)?.count ?? 0;
    },
    async increment(key) {
      const entry = live(key) ?? { count: 0, expires: now() + WINDOW_SECONDS * 1000 };
      entry.count++;
      counters.set(key, entry);
      if (counters.size > maxKeys) counters.delete(counters.keys().next().value as string);
      return entry.count;
    },
    async clear(key) {
      counters.delete(key);
    },
  };
}

// Upstash Redis through its REST API, shared by every instance. It's what Vercel's Upstash integration sets up
// (KV_REST_API_URL and KV_REST_API_TOKEN).
export function upstashStore(url: string, token: string): Store {
  async function run<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) throw new Error(`Upstash respondió ${res.status}`);
    return res.json() as Promise<T>;
  }
  return {
    async get(key) {
      const { result } = await run<{ result: string | null }>("", ["GET", key]);
      return Number(result ?? 0);
    },
    async increment(key) {
      const [incr] = await run<{ result: number }[]>("/pipeline", [
        ["INCR", key],
        ["EXPIRE", key, WINDOW_SECONDS, "NX"],
      ]);
      return incr.result;
    },
    async clear(key) {
      await run("", ["DEL", key]);
    },
  };
}

// If the shared store fails, the counters go on in memory: a Redis outage never blocks logging in.
export function resilient(primary: Store, backup: Store): Store {
  const guard =
    <A extends unknown[], R>(call: (store: Store, ...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await call(primary, ...args);
      } catch (e) {
        console.warn(`Límite de intentos: el store compartido falló (${e instanceof Error ? e.message : "error"}); sigo en memoria.`);
        return call(backup, ...args);
      }
    };
  return {
    get: guard((store, key: string) => store.get(key)),
    increment: guard((store, key: string) => store.increment(key)),
    clear: guard((store, key: string) => store.clear(key)),
  };
}

let store: Store | null = null;

function defaultStore(): Store {
  if (store) return store;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  store = url && token ? resilient(upstashStore(url, token), memoryStore()) : memoryStore();
  return store;
}
