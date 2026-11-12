import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InvitationView, StaffRow } from "@/lib/domain/accounts/entities";
import type { GroupSummary } from "@/lib/domain/groups/rpc";
import { GroupList } from "./GroupList";
import { HomeActions } from "./HomeActions";
import { InvitationList } from "./InvitationList";
import { LoadError } from "./LoadError";
import { NoAccess } from "./NoAccess";
import { StaffList } from "./StaffList";
import { SummaryBlock } from "./SummaryBlock";

// The rows of the invitations use the router to read the list again after each action.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, replace: () => undefined }) }));

const ID = "11111111-1111-4111-8111-111111111111";
const INVITATION: InvitationView = {
  id: ID,
  email: "pablo.ferreira@sanjose.edu.uy",
  role: "teacher",
  status: "pending",
  expiresAt: "2026-11-18T15:00:00Z",
  sentAt: "2026-11-11T15:00:00Z",
  invitedByName: null,
  createdAt: "2026-11-11T15:00:00Z",
  revision: 1,
};
const actions = { resend: async () => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "" }), revoke: async () => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "" }) };

describe("InvitationList", () => {
  it("cada invitación tiene Reenviar y Revocar con el correo para el lector de pantalla, y el vencimiento", () => {
    const html = renderToStaticMarkup(<InvitationList institutionId="i1" items={[INVITATION]} actions={actions} />);
    expect(html).toContain("Esperando respuesta");
    expect(html).toContain("pablo.ferreira@sanjose.edu.uy");
    expect(html).toContain("Profe · vence el miércoles 18 de noviembre");
    expect(html).toContain("Reenviar<span");
    expect(html).toContain("a pablo.ferreira@sanjose.edu.uy");
    expect(html).toContain("Revocar<span");
    expect(html).toContain("la invitación de pablo.ferreira@sanjose.edu.uy");
  });

  it("una vencida ofrece «Mandar otra» y dice que venció", () => {
    const html = renderToStaticMarkup(<InvitationList institutionId="i1" items={[{ ...INVITATION, status: "expired" }]} actions={actions} />);
    expect(html).toContain("venció el miércoles 18 de noviembre");
    expect(html).toContain("Mandar otra");
  });

  it("las cerradas no aparecen, y sin ninguna lo dice", () => {
    const html = renderToStaticMarkup(<InvitationList institutionId="i1" items={[{ ...INVITATION, status: "accepted" }, { ...INVITATION, status: "revoked" }]} actions={actions} />);
    expect(html).toContain("No hay invitaciones esperando respuesta.");
    expect(html).not.toContain("Revocar");
  });

  it("si el correo no salió todavía, lo avisa con texto", () => {
    const html = renderToStaticMarkup(<InvitationList institutionId="i1" items={[{ ...INVITATION, sentAt: null }]} actions={actions} />);
    expect(html).toContain("Todavía no salió el correo");
  });
});

describe("StaffList", () => {
  const rows: StaffRow[] = [
    { userId: "u1", displayName: "Ana Pérez", email: "ana@sanjose.edu.uy", roles: ["admin"], hasSignedIn: true },
    { userId: "u2", displayName: "Diego Núñez", email: "diego@sanjose.edu.uy", roles: ["teacher"], hasSignedIn: false },
    { userId: "u3", displayName: null, email: "sin.nombre@sanjose.edu.uy", roles: ["inclusion"], hasSignedIn: true },
  ];

  it("dice si ya entró, marca «vos» y no ofrece cambiar roles", () => {
    const html = renderToStaticMarkup(<StaffList rows={rows} youId="u1" />);
    expect(html).toContain("Admin · vos");
    expect(html).toContain("Profe · todavía no entró");
    expect(html).toContain("Inclusión · ya entró alguna vez");
    expect(html).toContain("sin.nombre@sanjose.edu.uy");
    expect(html).not.toMatch(/Cambiar|rol</);
    expect(html).not.toContain("<button");
  });
});

describe("GroupList", () => {
  const group: GroupSummary = { id: "g1", name: "4.º B", subjectId: "math", schoolYear: 2026, archivedAt: null, revision: 1, myRole: null, studentCount: 10 };

  it("cada grupo lleva a sus tarjetas y los archivados no aparecen", () => {
    const html = renderToStaticMarkup(<GroupList institutionId="i1" groups={[group, { ...group, id: "g2", name: "viejo", archivedAt: "2025-12-01T00:00:00Z" }, { ...group, id: "g3", name: "3.º A", studentCount: 0 }]} />);
    expect(html).toContain('href="/institucion/i1/grupos/g1/tarjetas"');
    expect(html).toContain("Matemática 2026 · 10 estudiantes");
    expect(html).toContain("sin estudiantes todavía");
    expect(html).not.toContain("viejo");
  });

  it("sin grupos lo dice", () => {
    expect(renderToStaticMarkup(<GroupList institutionId="i1" groups={[]} />)).toContain("Todavía no hay grupos");
  });
});

describe("el inicio", () => {
  it("dos acciones grandes, cada una un enlace con su texto", () => {
    const html = renderToStaticMarkup(<HomeActions institutionId="i1" />);
    expect(html).toContain('href="/institucion/i1/invitar"');
    expect(html).toContain("Invitar profes");
    expect(html).toContain('href="/institucion/i1/crear-cuentas"');
    expect(html).toContain("Crear cuentas de estudiantes");
  });

  it("el resumen cuenta y lleva a las listas", () => {
    const summary = { id: "i1", name: "Colegio San José", code: "sanjose", staffCount: 4, pendingInvitations: 2, groupCount: 3, studentCount: 34 };
    const html = renderToStaticMarkup(<SummaryBlock summary={summary} />);
    expect(html).toContain("4 en el colegio. 2 invitaciones esperando respuesta.");
    expect(html).toContain("34 cuentas en 3 grupos.");
    expect(html).toContain('href="/institucion/i1/profes"');
    expect(html).toContain("Ver profes e invitaciones");
    expect(html).toContain('href="/institucion/i1/grupos"');
  });
});

describe("cuando no se puede", () => {
  it("un error de carga es neutro, se anuncia y deja una salida", () => {
    const html = renderToStaticMarkup(<LoadError backHref="/institucion/i1" backLabel="Volver al inicio del panel" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("No es por vos");
    expect(html).toContain('href="/institucion/i1"');
    expect(html).not.toContain("Todavía no está disponible");
  });

  it("quien no es admin lo lee claro y no se entera de si el colegio existe", () => {
    const html = renderToStaticMarkup(<NoAccess />);
    expect(html).toContain("Esta página es para admins del colegio");
    expect(html).toContain('href="/grupos"');
  });
});
