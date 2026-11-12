import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicDbEnv } from "@/lib/server/db/env";
import type { Database } from "@/lib/server/db/types";
import type { TestUser } from "./users";

// Same type as SessionClient (lib/server/db/client.ts, which tests may not import): schema api.
export type TestClient = SupabaseClient<Database, "api">;

/** A client logged in as that user, pointed at schema api: what a request from their browser sees. */
export async function createUserClient(user: Pick<TestUser, "email" | "password">): Promise<TestClient> {
  const { url, publishableKey } = readPublicDbEnv();
  const client = createClient<Database, "api">(url, publishableKey, {
    db: { schema: "api" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`No se pudo iniciar sesión con el usuario de prueba (${error.code ?? "sin código"}).`);
  return client;
}
