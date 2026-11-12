import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readPublicDbEnv } from "@/lib/server/db/env";
import type { AdminClient } from "@/lib/server/db/admin";
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

/** A client logged in without a password: the admin makes a magic link (no mail goes out) and the client verifies it. */
export async function createMagicLinkClient(admin: AdminClient, email: string): Promise<TestClient> {
  const { url, publishableKey } = readPublicDbEnv();
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data.properties?.hashed_token;
  if (link.error || tokenHash === undefined) throw new Error("No se pudo crear el enlace de prueba.");
  const client = createClient<Database, "api">(url, publishableKey, {
    db: { schema: "api" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error) throw new Error(`No se pudo abrir la sesión de prueba (${error.code ?? "sin código"}).`);
  return client;
}

/** The `session_id` claim of an access token: the row of auth.sessions that the token lives on. */
export function sessionIdOfToken(accessToken: string): string {
  const claims: unknown = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString());
  const id = typeof claims === "object" && claims !== null ? Reflect.get(claims, "session_id") : undefined;
  if (typeof id !== "string") throw new Error("El token de prueba no trae session_id.");
  return id;
}

/** The session id of a logged-in test client. */
export async function sessionIdOf(client: TestClient): Promise<string> {
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (token === undefined) throw new Error("El cliente de prueba no tiene sesión.");
  return sessionIdOfToken(token);
}
