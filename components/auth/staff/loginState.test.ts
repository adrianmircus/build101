import { describe, expect, it } from "vitest";
import { fail, ok } from "@/lib/errors";
import { EMAIL_FIELD, MISSING_EMAIL, MISSING_PASSWORD, PASSWORD_FIELD, missingFields, missingTitle, stateFromResult } from "./loginState";

const NOW = new Date("2026-11-12T12:00:00Z");

describe("missingFields", () => {
  it("marca cada campo que falta, con su mensaje al lado", () => {
    expect(missingFields("", "")).toEqual([
      { field: EMAIL_FIELD, message: MISSING_EMAIL, summary: "Escribí tu correo" },
      { field: PASSWORD_FIELD, message: MISSING_PASSWORD },
    ]);
    expect(missingFields("  ", "x")).toEqual([{ field: EMAIL_FIELD, message: MISSING_EMAIL, summary: "Escribí tu correo" }]);
    expect(missingFields("ana@colegio.edu.uy", "")).toEqual([{ field: PASSWORD_FIELD, message: MISSING_PASSWORD }]);
    expect(missingFields("ana@colegio.edu.uy", "x")).toEqual([]);
  });

  it("el título cuenta lo que falta", () => {
    expect(missingTitle(1)).toBe("Falta completar un dato");
    expect(missingTitle(2)).toBe("Falta completar 2 datos");
  });
});

describe("stateFromResult", () => {
  it("entra y va a donde dice el servidor", () => {
    expect(stateFromResult(ok({ next: "/grupos" }), 1)).toEqual({ kind: "go", next: "/grupos" });
  });

  it("un error de credenciales es siempre el mismo, no dice si falló el correo o la contraseña", () => {
    for (const code of ["NOT_FOUND", "FORBIDDEN"] as const) {
      expect(stateFromResult(fail(code, "x"), 2)).toEqual({ kind: "mismatch", attempt: 2 });
    }
  });

  it("demasiados intentos: bloqueado, con la hora local de retryAt", () => {
    const state = stateFromResult(fail("RATE_LIMITED", "x", { retryAt: "2026-11-12T13:42:00Z" }), 1, NOW);
    expect(state.kind).toBe("blocked");
    expect(state).toHaveProperty("when", expect.stringMatching(/^a las \d{2}:\d{2}$/));
  });

  it("bloqueado sin retryAt no inventa una hora", () => {
    expect(stateFromResult(fail("RATE_LIMITED", "x"), 1, NOW)).toEqual({ kind: "blocked", when: null });
  });

  it("un correo mal escrito se marca al lado del campo", () => {
    const state = stateFromResult(fail("INVALID", "x", { fields: { email: "El formato no es válido." } }), 3);
    expect(state).toMatchObject({ kind: "fields", problems: [{ field: EMAIL_FIELD }] });
  });

  it("con los servicios sin responder, muestra un error amable y no el texto interno", () => {
    const state = stateFromResult(fail("UNAVAILABLE", "Todavía no está disponible."), 1);
    expect(state).toMatchObject({ kind: "failed", stale: false });
    expect(JSON.stringify(state)).not.toContain("Todavía no está disponible");
  });

  it("una página vieja pide recargar", () => {
    expect(stateFromResult(fail("STALE_CLIENT", "x"), 1)).toMatchObject({ kind: "failed", stale: true });
  });
});
