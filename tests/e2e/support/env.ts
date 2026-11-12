import { execSync } from "node:child_process";
import { z } from "zod";

// What the production server of the e2e run and the global setup share: the local Supabase, Mailpit and a few test values.
// Nothing here is a secret: the keys are the fixed ones of `supabase start`, and every value is for this machine only.

export const PORT = Number(process.env.E2E_PORT ?? 3100);

const Status = z.object({
  API_URL: z.string().min(1),
  DB_URL: z.string().min(1),
  PUBLISHABLE_KEY: z.string().min(1),
  SECRET_KEY: z.string().min(1),
  MAILPIT_URL: z.string().optional(),
});

export type LocalStack = { apiUrl: string; dbUrl: string; publishableKey: string; secretKey: string; mailpitUrl: string };

let cached: LocalStack | undefined;

/** The local stack: the variables if they are already set, else `supabase status` (so no key lives in the repository). */
export function localStack(): LocalStack {
  if (cached) return cached;
  const status = Status.safeParse(
    (() => {
      try {
        return JSON.parse(execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
      } catch {
        throw new Error("Supabase local no está corriendo. Levantalo con `npm run db:start` (necesita Docker) y volvé a correr `npm run test:e2e`.");
      }
    })(),
  );
  if (!status.success) throw new Error("Supabase local no está corriendo. Levantalo con `npm run db:start` (necesita Docker) y volvé a correr `npm run test:e2e`.");
  const found = status.data;
  const url = new URL(found.API_URL);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Las pruebas e2e solo corren contra una base local.");
  cached = {
    apiUrl: found.API_URL,
    dbUrl: found.DB_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || found.PUBLISHABLE_KEY,
    secretKey: process.env.SUPABASE_SECRET_KEY || found.SECRET_KEY,
    mailpitUrl: process.env.MAIL_MAILPIT_URL || found.MAILPIT_URL || "http://127.0.0.1:54324",
  };
  return cached;
}

/** The environment of the production server under test. The values of the demo (empty AI keys, the signing secret) stay as they were. */
export function serverEnv(): Record<string, string> {
  const stack = localStack();
  return {
    SESSION_SECRET: "e2e-only-not-a-real-secret",
    ANTHROPIC_API_KEY: "",
    OPENROUTER_API_KEY: "",
    ELEVENLABS_API_KEY: "",
    NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
    SUPABASE_SECRET_KEY: stack.secretKey,
    NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
    // Throwaway: it only keys the rate-limit counters of this run.
    RATE_LIMIT_SECRET: "e2e-only-rate-limit-secret-0123456789abcdef",
    MAIL_DRIVER: "mailpit",
    MAIL_MAILPIT_URL: stack.mailpitUrl,
    // A production build refuses to start without a Resend key even when the driver is Mailpit. This one is never used.
    RESEND_API_KEY: "e2e-not-a-real-key",
    MAIL_FROM: "Tiza <e2e@tiza.test>",
  };
}
