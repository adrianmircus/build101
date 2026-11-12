import { describe, expect, it } from "vitest";
import { fail } from "@/lib/errors";
import { viewOfFailure } from "./failure-view";

describe("viewOfFailure", () => {
  it("una pausa por intentos lleva la hora que dio el servidor", () => {
    const view = viewOfFailure(fail("RATE_LIMITED", "Esperá.", { retryAt: "2026-11-12T15:40:00.000Z" }));
    expect(view).toEqual({ kind: "pause", retryAt: "2026-11-12T15:40:00.000Z" });
  });

  it("cuando el servicio no está disponible o falla, el mensaje es el genérico y no culpa al estudiante", () => {
    for (const code of ["UNAVAILABLE", "INTERNAL"] as const) {
      expect(viewOfFailure(fail(code, "x"))).toEqual({ kind: "notice", notice: { kind: "unavailable" } });
    }
  });

  it("una pestaña vieja pide recargar", () => {
    expect(viewOfFailure(fail("STALE_CLIENT", "x"))).toEqual({ kind: "notice", notice: { kind: "stale" } });
  });

  it("cualquier otro rechazo se dice igual: no coinciden, sin decir cuál dato", () => {
    for (const code of ["NOT_FOUND", "FORBIDDEN", "INVALID", "CONFLICT"] as const) {
      expect(viewOfFailure(fail(code, "x"))).toEqual({ kind: "notice", notice: { kind: "wrong" } });
    }
  });
});
