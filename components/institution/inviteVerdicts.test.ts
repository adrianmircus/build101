import { describe, expect, it } from "vitest";
import { malformedReason, splitEmails } from "./emailList";
import { canFix, emailsToSend, reasonText, reviewInvites, type ReviewContext } from "./inviteVerdicts";

const CONTEXT: ReviewContext = {
  role: "teacher",
  members: [
    { email: "diego.nunez@sanjose.edu.uy", roles: ["teacher"] },
    { email: "marta@sanjose.edu.uy", roles: ["admin"] },
  ],
  invitations: [
    { email: "ines.correa@sanjose.edu.uy", role: "teacher", status: "pending" },
    { email: "vieja@sanjose.edu.uy", role: "teacher", status: "expired" },
  ],
};

describe("splitEmails", () => {
  it("separa por línea, coma, punto y coma o espacio, y normaliza", () => {
    expect(splitEmails("A@x.uy, b@x.uy;\n  C@x.uy  d@x.uy\r\n")).toEqual(["a@x.uy", "b@x.uy", "c@x.uy", "d@x.uy"]);
  });

  it("saca los signos de una lista de contactos", () => {
    expect(splitEmails('"Ana" <ana@x.uy>,')).toEqual(["ana", "ana@x.uy"]);
  });

  it("un texto vacío no da correos", () => {
    expect(splitEmails("  \n , ; ")).toEqual([]);
  });
});

describe("malformedReason", () => {
  it("dice qué falta", () => {
    expect(malformedReason("ana.x.uy")).toBe("missing_at");
    expect(malformedReason("pablo.ferreira@sanjose")).toBe("missing_domain_end");
    expect(malformedReason("pablo@sanjose.u")).toBe("missing_domain_end");
    expect(malformedReason("a@@b.uy")).toBe("other");
    expect(malformedReason("a@b..uy")).toBe("other");
    expect(malformedReason("@sanjose.edu.uy")).toBe("other");
  });

  it("acepta uno bien escrito", () => {
    expect(malformedReason("jorge.lima@sanjose.edu.uy")).toBeNull();
  });
});

describe("reviewInvites", () => {
  const text = [
    "jorge.lima@sanjose.edu.uy",
    "diego.nunez@sanjose.edu.uy",
    "pablo.ferreira@sanjose",
    "JORGE.lima@sanjose.edu.uy",
    "ines.correa@sanjose.edu.uy",
    "marta@sanjose.edu.uy",
    "vieja@sanjose.edu.uy",
    "x@estudiantes.usetiza.app",
  ].join("\n");

  it("marca cada correo con su motivo", () => {
    const kinds = reviewInvites(text, CONTEXT).map((row) => row.verdict.kind);
    expect(kinds).toEqual(["send", "member", "malformed", "repeated", "pending", "send", "send", "synthetic"]);
  });

  it("un admin puede ser invitado como profe, pero no de nuevo como admin", () => {
    const asAdmin = reviewInvites("marta@sanjose.edu.uy", { ...CONTEXT, role: "admin" });
    expect(asAdmin[0]?.verdict.kind).toBe("member");
  });

  it("una invitación vencida no frena otra nueva", () => {
    expect(reviewInvites("vieja@sanjose.edu.uy", CONTEXT)[0]?.verdict.kind).toBe("send");
  });

  it("solo se mandan los que están bien, una vez cada uno", () => {
    expect(emailsToSend(reviewInvites(text, CONTEXT))).toEqual(["jorge.lima@sanjose.edu.uy", "marta@sanjose.edu.uy", "vieja@sanjose.edu.uy"]);
  });

  it("cada motivo tiene su texto y solo el mal escrito se corrige", () => {
    const rows = reviewInvites(text, CONTEXT);
    expect(rows.map((row) => reasonText(row.verdict))).toEqual([
      null,
      "Ya está en el colegio con ese rol.",
      "Le falta el final, por ejemplo .edu.uy.",
      "Está repetido: se manda una sola vez.",
      "Ya tiene una invitación esperando respuesta.",
      null,
      null,
      "Ese correo es de una cuenta de estudiante. Usá el correo del profe.",
    ]);
    expect(rows.filter((row) => canFix(row.verdict)).map((row) => row.email)).toEqual(["pablo.ferreira@sanjose"]);
  });
});
