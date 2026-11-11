// Pruebas sin IA del historial de cada versión (lo que generó la IA, las ediciones, aprobaciones y rechazos).
import { expect, it } from "vitest";
import { isRejectReason, REJECT_REASONS } from "@/lib/feedback/reasons";
import { pendingRetry, withEvent } from "@/lib/groups/history";
import type { Version, VersionEvent } from "@/lib/groups/types";

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
it("historial: agrega al final", () => {
  expect(withEvent(before, edited)).toEqual([generated, edited]);
});
it("historial: no cambia el historial original", () => {
  expect(before.history).toEqual([generated]);
});
it("historial: datos viejos sin historial", () => {
  expect(withEvent(version(undefined), generated)).toEqual([generated]);
});

// pendingRetry: solo si lo último fue un rechazo, con el texto que se rechazó.
it("reintento: sin historial no hay", () => {
  expect(pendingRetry(version(undefined, "x"))).toEqual(undefined);
});
it("reintento: después de generar no hay", () => {
  expect(pendingRetry(version([generated], "1) Resolvé $x+1=2$"))).toEqual(undefined);
});
it("reintento: rechazada sin editar manda lo generado", () => {
  expect(pendingRetry(version([generated, rejected], "1) Resolvé $x+1=2$"))).toEqual({ reasons: ["too_long"], previous: "1) Resolvé $x+1=2$" });
});
it("reintento: rechazada después de editar manda lo editado", () => {
  expect(pendingRetry(version([generated, edited, rejected], "1) Resolvé:\n$$x+1=2$$"))).toEqual({ reasons: ["too_long"], previous: "1) Resolvé:\n$$x+1=2$$" });
});
it("reintento: ya regenerada no repite el rechazo", () => {
  expect(pendingRetry(version([generated, rejected, generated], "y"))).toEqual(undefined);
});

// Motivos: lista cerrada, sin texto libre.
it("motivos: los de la lista valen", () => {
  expect(REJECT_REASONS.every((r) => isRejectReason(r.id))).toEqual(true);
});
it("motivos: un texto cualquiera no vale", () => {
  expect(isRejectReason("se lo hice a Juan")).toEqual(false);
});
it("motivos: sin repetidos", () => {
  expect(new Set(REJECT_REASONS.map((r) => r.id)).size).toEqual(REJECT_REASONS.length);
});
