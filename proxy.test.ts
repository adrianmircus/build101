// Pruebas sin IA del acceso a las APIs (proxy.ts).
import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";
import { SESSION_COOKIE, sign, type Session } from "@/lib/auth/signing";

// Status de la respuesta del proxy; null si deja pasar el pedido.
async function status(path: string, session?: Session | string): Promise<number | null> {
  const value = typeof session === "string" ? session : session && sign(session);
  const headers = value ? { cookie: `${SESSION_COOKIE}=${value}` } : undefined;
  const res = await proxy(new NextRequest(`http://localhost${path}`, { method: "POST", headers }));
  // NextResponse.next() deja pasar con el encabezado x-middleware-next; solo una respuesta propia corta el pedido.
  return res.headers.get("x-middleware-next") === "1" ? null : res.status;
}

const profe: Session = { id: "teacher", role: "teacher" };
const ana: Session = { id: "6a-s1", role: "student" };

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
it("generar: sin sesión, 401", async () => {
  expect(await status("/api/generate")).toEqual(401);
});
it("generar: con sesión de estudiante, 401", async () => {
  expect(await status("/api/generate", ana)).toEqual(401);
});
it("generar: con sesión de profe, pasa", async () => {
  expect(await status("/api/generate", profe)).toEqual(null);
});
// Cookie adulterada: los datos dicen profe, pero la firma es la de una estudiante.
const adulterada = `${sign(profe).split(".")[0]}.${sign(ana).split(".")[1]}`;
it("generar: una cookie adulterada no sirve", async () => {
  expect(await status("/api/generate", adulterada)).toEqual(401);
});
it("dictado: el estudiante sigue pudiendo usarlo", async () => {
  expect(await status("/api/answers/transcribe", ana)).toEqual(null);
});
it("dictado: sin sesión, 401", async () => {
  expect(await status("/api/answers/transcribe")).toEqual(401);
});
it("páginas del profe: siguen redirigiendo", async () => {
  expect(await status("/grupos")).toEqual(307);
});
