import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InviteDone } from "./InviteDone";
import { InvitePaste } from "./InvitePaste";
import { InviteReview } from "./InviteReview";
import { reviewInvites } from "./inviteVerdicts";

const noop = () => undefined;
const PASTE = {
  institutionHref: "/institucion/i1",
  institutionName: "Colegio San José",
  text: "jorge.lima@sanjose.edu.uy",
  role: "teacher" as const,
  problem: null,
  focus: false,
  onText: noop,
  onRole: noop,
  onReview: noop,
};

describe("InvitePaste", () => {
  it("pegar: etiqueta visible, ayuda, roles y un solo botón «Revisar»", () => {
    const html = renderToStaticMarkup(<InvitePaste {...PASTE} />);
    expect(html).toContain("Invitar profes");
    expect(html).toContain('for="iv-correos"');
    expect(html).toContain("Uno por línea, o separados por coma");
    expect(html).toContain("Entran como");
    expect(html).toContain('type="radio"');
    expect(html).toContain(">Revisar<");
    expect(html).not.toContain('role="alert"');
  });

  it("el profe viene marcado y el texto pegado se conserva", () => {
    const html = renderToStaticMarkup(<InvitePaste {...PASTE} />);
    expect(html).toMatch(/value="teacher"[^>]*checked|checked[^>]*value="teacher"/);
    expect(html).toContain("jorge.lima@sanjose.edu.uy");
  });

  it("sin correos: un aviso con role=alert, el campo marcado inválido y el mensaje al lado", () => {
    const html = renderToStaticMarkup(<InvitePaste {...PASTE} text="" problem={{ message: "Pegá al menos un correo.", attempt: 1 }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Falta completar un dato");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="iv-correos-error"');
    expect(html).toContain('href="#iv-correos"');
  });
});

describe("InviteReview", () => {
  const rows = reviewInvites(["jorge.lima@sanjose.edu.uy", "diego.nunez@sanjose.edu.uy", "pablo.ferreira@sanjose", "jorge.lima@sanjose.edu.uy"].join("\n"), {
    role: "teacher",
    members: [{ email: "diego.nunez@sanjose.edu.uy", roles: ["teacher"] }],
    invitations: [],
  });
  const props = { rows, role: "teacher" as const, homeHref: "/institucion/i1", pending: false, notice: null, onBack: noop, onConfirm: noop };

  it("cada correo que no se manda dice por qué, con texto y con ícono", () => {
    const html = renderToStaticMarkup(<InviteReview {...props} />);
    expect(html).toContain("Revisá antes de mandar");
    expect(html).toContain("Se invita como profe");
    expect(html).toContain("Ya está en el colegio con ese rol.");
    expect(html).toContain("Le falta el final, por ejemplo .edu.uy.");
    expect(html).toContain("Está repetido: se manda una sola vez.");
    expect(html).toContain("No se manda");
    expect(html).toContain("<svg");
  });

  it("solo el mal escrito ofrece «Corregir», y el botón cuenta lo que se manda", () => {
    const html = renderToStaticMarkup(<InviteReview {...props} />);
    expect(html.match(/>Corregir</g)).toHaveLength(1);
    expect(html).toContain("Mandar 1 invitación");
    expect(html).toContain("Cancelar");
  });

  it("la tabla tiene título y encabezados para el lector de pantalla", () => {
    const html = renderToStaticMarkup(<InviteReview {...props} />);
    expect(html).toContain("<caption");
    expect(html).toContain('scope="col"');
  });

  it("si no hay nada para mandar, el botón está desactivado y se explica", () => {
    const html = renderToStaticMarkup(<InviteReview {...props} rows={rows.filter((row) => row.verdict.kind !== "send")} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Mandar 0 invitaciones/);
    expect(html).toContain("No hay ningún correo para mandar");
  });

  it("si falló el envío, el aviso es neutro y se anuncia", () => {
    const html = renderToStaticMarkup(<InviteReview {...props} notice={{ text: "No pudimos completar esto ahora.", attempt: 1 }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("No pudimos completar esto ahora.");
    expect(html).not.toContain("Todavía no está disponible");
  });
});

describe("InviteDone", () => {
  const row = (outcome: "sent" | "mail_failed" | "already_member", email: string) => ({ email, outcome, invitationId: null, expiresAt: null });

  it("anuncia el resultado y lleva a la lista", () => {
    const html = renderToStaticMarkup(<InviteDone results={[row("sent", "a@x.uy"), row("sent", "b@x.uy")]} homeHref="/h" listHref="/h/profes" onAgain={noop} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Mandamos 2 invitaciones");
    expect(html).toContain('href="/h/profes"');
    expect(html).not.toContain("<ul");
  });

  it("lo que no salió se dice por correo, con su motivo", () => {
    const html = renderToStaticMarkup(<InviteDone results={[row("sent", "a@x.uy"), row("mail_failed", "b@x.uy"), row("already_member", "c@x.uy")]} homeHref="/h" listHref="/l" onAgain={noop} />);
    expect(html).toContain("Mandamos 1 invitación");
    expect(html).toContain("b@x.uy");
    expect(html).toContain("no pudimos mandar el correo");
    expect(html).toContain("c@x.uy");
    expect(html).toContain("Ya está en el colegio con ese rol.");
  });
});
