import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InvitationPublic } from "@/lib/domain/accounts/results";
import { InvitationCase } from "./InvitationCase";
import { InviteDone } from "./InviteDone";
import { PENDING } from "./invitation.fixture";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/app/salir/actions", () => ({ signOutAction: vi.fn() }));

const actions = { accept: vi.fn(), acceptAsNew: vi.fn(), signInAndAccept: vi.fn(), signOut: vi.fn() };
const handlers = { onAccepted: vi.fn(), onHaveAccount: vi.fn(), onGone: vi.fn(), onReload: vi.fn(), onSignIn: vi.fn() };

function render(invitation: InvitationPublic, wantsSignIn = false) {
  return renderToStaticMarkup(<InvitationCase invitation={invitation} token="t" actions={actions} wantsSignIn={wantsSignIn} {...handlers} />);
}

describe("invitación (invitacion-a, seis casos)", () => {
  it("sin cuenta: nombre y contraseña nueva, con el correo fijo de la invitación", () => {
    const html = render(PENDING);
    expect(html).toContain("Marta Rodríguez te invitó a sumarte a Colegio San José");
    expect(html).toContain("Vas a entrar como profe");
    expect(html).toMatch(/vence el (<!-- -->)?\p{L}+ 18 de noviembre/u);
    expect(html).toContain("Creá tu cuenta");
    expect(html).toMatch(/autoComplete="name"|autocomplete="name"/i);
    expect(html).toMatch(/autoComplete="new-password"|autocomplete="new-password"/i);
    expect(html).toContain('value="ana.perez@sanjose.edu.uy"');
    expect(html).toMatch(/readOnly=""|readonly=""/i);
    expect(html).toContain("Crear cuenta y sumarme");
    expect(html).toContain('href="/terminos"');
    expect(html).toContain('href="/privacidad"');
    expect(html).toContain("Entrá para aceptar");
  });

  it("con cuenta y sin sesión: entrar para aceptar, con la contraseña actual y «Olvidé mi contraseña»", () => {
    const html = render({ ...PENDING, hasAccount: true });
    expect(html).toContain("Ya tenés cuenta en Tiza.ai");
    expect(html).toMatch(/autoComplete="current-password"|autocomplete="current-password"/i);
    expect(html).toContain("Entrar y sumarme");
    expect(html).toContain('href="/ingresar/profesor/olvide"');
    expect(html).not.toContain("Nombre y apellido");
  });

  it("quien eligió «ya tengo cuenta» ve el mismo formulario de entrar", () => {
    expect(render(PENDING, true)).toContain("Entrar y sumarme");
  });

  it("con sesión y el mismo correo: un botón para aceptar, nunca acepta solo", () => {
    const html = render({ ...PENDING, hasAccount: true, relation: "same" });
    expect(html).toContain("Entraste como ana.perez@sanjose.edu.uy");
    expect(html).toContain("Sumarme a Colegio San José");
    expect(html).toContain("Ahora no");
    expect(actions.accept).not.toHaveBeenCalled();
  });

  it("con sesión y otro correo: la marca de B y «Salir y entrar con…», sin aceptar", () => {
    const html = render({ ...PENDING, hasAccount: true, relation: "other" });
    expect(html).toContain("Esta invitación es para otro correo");
    expect(html).toContain("No es el correo con el que entraste");
    expect(html).toContain("Salir y entrar con ana.perez@sanjose.edu.uy");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Sumarme a Colegio San José");
  });

  it("vencida: lo dice y manda a pedir otra, sin mostrar el correo", () => {
    const html = render({ ...PENDING, status: "expired" });
    expect(html).toContain("Esta invitación venció");
    expect(html).toContain("Pedile a Marta Rodríguez");
    expect(html).not.toContain("ana.perez@sanjose.edu.uy");
  });

  it("usada o cancelada: «ya no sirve»", () => {
    expect(render({ ...PENDING, status: "accepted" })).toContain("Esta invitación ya no sirve");
    expect(render({ ...PENDING, status: "revoked" })).toContain("Esta invitación ya no sirve");
  });

  it("sin nombre de quien invitó, no queda un hueco", () => {
    const html = render({ ...PENDING, inviterName: null });
    expect(html).toContain("Te invitaron a sumarte a Colegio San José");
  });

  it("el rol se dice en palabras del colegio", () => {
    expect(render({ ...PENDING, role: "admin" })).toContain("Vas a entrar como admin");
    expect(render({ ...PENDING, role: "inclusion" })).toContain("equipo de inclusión");
  });

  it("aceptada: se anuncia (status) y lleva a donde dice el servidor", () => {
    const html = renderToStaticMarkup(<InviteDone institutionName="Colegio San José" accepted={{ institutionId: "i", role: "teacher", next: "/grupos" }} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Ya sos parte de Colegio San José");
    expect(html).toContain('href="/grupos"');
    expect(html).toContain('tabindex="-1"');
  });
});
