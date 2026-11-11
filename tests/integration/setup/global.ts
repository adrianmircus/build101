import { execSync } from "node:child_process";
import { z } from "zod";

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

export async function setup(): Promise<void> {
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
}
