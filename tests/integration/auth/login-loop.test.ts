import { createHash, randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/server/db/admin";
import { readPublicDbEnv } from "@/lib/server/db/env";
import { callRpc } from "@/lib/server/repos/rpc";
import { createGroup, createSchool } from "../../factories";
import { sessionIdOfToken } from "../../factories/clients";
import { bindStudentSession, createLoggedInStudent, createStudent } from "../../factories/students";

// F2-5: a new card closes the session of the student in the database, but his browser keeps a token that is still signed. The
// area (/estudiante) sends him to the login because the database refuses the session; the login must not send him back
// because of the claims. Here the code of the pages runs over a real session: requireStudent (the check behind requireViewer, which sends to the login when it fails) and loginGate (the login).

const browser = vi.hoisted(() => ({ jar: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...browser.jar].map(([name, value]) => ({ name, value })),
    get: (name: string) => (browser.jar.has(name) ? { name, value: browser.jar.get(name) } : undefined),
    set: (name: string, value: string) => (value === "" ? browser.jar.delete(name) : void browser.jar.set(name, value)),
  }),
}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
// connection() only works inside a request: here it is a no-op.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => undefined }));
// The cookie of the demo: there is none here, and reading it needs a request scope.
vi.mock("@/lib/auth/session", () => ({ readSession: async () => null }));
// redirect() throws in Next; the message says where, so the test sees every hop.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { getActor, requireStudent } from "@/lib/server/auth/actor";
import { cleanStaleSession, loginAfterClean, loginGate } from "@/lib/server/auth/login-gate";
import { getClaims } from "@/lib/server/repos/auth-session";

const PLACEHOLDER_HASH = `scrypt$15$8$1$${Buffer.alloc(16, 3).toString("base64")}$${Buffer.alloc(64, 4).toString("base64")}`;

beforeEach(() => {
  browser.jar = new Map();
});

async function openStudentSession(userId: string): Promise<void> {
  const { url, publishableKey } = readPublicDbEnv();
  const jar = new Map<string, string>();
  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => toSet.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const admin = createAdminClient();
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: `${userId}@estudiantes.usetiza.app` });
  const tokenHash = link.data.properties?.hashed_token;
  if (link.error || tokenHash === undefined) throw new Error("No se pudo crear el enlace de prueba.");
  const opened = await client.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (!opened.data.session || !opened.data.user) throw new Error("No se pudo abrir la sesión de prueba.");
  await bindStudentSession(admin, opened.data.user.id, sessionIdOfToken(opened.data.session.access_token));
  browser.jar = jar;
}

const hop = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
    return "RENDER";
  } catch (thrown) {
    return thrown instanceof Error ? thrown.message : "ERROR";
  }
};

describe("un estudiante con la sesión cerrada por una tarjeta nueva no entra en un bucle", () => {
  it("el área y el login no se rebotan: el login limpia la sesión y se muestra", async () => {
    const { admin, institution, teacher } = await createSchool();
    const group = await createGroup(teacher.client, institution.id);
    const student = await createStudent(teacher.client, group.id);
    const { userId } = await createLoggedInStudent(admin, student);
    await openStudentSession(userId);

    // With the session alive, the area opens and the login sends the student home.
    expect(await hop(() => requireStudent())).toBe("RENDER");
    expect(await hop(() => loginGate("student"))).toBe("REDIRECT /estudiante");

    // The teacher prints a new card: the database closes the session, the browser keeps its cookies and its signed token.
    await callRpc(teacher.client, "issue_access_cards", {
      p_group_id: group.id,
      p_cards: [{ studentId: student.id, tokenHash: createHash("sha256").update(randomUUID()).digest("hex"), passwordHash: PLACEHOLDER_HASH }],
      p_op_key: randomUUID(),
    });
    expect(await getClaims()).not.toBeNull();
    expect(await getActor()).toBeNull();

    // The area refuses (requireViewer then redirects to /ingresar/estudiante), and the login does not send him back: it goes to clean the session, and the clean-up lands on
    // the login with the flag, which shows the form.
    expect(await hop(() => requireStudent())).toBe("Tu sesión terminó. Volvé a entrar.");
    expect(await hop(() => loginGate("student"))).toBe("REDIRECT /ingresar/sesion?a=student");
    expect(loginAfterClean("student")).toBe("/ingresar/estudiante?limpia=1");
    // Even if the clean-up could not remove the cookies, the page after it shows the login and never redirects again.
    expect(await hop(() => loginGate("student", { cleaned: true }))).toBe("RENDER");
    // The card's own page (/t) cannot take the trip: it shows.
    expect(await hop(() => loginGate("student", { canClean: false }))).toBe("RENDER");

    await cleanStaleSession();
    expect(await getClaims()).toBeNull();
    expect(await hop(() => loginGate("student"))).toBe("RENDER");
    expect(await hop(() => requireStudent())).toBe("Tu sesión terminó. Volvé a entrar.");
  });

  it("cleanStaleSession no toca una sesión viva", async () => {
    const { admin, institution, teacher } = await createSchool();
    const group = await createGroup(teacher.client, institution.id);
    const student = await createStudent(teacher.client, group.id);
    const { userId } = await createLoggedInStudent(admin, student);
    await openStudentSession(userId);
    await cleanStaleSession();
    expect(await getActor()).not.toBeNull();
  });
});
