import { describe, expect, it } from "vitest";
import { PENDING } from "./invitation.fixture";
import { caseOf } from "./whichCase";

describe("caseOf", () => {
  it("elige cada uno de los seis casos de la maqueta", () => {
    expect(caseOf(PENDING, false)).toBe("new");
    expect(caseOf({ ...PENDING, hasAccount: true }, false)).toBe("signin");
    expect(caseOf({ ...PENDING, hasAccount: true, relation: "same" }, false)).toBe("accept");
    expect(caseOf({ ...PENDING, hasAccount: true, relation: "other" }, false)).toBe("other");
    expect(caseOf({ ...PENDING, status: "expired" }, false)).toBe("expired");
    expect(caseOf({ ...PENDING, status: "accepted" }, false)).toBe("expired");
    expect(caseOf({ ...PENDING, status: "revoked" }, false)).toBe("expired");
  });

  it("quien dice que ya tiene cuenta pasa a entrar", () => {
    expect(caseOf(PENDING, true)).toBe("signin");
  });

  it("con sesión, lo que importa es la relación, no pedir cuenta", () => {
    expect(caseOf({ ...PENDING, relation: "same" }, true)).toBe("accept");
  });
});
