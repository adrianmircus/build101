import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LoginBlocked } from "./LoginBlocked";
import { EMAIL_FIELD, PASSWORD_FIELD, MISSING_EMAIL, MISSING_PASSWORD, type LoginState } from "./loginState";
import { StaffLoginView } from "./StaffLoginView";

function render(state: LoginState, pending = false) {
  return renderToStaticMarkup(<StaffLoginView state={state} pending={pending} onSubmit={vi.fn()} />);
}

describe("login del profe (login-profe-a)", () => {
  it("estado inicial: etiquetas visibles, autocomplete correcto y ningún mensaje", () => {
    const html = render({ kind: "idle" });
    expect(html).toContain(`<label for="${EMAIL_FIELD}"`);
    expect(html).toContain(`<label for="${PASSWORD_FIELD}"`);
    expect(html).toMatch(/autocomplete="username"/i);
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toContain("Olvidé mi contraseña");
    expect(html).not.toContain('role="alert"');
  });

  it("no pone readonly ni bloquea pegar en ningún campo", () => {
    const html = render({ kind: "idle" });
    expect(html).not.toMatch(/readonly/i);
    expect(html).not.toMatch(/onpaste/i);
  });

  it("error genérico: arriba del botón, anunciado, con el enlace a crear una contraseña nueva", () => {
    const html = render({ kind: "mismatch", attempt: 1 });
    expect(html).toContain('role="alert"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("El correo o la contraseña no coinciden.");
    expect(html).toContain('href="/ingresar/profesor/olvide"');
    expect(html).toContain("creá una contraseña nueva");
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('type="submit"'));
  });

  it("faltan datos: un resumen con enlaces y el error al lado de cada campo", () => {
    const html = render({
      kind: "fields",
      attempt: 1,
      problems: [
        { field: EMAIL_FIELD, message: MISSING_EMAIL },
        { field: PASSWORD_FIELD, message: MISSING_PASSWORD },
      ],
    });
    expect(html).toContain("Falta completar 2 datos");
    expect(html).toContain(`href="#${EMAIL_FIELD}"`);
    expect(html).toContain(`href="#${PASSWORD_FIELD}"`);
    expect(html).toContain(`id="${EMAIL_FIELD}-error"`);
    expect(html).toContain(`id="${PASSWORD_FIELD}-error"`);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
    expect(html).toContain(`aria-describedby="${EMAIL_FIELD}-error"`);
  });

  it("si falta solo uno, solo ese campo se marca", () => {
    const html = render({ kind: "fields", attempt: 1, problems: [{ field: PASSWORD_FIELD, message: MISSING_PASSWORD }] });
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(1);
    expect(html).toContain("Falta completar un dato");
  });

  it("el error de los servicios es neutro y dice que no es culpa de quien escribe", () => {
    const html = render({ kind: "failed", text: "No pudimos completar esto ahora. No es por vos: probá de nuevo en un rato.", stale: false, attempt: 1 });
    expect(html).toContain('role="alert"');
    expect(html).toContain("No es por vos");
    expect(html).not.toContain("Recargar la página");
  });

  it("una página vieja ofrece recargar", () => {
    expect(render({ kind: "failed", text: "Se actualizó Tiza.", stale: true, attempt: 1 })).toContain("Recargar la página");
  });

  it("mientras entra, el botón se deshabilita y lo dice", () => {
    const html = render({ kind: "idle" }, true);
    expect(html).toContain("Ingresando…");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled|<button[^>]*disabled[^>]*type="submit"/);
  });
});

describe("estado bloqueado (login-profe-b)", () => {
  it("dice la hora para volver y ofrece crear una contraseña nueva ahora", () => {
    const html = renderToStaticMarkup(<LoginBlocked when="a las 10:42" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("<strong>a las 10:42</strong>");
    expect(html).toContain("Crear una contraseña nueva");
    expect(html).toContain('href="/ingresar/profesor/olvide"');
  });

  it("sin hora conocida, dice «en unos minutos»", () => {
    expect(renderToStaticMarkup(<LoginBlocked when={null} />)).toContain("en unos minutos");
  });
});
