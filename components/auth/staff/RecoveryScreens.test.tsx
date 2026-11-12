import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ForgotSent } from "./ForgotSent";
import { LinkExpired } from "./LinkExpired";
import { NewPasswordForm } from "./NewPasswordForm";
import { SignOutButton } from "./SignOutButton";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/app/salir/actions", () => ({ signOutAction: vi.fn() }));

describe("recuperar la contraseña (login-profe-a)", () => {
  it("enviado: no confirma que la cuenta exista, con role status y el foco en el título", () => {
    const html = renderToStaticMarkup(<ForgotSent email="ana@colegio.edu.uy" onAgain={vi.fn()} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Si hay una cuenta con");
    expect(html).toContain("te mandamos un enlace");
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("No me llegó, mandarlo de nuevo");
  });

  it("vencido: explica la hora de duración y deja pedir otro enlace", () => {
    const html = renderToStaticMarkup(<LinkExpired />);
    expect(html).toContain("Este enlace ya no sirve");
    expect(html).toContain("duran una hora");
    expect(html).toContain("Pedir un enlace nuevo");
    expect(html).toContain('href="/ingresar/profesor/olvide"');
  });

  it("contraseña nueva: dos campos new-password, con la regla de 10 caracteres a la vista", () => {
    const html = renderToStaticMarkup(<NewPasswordForm setNewPassword={vi.fn()} userId="u" onExpired={vi.fn()} />);
    expect(html.match(/autoComplete="new-password"|autocomplete="new-password"/gi)).toHaveLength(2);
    expect(html).toContain("Al menos 10 caracteres");
    expect(html).toContain("Contraseña nueva");
    expect(html).toContain("Repetí la contraseña");
    expect(html).toContain("Guardar y entrar");
    expect(html.match(/Mostrar contraseña/g)).toHaveLength(2);
  });
});

describe("salir", () => {
  it("es un botón con el texto que se le pida", () => {
    expect(renderToStaticMarkup(<SignOutButton />)).toContain(">Salir<");
    expect(renderToStaticMarkup(<SignOutButton label="Cerrar sesión" />)).toContain("Cerrar sesión");
  });
});
