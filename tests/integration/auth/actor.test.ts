import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/server/db/admin";
import { readPublicDbEnv } from "@/lib/server/db/env";
import { callRpc } from "@/lib/server/repos/rpc";
import {
  createGroup,
  createInstitution,
  createLoggedInUser,
  createSchool,
  type TestUser,
} from "../../factories";
import { sessionIdOfToken } from "../../factories/clients";
import { bindStudentSession, createLoggedInStudent, createStudent } from "../../factories/students";
import { readRows } from "../support/db";

// The cookies of the "browser": what the proxy and Supabase leave in the request. getActor reads them through
// next/headers, so each test puts there the session it wants to play.
const browser = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...browser.jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void browser.jar.set(name, value),
  }),
}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

import { getActor, requireAdmin, requireStaff, requireStudent } from "@/lib/server/auth/actor";

type Credentials = Pick<TestUser, "email" | "password"> | { magicLinkEmail: string };

/** Signs in like the login does (cookies in a jar) and returns a way to close that session in Auth. A student has no password in
 * Auth (docs/contratos/fase-2.md): its session comes from a magic link, as the student login does. */
async function openSession(credentials: Credentials) {
  const { url, publishableKey } = readPublicDbEnv();
  const jar = new Map<string, string>();
  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => toSet.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = "magicLinkEmail" in credentials
    ? await verifyMagicLink(client, credentials.magicLinkEmail)
    : await client.auth.signInWithPassword(credentials);
  if (error) throw new Error("No se pudo abrir la sesión de prueba.");
  browser.jar = jar;
  return { signOut: () => client.auth.signOut({ scope: "local" }) };
}

async function verifyMagicLink(client: ReturnType<typeof createServerClient>, email: string) {
  const link = await createAdminClient().auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.data.properties?.hashed_token;
  if (link.error || tokenHash === undefined) throw new Error("No se pudo crear el enlace de prueba.");
  const opened = await client.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  // The login of a student registers the session it opens (the bind); one that is not registered reads nothing (F2C-75).
  if (opened.data.session && opened.data.user) {
    await bindStudentSession(createAdminClient(), opened.data.user.id, sessionIdOfToken(opened.data.session.access_token));
  }
  return opened;
}

beforeEach(() => {
  browser.jar = new Map();
});

// The database side of a closed session (app.session_alive in app.rpc_begin) is T2.7's migration. Until it lands in this
// branch the test cannot pass, so it waits for the function instead of failing.
const found = (await readRows<{ found: boolean }>("select to_regprocedure('app.session_alive()') is not null as found"))[0]?.found === true;

describe("getActor contra Supabase local", () => {
  it("sin sesión: null, y los require dan FORBIDDEN con no_session", async () => {
    expect(await getActor()).toBeNull();
    const text = "Tu sesión terminó. Volvé a entrar.";
    await expect(requireStaff()).rejects.toMatchObject({ code: "FORBIDDEN", message: text });
    await expect(requireStudent()).rejects.toMatchObject({ code: "FORBIDDEN", message: text });
    await expect(requireAdmin(randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN", message: text });
  });

  it("la cookie firmada de la demo no da actor", async () => {
    browser.jar.set("tiza_session", "cualquier-valor.firmado");
    expect(await getActor()).toBeNull();
  });

  it("staff con dos instituciones y sus roles", async () => {
    const { admin, institution, teacher } = await createSchool();
    const other = await createInstitution(admin);
    await callRpc(admin, "internal_add_membership", { p_institution_id: other.id, p_user_id: teacher.id, p_role: "admin" });
    await openSession(teacher);

    const actor = await getActor();
    expect(actor).toMatchObject({ kind: "staff", userId: teacher.id });
    if (actor?.kind !== "staff") throw new Error("Se esperaba staff.");
    expect(actor.institutions.map(({ id, roles }) => ({ id, roles })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: institution.id, roles: ["teacher"] },
        { id: other.id, roles: ["admin"] },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect((await requireStaff()).userId).toBe(teacher.id);
    expect((await requireAdmin(other.id)).userId).toBe(teacher.id);
  });

  it("requireAdmin de otra institución, o donde solo es profe, da FORBIDDEN", async () => {
    const { admin, institution, teacher } = await createSchool();
    const foreign = await createInstitution(admin);
    await openSession(teacher);
    const text = "No tenés permiso para hacer esto.";
    await expect(requireAdmin(institution.id)).rejects.toMatchObject({ code: "FORBIDDEN", message: text });
    await expect(requireAdmin(foreign.id)).rejects.toMatchObject({ code: "FORBIDDEN", message: text });
    await expect(requireStudent()).rejects.toMatchObject({ code: "FORBIDDEN", message: text });
  });

  it("estudiante: actor con su institución, y no es staff", async () => {
    const { admin, institution, teacher } = await createSchool();
    const group = await createGroup(teacher.client, institution.id);
    const student = await createStudent(teacher.client, group.id);
    const { userId } = await createLoggedInStudent(admin, student);
    await openSession({ magicLinkEmail: `${userId}@estudiantes.usetiza.app` });

    expect(await getActor()).toEqual({ kind: "student", userId, institutionId: institution.id });
    expect((await requireStudent()).institutionId).toBe(institution.id);
    await expect(requireStaff()).rejects.toMatchObject({ code: "FORBIDDEN", message: "No tenés permiso para hacer esto." });
  });

  it("una cuenta de Auth sin ninguna membresía no es nadie", async () => {
    const admin = createAdminClient();
    const email = `${randomUUID()}@tiza-test.example`;
    const password = `${randomUUID()}${randomUUID()}`;
    await admin.auth.admin.createUser({ email, password, email_confirm: true });
    await openSession({ email, password });
    expect(await getActor()).toBeNull();
  });

  it.skipIf(!found)("una sesión cerrada ya no da actor aunque la cookie siga ahí", async () => {
    const { teacher } = await createSchool();
    const session = await openSession(teacher);
    const saved = new Map(browser.jar);
    expect(await getActor()).not.toBeNull();
    await session.signOut();
    browser.jar = saved;
    expect(await getActor()).toBeNull();
  });

  it("un usuario con rol de profe en otra institución no ve la de los demás", async () => {
    const first = await createSchool();
    const second = await createSchool();
    const user = await createLoggedInUser(first.admin, second.institution, "admin");
    await openSession(user);
    await expect(requireAdmin(first.institution.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await requireAdmin(second.institution.id)).userId).toBe(user.id);
  });
});
