import { execSync } from "node:child_process";
import { Client } from "pg";
import { z } from "zod";
import { databaseUrl } from "../support/db";

// Variables the app reads, filled from `supabase status` when they are not already set (CI and
// local both get them from the running stack, so no key lives in the repository).
const statusSchema = z.object({
  API_URL: z.string().min(1),
  PUBLISHABLE_KEY: z.string().min(1),
  SECRET_KEY: z.string().min(1),
});

const NOT_RUNNING =
  "Supabase local no está corriendo. Levantalo con `npm run db:start` (necesita Docker) y volvé a correr `npm run test:integration`.";

function readStatus(): z.infer<typeof statusSchema> {
  let raw: string;
  try {
    raw = execSync("npx supabase status -o json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(NOT_RUNNING);
  }
  const parsed = statusSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(NOT_RUNNING);
  return parsed.data;
}

async function assertApiResponds(url: string): Promise<void> {
  try {
    await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(5000) });
  } catch {
    throw new Error(NOT_RUNNING);
  }
}

/**
 * The shape guard of phase 2 on account_provisioning (app.student_auth_link_guard) refuses to remember the id of an ordinary Auth
 * account. Phase 1 links ordinary accounts (createPerson) in many integration tests, so the guard is off for the run, as the
 * pgTAP files of phase 1 turn it off; pgTAP 040 covers it. TIZA_LINK_GUARD=1 keeps it on, to run the tests that need it
 * (tests/integration/races/student-auth-lock.test.ts) on their own. T2.5a decides how to convert the phase 1 tests.
 */
async function setLinkGuard(enabled: boolean): Promise<void> {
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query(`alter table app.account_provisioning ${enabled ? "enable" : "disable"} trigger student_auth_link_guard`);
  } finally {
    await client.end();
  }
}

export async function setup(): Promise<() => Promise<void>> {
  const hasEnv =
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SECRET_KEY;
  if (!hasEnv) {
    const status = readStatus();
    process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = status.SECRET_KEY;
  }
  await assertApiResponds(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (process.env.TIZA_LINK_GUARD === "1") return async () => {};
  await setLinkGuard(false);
  return async () => setLinkGuard(true);
}
