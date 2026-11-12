// Pruebas sin IA de las reglas de áreas y del acceso a las APIs (proxy.ts).
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { SESSION_COOKIE, sign, type Session } from "@/lib/auth/signing";
import type { SessionKind } from "@/lib/server/auth/session-proxy";

// Lo que dice la sesión de Supabase se simula acá: sus claims se prueban en session-proxy.test.ts.
const supabase = vi.hoisted(() => ({ kind: null as SessionKind | null }));
vi.mock("@/lib/server/auth/session-proxy", async (original) => ({
  ...(await original<typeof import("@/lib/server/auth/session-proxy")>()),
  refreshSession: async () => ({ refresh: null, kind: supabase.kind }),
}));

import { config, proxy } from "@/proxy";

beforeEach(() => {
  supabase.kind = null;
});

type Outcome = { status: number | null; location: string | null };

// Qué hizo el proxy: status null si deja pasar el pedido; si no, el status y adónde manda.
async function outcome(path: string, session?: Session | string): Promise<Outcome> {
  const value = typeof session === "string" ? session : session && sign(session);
  const headers = value ? { cookie: `${SESSION_COOKIE}=${value}` } : undefined;
  const res = await proxy(new NextRequest(`http://localhost${path}`, { method: "POST", headers }));
  // NextResponse.next() deja pasar con el encabezado x-middleware-next; solo una respuesta propia corta el pedido.
  if (res.headers.get("x-middleware-next") === "1") return { status: null, location: null };
  const location = res.headers.get("location");
  return { status: res.status, location: location && new URL(location).pathname };
}
const status = async (path: string, session?: Session | string) => (await outcome(path, session)).status;

const demoProfe: Session = { id: "teacher", role: "teacher", demo: true };
const demoPaula: Session = { id: "demo-s2", role: "student", demo: true };
// Una cookie firmada sin la marca de la demo: ya no la crea nadie y no abre nada.
const sinMarca: Session = { id: "teacher", role: "teacher" };

it("proxy: alcanza las APIs, las páginas con token y deja afuera lo estático", () => {
  // El matcher de Next es path-to-regexp; el grupo "/(...)" de esta forma se lee igual como expresión regular.
  const matcher = new RegExp("^" + config.matcher[0] + "$");
  for (const path of ["/api/generate", "/invitacion", "/t", "/ingresar/profesor/nueva", "/grupos"]) expect(matcher.test(path)).toEqual(true);
  for (const path of ["/_next/static/a.js", "/api/jobs/run", "/favicon.ico"]) expect(matcher.test(path)).toEqual(false);
});
it("proxy: las páginas con token salen sin caché y sin Referer", async () => {
  const res = await proxy(new NextRequest("http://localhost/invitacion"));
  expect(res.headers.get("cache-control")).toEqual("no-store");
  expect(res.headers.get("referrer-policy")).toEqual("no-referrer");
  const other = await proxy(new NextRequest("http://localhost/tarjetas"));
  expect(other.headers.get("cache-control")).toEqual(null);
});

it("/grupos y /materia: staff con sesión pasa; sin sesión y estudiante van al login del profe", async () => {
  supabase.kind = "staff";
  for (const path of ["/grupos", "/grupos/a/evaluaciones/b", "/materia"]) expect(await status(path)).toEqual(null);
  supabase.kind = null;
  expect(await outcome("/grupos")).toEqual({ status: 307, location: "/ingresar/profesor" });
  supabase.kind = "student";
  expect(await outcome("/materia/x")).toEqual({ status: 307, location: "/ingresar/profesor" });
});
it("/estudiante: estudiante con sesión pasa; sin sesión y staff van al login del estudiante", async () => {
  supabase.kind = "student";
  expect(await status("/estudiante")).toEqual(null);
  supabase.kind = null;
  expect(await outcome("/estudiante")).toEqual({ status: 307, location: "/ingresar/estudiante" });
  supabase.kind = "staff";
  expect(await outcome("/estudiante/abc")).toEqual({ status: 307, location: "/ingresar/estudiante" });
});
it("/institucion: solo staff con sesión; la demo no entra", async () => {
  supabase.kind = "staff";
  expect(await status("/institucion/abc")).toEqual(null);
  supabase.kind = null;
  expect(await outcome("/institucion/abc")).toEqual({ status: 307, location: "/ingresar/profesor" });
  expect(await outcome("/institucion/abc", demoProfe)).toEqual({ status: 307, location: "/ingresar/profesor" });
  supabase.kind = "student";
  expect(await outcome("/institucion/abc")).toEqual({ status: 307, location: "/ingresar/profesor" });
});
it("la demo abre solo su lado: el profe de la demo, /grupos; Paula, /estudiante", async () => {
  expect(await status("/grupos", demoProfe)).toEqual(null);
  expect(await status("/materia", demoProfe)).toEqual(null);
  expect(await status("/estudiante", demoPaula)).toEqual(null);
  expect((await outcome("/estudiante", demoProfe)).location).toEqual("/ingresar/estudiante");
  expect((await outcome("/grupos", demoPaula)).location).toEqual("/ingresar/profesor");
});
it("una cookie firmada sin la marca de la demo no abre nada", async () => {
  expect((await outcome("/grupos", sinMarca)).location).toEqual("/ingresar/profesor");
  expect(await status("/api/generate", sinMarca)).toEqual(401);
  expect(await status("/api/tts", sinMarca)).toEqual(401);
});
it("una cookie adulterada no sirve", async () => {
  const adulterada = `${sign(demoProfe).split(".")[0]}.${sign(demoPaula).split(".")[1]}`;
  expect((await outcome("/grupos", adulterada)).location).toEqual("/ingresar/profesor");
  expect(await status("/api/tts", adulterada)).toEqual(401);
});
it("los logins con sesión del mismo tipo mandan al inicio; /nueva nunca redirige", async () => {
  supabase.kind = "staff";
  expect(await outcome("/ingresar/profesor")).toEqual({ status: 307, location: "/grupos" });
  expect(await outcome("/ingresar/profesor/olvide")).toEqual({ status: 307, location: "/grupos" });
  expect(await status("/ingresar/profesor/nueva")).toEqual(null);
  expect(await status("/invitacion")).toEqual(null);
  // El login del otro tipo se muestra.
  expect(await status("/ingresar/estudiante")).toEqual(null);
  supabase.kind = "student";
  for (const path of ["/ingresar/estudiante", "/ingresar/estudiante/escanear", "/t"]) {
    expect(await outcome(path)).toEqual({ status: 307, location: "/estudiante" });
  }
  expect(await status("/ingresar/profesor")).toEqual(null);
});
it("los logins sin sesión, y con la demo, se muestran", async () => {
  for (const path of ["/ingresar/profesor", "/ingresar/estudiante", "/ingresar/profesor/nueva", "/t"]) {
    expect(await status(path)).toEqual(null);
    expect(await status(path, demoProfe)).toEqual(null);
  }
});
it("una sesión real borra las cookies que dejó una demo", async () => {
  supabase.kind = "staff";
  const res = await proxy(new NextRequest("http://localhost/grupos", { headers: { cookie: `${SESSION_COOKIE}=${sign(demoProfe)}; tiza-demo=1` } }));
  const cleared = res.headers.getSetCookie().join(";");
  expect(cleared).toMatch(/session=;/);
  expect(cleared).toMatch(/tiza-demo=;/);
});

it("generar: sin sesión, 401", async () => {
  expect(await status("/api/generate")).toEqual(401);
});
it("generar: con sesión de estudiante, 401", async () => {
  supabase.kind = "student";
  expect(await status("/api/generate")).toEqual(401);
});
it("generar: con sesión de staff, pasa", async () => {
  supabase.kind = "staff";
  expect(await status("/api/generate")).toEqual(null);
});
it("generar: la demo no usa la IA en vivo, 403", async () => {
  expect(await status("/api/generate", demoProfe)).toEqual(403);
  expect(await status("/api/answers/transcribe", demoPaula)).toEqual(403);
});
it("leer en voz alta: sirve una sesión real, o la demo (la ruta decide qué voz); sin sesión, 401", async () => {
  supabase.kind = "student";
  expect(await status("/api/tts")).toEqual(null);
  supabase.kind = "staff";
  expect(await status("/api/tts")).toEqual(null);
  supabase.kind = null;
  expect(await status("/api/tts", demoPaula)).toEqual(null);
  expect(await status("/api/tts", demoProfe)).toEqual(null);
  expect(await status("/api/tts")).toEqual(401);
});
it("dictado y comandos de voz: son del staff hasta que lleguen los estudiantes con datos (fase 4)", async () => {
  supabase.kind = "student";
  expect(await status("/api/answers/transcribe")).toEqual(401);
  supabase.kind = "staff";
  expect(await status("/api/voice/command")).toEqual(null);
});
