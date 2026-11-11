import "server-only";
import { z } from "zod";

// Supabase's current key names (the "api keys" model that replaces the legacy anon / service_role
// JWTs): a publishable key, safe for the browser, and a secret key, server only. The CLI prints
// them as PUBLISHABLE_KEY and SECRET_KEY. The legacy JWT keys are not read anywhere.
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const adminSchema = publicSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export type PublicDbEnv = { url: string; publishableKey: string };
export type AdminDbEnv = PublicDbEnv & { secretKey: string };

function fail(error: z.ZodError): never {
  // Only the names of the variables: their values are keys and must never reach a log.
  const names = [...new Set(error.issues.map((issue) => String(issue.path[0])))].join(", ");
  throw new Error(`Faltan o son inválidas estas variables de entorno de Supabase: ${names}. Mirá .env.example.`);
}

// process.env is read inside the functions, never at import time, so a test can set it first.
export function readPublicDbEnv(env: NodeJS.ProcessEnv = process.env): PublicDbEnv {
  const parsed = publicSchema.safeParse(env);
  if (!parsed.success) return fail(parsed.error);
  return {
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function readAdminDbEnv(env: NodeJS.ProcessEnv = process.env): AdminDbEnv {
  const parsed = adminSchema.safeParse(env);
  if (!parsed.success) return fail(parsed.error);
  return {
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secretKey: parsed.data.SUPABASE_SECRET_KEY,
  };
}
