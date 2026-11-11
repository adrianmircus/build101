// Pruebas sin IA del acceso a las APIs (proxy.ts).
import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";
import { SESSION_COOKIE, sign, type Session } from "@/lib/auth/signing";

// Status de la respuesta del proxy; null si deja pasar el pedido.
function status(path: string, session?: Session | string): number | null {
  const value = typeof session === "string" ? session : session && sign(session);
  const headers = value ? { cookie: `${SESSION_COOKIE}=${value}` } : undefined;
  const res = proxy(new NextRequest(`http://localhost${path}`, { method: "POST", headers }));
  return res ? res.status : null;
}

const profe: Session = { id: "teacher", role: "teacher" };
const ana: Session = { id: "6a-s1", role: "student" };

it("proxy: cubre todas las APIs", () => {
  expect(config.matcher.includes("/api/:path*")).toEqual(true);
});
it("generar: sin sesión, 401", () => {
  expect(status("/api/generate")).toEqual(401);
});
it("generar: con sesión de estudiante, 401", () => {
  expect(status("/api/generate", ana)).toEqual(401);
});
it("generar: con sesión de profe, pasa", () => {
  expect(status("/api/generate", profe)).toEqual(null);
});
// Cookie adulterada: los datos dicen profe, pero la firma es la de una estudiante.
const adulterada = `${sign(profe).split(".")[0]}.${sign(ana).split(".")[1]}`;
it("generar: una cookie adulterada no sirve", () => {
  expect(status("/api/generate", adulterada)).toEqual(401);
});
it("dictado: el estudiante sigue pudiendo usarlo", () => {
  expect(status("/api/answers/transcribe", ana)).toEqual(null);
});
it("dictado: sin sesión, 401", () => {
  expect(status("/api/answers/transcribe")).toEqual(401);
});
it("páginas del profe: siguen redirigiendo", () => {
  expect(status("/grupos")).toEqual(307);
});
