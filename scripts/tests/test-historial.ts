// Pruebas sin IA del historial de cada versión (lo que generó la IA, las ediciones, aprobaciones y rechazos).
// Correr con: npx tsx scripts/tests/test-historial.ts
import { isRejectReason, REJECT_REASONS } from "../../lib/feedback/reasons";
import { pendingRetry, withEvent } from "../../lib/groups/history";
import type { Version, VersionEvent } from "../../lib/groups/types";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FALLA"} ${name}${pass ? "" : `\n      esperado ${JSON.stringify(want)}\n      obtenido ${JSON.stringify(got)}`}`);
}

const generated: VersionEvent = { type: "generated", at: "2026-11-02T10:00:00Z", content: "1) Resolvé $x+1=2$", changes: [] };
const edited: VersionEvent = { type: "edited", at: "2026-11-02T10:05:00Z", content: "1) Resolvé:\n$$x+1=2$$" };
const rejected: VersionEvent = { type: "rejected", at: "2026-11-02T10:06:00Z", reasons: ["too_long"] };
const version = (history: VersionEvent[] | undefined, content?: string): Version => ({
  profiles: ["adhd"],
  studentIds: ["s1"],
  status: "ready",
  approved: false,
  content,
  history,
});

// withEvent: agrega al final y no toca lo anterior.
const before = version([generated]);
check("historial: agrega al final", withEvent(before, edited), [generated, edited]);
check("historial: no cambia el historial original", before.history, [generated]);
check("historial: datos viejos sin historial", withEvent(version(undefined), generated), [generated]);

// pendingRetry: solo si lo último fue un rechazo, con el texto que se rechazó.
check("reintento: sin historial no hay", pendingRetry(version(undefined, "x")), undefined);
check("reintento: después de generar no hay", pendingRetry(version([generated], "1) Resolvé $x+1=2$")), undefined);
check(
  "reintento: rechazada sin editar manda lo generado",
  pendingRetry(version([generated, rejected], "1) Resolvé $x+1=2$")),
  { reasons: ["too_long"], previous: "1) Resolvé $x+1=2$" },
);
check(
  "reintento: rechazada después de editar manda lo editado",
  pendingRetry(version([generated, edited, rejected], "1) Resolvé:\n$$x+1=2$$")),
  { reasons: ["too_long"], previous: "1) Resolvé:\n$$x+1=2$$" },
);
check("reintento: ya regenerada no repite el rechazo", pendingRetry(version([generated, rejected, generated], "y")), undefined);

// Motivos: lista cerrada, sin texto libre.
check("motivos: los de la lista valen", REJECT_REASONS.every((r) => isRejectReason(r.id)), true);
check("motivos: un texto cualquiera no vale", isRejectReason("se lo hice a Juan"), false);
check("motivos: sin repetidos", new Set(REJECT_REASONS.map((r) => r.id)).size, REJECT_REASONS.length);

console.log(failed === 0 ? "\nTodo pasa." : `\n${failed} pruebas fallan.`);
process.exit(failed === 0 ? 0 : 1);
