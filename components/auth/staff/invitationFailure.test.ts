import { describe, expect, it } from "vitest";
import { fail } from "@/lib/errors";
import { NAME_FIELD, PASSWORD_FIELD, inviteOutcome } from "./invitationFailure";

const NOW = new Date("2026-11-12T12:00:00Z");

describe("inviteOutcome", () => {
  it("demasiados intentos dicen cuándo volver", () => {
    const outcome = inviteOutcome(fail("RATE_LIMITED", "x", { retryAt: "2026-11-12T13:42:00Z" }), "signin", NOW);
    expect(outcome).toMatchObject({ kind: "notice", text: expect.stringMatching(/a las \d{2}:\d{2}/) });
  });

  it("los datos rechazados se marcan al lado de su campo", () => {
    const failure = fail("INVALID", "x", { fields: { displayName: "Escribí tu nombre.", password: "Muy corta." } });
    expect(inviteOutcome(failure, "new")).toEqual({
      kind: "problems",
      problems: [
        { field: NAME_FIELD, message: "Escribí tu nombre." },
        { field: PASSWORD_FIELD, message: "Muy corta." },
      ],
    });
  });

  it("si otro pedido creó la cuenta primero, pasa a «ya tenés cuenta»", () => {
    expect(inviteOutcome(fail("CONFLICT", "x"), "new")).toEqual({ kind: "have-account" });
    expect(inviteOutcome(fail("CONFLICT", "x"), "accept")).toEqual({ kind: "reload" });
  });

  it("una contraseña que no es la de la cuenta lo dice, y un rechazo al aceptar vuelve a leer", () => {
    expect(inviteOutcome(fail("FORBIDDEN", "x"), "signin")).toEqual({ kind: "wrong-password" });
    expect(inviteOutcome(fail("FORBIDDEN", "x"), "accept")).toEqual({ kind: "reload" });
  });

  it("una invitación que ya no existe deja de mostrarse", () => {
    expect(inviteOutcome(fail("NOT_FOUND", "x"), "accept")).toEqual({ kind: "gone" });
  });

  it("con los servicios sin responder, un mensaje amable", () => {
    const outcome = inviteOutcome(fail("UNAVAILABLE", "Todavía no está disponible."), "new");
    expect(outcome.kind).toBe("notice");
    expect(JSON.stringify(outcome)).not.toContain("Todavía no está disponible");
  });
});
