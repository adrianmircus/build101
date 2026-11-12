import { describe, expect, it } from "vitest";
import { summaryTexts } from "./summaryText";

describe("summaryTexts", () => {
  it("cuenta profes, invitaciones, cuentas y grupos", () => {
    expect(summaryTexts({ staffCount: 4, pendingInvitations: 2, groupCount: 3, studentCount: 34 })).toEqual({
      staff: "4 en el colegio. 2 invitaciones esperando respuesta.",
      students: "34 cuentas en 3 grupos.",
    });
  });

  it("singular y vacío", () => {
    expect(summaryTexts({ staffCount: 1, pendingInvitations: 1, groupCount: 1, studentCount: 1 })).toEqual({
      staff: "1 en el colegio. 1 invitación esperando respuesta.",
      students: "1 cuenta en 1 grupo.",
    });
    expect(summaryTexts({ staffCount: 1, pendingInvitations: 0, groupCount: 0, studentCount: 0 })).toEqual({
      staff: "1 en el colegio. Ninguna invitación esperando respuesta.",
      students: "Todavía no hay cuentas de estudiantes.",
    });
  });
});
