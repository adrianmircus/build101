import { describe, expect, it } from "vitest";
import { MAX_EMAILS } from "./emailList";
import { inviteReducer, initialInvite, pasteProblem, pasteProblemText, sendLabel } from "./inviteFlowState";
import { countSent, doneTitle, hasTrouble, outcomeText } from "./inviteOutcome";
import { subjectName } from "./subjectNames";

const row = (outcome: "sent" | "mail_failed" | "already_member") => ({ email: "a@x.uy", outcome, invitationId: null, expiresAt: null });

describe("inviteReducer", () => {
  it("empieza como profe, pegando", () => {
    expect(initialInvite()).toMatchObject({ step: "paste", role: "teacher", text: "" });
  });

  it("revisa, vuelve sin perder lo pegado, y termina con los resultados", () => {
    let state = inviteReducer(initialInvite(), { type: "text", value: "a@x.uy" });
    state = inviteReducer(state, { type: "role", value: "admin" });
    state = inviteReducer(state, { type: "reviewing", rows: [{ email: "a@x.uy", verdict: { kind: "send" } }] });
    expect(state.step).toBe("review");
    state = inviteReducer(state, { type: "back" });
    expect(state).toMatchObject({ step: "paste", text: "a@x.uy", role: "admin" });
    state = inviteReducer(state, { type: "sent", results: [row("sent")] });
    expect(state.step).toBe("done");
    expect(inviteReducer(state, { type: "again" })).toEqual(initialInvite());
  });

  it("cambiar el texto o el rol suelta la clave del pedido", () => {
    const withKey = inviteReducer(initialInvite(), { type: "attempt", attempt: { opKey: "k", signature: "s" } });
    expect(inviteReducer(withKey, { type: "role", value: "inclusion" }).attempt).toBeNull();
  });
});

describe("pasteProblem", () => {
  it("pide al menos un correo y no más de 50", () => {
    expect(pasteProblem(" \n ")).toBe("empty");
    expect(pasteProblem(Array.from({ length: MAX_EMAILS + 1 }, (_, i) => `u${i}@x.uy`).join("\n"))).toBe("too_many");
    expect(pasteProblem("a@x.uy")).toBeNull();
    expect(pasteProblemText("too_many")).toContain("50");
  });

  it("el botón cuenta en singular y plural", () => {
    expect(sendLabel(1)).toBe("Mandar 1 invitación");
    expect(sendLabel(2)).toBe("Mandar 2 invitaciones");
  });
});

describe("resultado del envío", () => {
  it("cuenta solo las que salieron y avisa si algo necesita atención", () => {
    const results = [row("sent"), row("mail_failed"), row("already_member")];
    expect(countSent(results)).toBe(1);
    expect(doneTitle(results)).toBe("Mandamos 1 invitación");
    expect(doneTitle([row("already_member")])).toBe("No se mandó ninguna invitación");
    expect(hasTrouble(results)).toBe(true);
    expect(hasTrouble([row("sent")])).toBe(false);
    expect(outcomeText("mail_failed")).toContain("Reenviala");
  });
});

describe("subjectName", () => {
  it("el nombre sale del catálogo y una materia desconocida no muestra su id", () => {
    expect(subjectName("math")).toBe("Matemática");
    expect(subjectName("geology")).toBe("Materia nueva");
  });
});
