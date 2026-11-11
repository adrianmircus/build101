import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createAdminClient } from "@/lib/server/db/admin";
import { readAdminDbEnv } from "@/lib/server/db/env";
import type { Database } from "@/lib/server/db/types";

const env = readAdminDbEnv();

function createAnonClient() {
  // Publishable key and no session: what any visitor of the site can build. Untyped on purpose:
  // the probes use names that are not in the generated types.
  return createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function fetchOpenApiPaths(key: string): Promise<string[]> {
  const response = await fetch(`${env.url}/rest/v1/`, { headers: { apikey: key } });
  const body: unknown = await response.json();
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

describe("what anon can reach in schema public", () => {
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

  it("cannot call any function the schema has", async () => {
    // The functions come from the admin's view of the API, which sees all of them.
    const rpcPaths = (await fetchOpenApiPaths(env.secretKey)).filter((path) => path.startsWith("/rpc/"));
    const anon = createAnonClient();
    for (const path of rpcPaths) {
      const { error } = await anon.rpc(path.slice("/rpc/".length));
      expect(error, `anon could call ${path}`).not.toBeNull();
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
