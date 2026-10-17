// Pruebas sin IA del acceso a las APIs (proxy.ts). Correr con: npx tsx scripts/adapter/test-acceso.ts
import { NextRequest } from "next/server";
import { config, proxy } from "../../proxy";
import { SESSION_COOKIE, sign, type Session } from "../../lib/auth/signing";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FALLA"} ${name}${pass ? "" : `\n      esperado ${JSON.stringify(want)}\n      obtenido ${JSON.stringify(got)}`}`);
}

// Status de la respuesta del proxy; null si deja pasar el pedido.
function status(path: string, session?: Session | string): number | null {
  const value = typeof session === "string" ? session : session && sign(session);
  const headers = value ? { cookie: `${SESSION_COOKIE}=${value}` } : undefined;
  const res = proxy(new NextRequest(`http://localhost${path}`, { method: "POST", headers }));
  return res ? res.status : null;
}

const profe: Session = { id: "teacher", role: "teacher" };
const ana: Session = { id: "6a-s1", role: "student" };

check("proxy: cubre todas las APIs", config.matcher.includes("/api/:path*"), true);
check("adaptar: sin sesión, 401", status("/api/adapt"), 401);
check("adaptar: con sesión de estudiante, 401", status("/api/adapt", ana), 401);
check("adaptar: con sesión de profe, pasa", status("/api/adapt", profe), null);
// Cookie adulterada: los datos dicen profe, pero la firma es la de una estudiante.
const adulterada = `${sign(profe).split(".")[0]}.${sign(ana).split(".")[1]}`;
check("adaptar: una cookie adulterada no sirve", status("/api/adapt", adulterada), 401);
check("dictado: el estudiante sigue pudiendo usarlo", status("/api/answers/transcribe", ana), null);
check("dictado: sin sesión, 401", status("/api/answers/transcribe"), 401);
check("páginas del profe: siguen redirigiendo", status("/grupos"), 307);

console.log(failed === 0 ? "\nTodo pasa." : `\n${failed} pruebas fallan.`);
process.exit(failed === 0 ? 0 : 1);
