import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { RPC_NAMES } from "@/lib/domain/rpc";
import { createAdminClient } from "@/lib/server/db/admin";
import { readAdminDbEnv } from "@/lib/server/db/env";
import type { Database } from "@/lib/server/db/types";

const env = readAdminDbEnv();

function createAnonClient() {
  // Publishable key and no session: what any visitor of the site can build. Untyped on purpose:
  // the probes use names that are not in the generated types.
  return createClient(env.url, env.publishableKey, {
    db: { schema: "api" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchOpenApi(key: string, profile?: string): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { apikey: key };
  if (profile !== undefined) headers["Accept-Profile"] = profile;
  const response = await fetch(`${env.url}/rest/v1/`, { headers });
  return { status: response.status, body: await response.json() };
}

async function fetchOpenApiPaths(key: string): Promise<string[]> {
  const { body } = await fetchOpenApi(key);
  if (typeof body !== "object" || body === null || !("paths" in body)) return [];
  const paths = body.paths;
  return typeof paths === "object" && paths !== null ? Object.keys(paths) : [];
}

describe("database connection", () => {
  it("responds to the admin client", async () => {
    const { data, error } = await createAdminClient().auth.admin.listUsers({ page: 1, perPage: 1 });
    expect(error).toBeNull();
    expect(data.users).toBeInstanceOf(Array);
  });

  it("rejects a secret key that is wrong", async () => {
    const bad = createClient<Database>(env.url, "sb_secret_not-a-real-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await bad.auth.admin.listUsers({ page: 1, perPage: 1 });
    expect(error).not.toBeNull();
  });
});

describe("exposed schemas", () => {
  // The same check runs against staging and production (T10.1): the hosted "Exposed schemas"
  // setting must list api alone, like supabase/config.toml.
  it("are only api", async () => {
    for (const profile of ["public", "app", "graphql_public"]) {
      const { status, body } = await fetchOpenApi(env.secretKey, profile);
      expect(status, profile).toBe(406);
      expect(body, profile).toMatchObject({ code: "PGRST106" });
    }
    expect((await fetchOpenApi(env.secretKey, "api")).status).toBe(200);
  });
});

describe("what anon can reach in schema api", () => {
  it("sees no table and no function: its API schema is empty", async () => {
    // PostgREST only exposes what the role can use. If a migration grants anon anything
    // (a table, a view, an RPC), a path shows up here and this test fails.
    const anonPaths = await fetchOpenApiPaths(env.publishableKey);
    expect(anonPaths).toEqual(["/"]);
  });

  it("cannot read a table, existing or not", async () => {
    const { data, error } = await createAnonClient().from("does_not_exist").select("*");
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("cannot call any RPC of the contract", async () => {
    // The names come from the domain registry, which the typecheck ties to the database.
    const anon = createAnonClient();
    for (const name of RPC_NAMES) {
      const { error } = await anon.rpc(name);
      expect(error, `anon could call ${name}`).not.toBeNull();
    }
  });
});

describe("public sign-up", () => {
  it("is off: nobody creates an account by themselves", async () => {
    const { data, error } = await createAnonClient().auth.signUp({
      email: "nobody@example.com",
      password: "a-long-enough-password",
    });
    expect(data.session).toBeNull();
    expect(error?.code).toBe("signup_disabled");
  });
});
