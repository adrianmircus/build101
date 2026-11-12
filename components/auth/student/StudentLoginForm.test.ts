import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Notice } from "./failure-view";
import { initialLoginState, type LoginState } from "./login-state";
import { StudentLoginForm } from "./StudentLoginForm";
import { expectNeutralAlert, expectNoRed, markup } from "./testing";
import type { StudentLoginController } from "./useStudentLogin";
import type { Lookup } from "./useSchoolLookup";

function controller(over: Partial<LoginState> = {}, lookup: Lookup = { kind: "none" }): StudentLoginController {
  return {
    state: { ...initialLoginState({ code: "sanjose", username: "" }), ...over },
    lookup: { state: lookup, lookupNow: vi.fn() },
    code: "sanjose",
    submit: vi.fn(async () => {}),
    edit: vi.fn(),
    toggleReveal: vi.fn(),
    resume: vi.fn(),
  };
}

type View = { school?: { name: string } | null; fromCard?: boolean };
function render(login: StudentLoginController, { school = null, fromCard = false }: View = {}) {
  return markup(createElement(StudentLoginForm, { login, school, fromCard, onChangeSchool: vi.fn(), onNotMe: vi.fn() }));
}
const withNotice = (notice: Notice, over: Partial<LoginState> = {}) => controller({ notice, noticeKey: 1, ...over });

describe("primera vez en este dispositivo", () => {
  const html = render(controller());

  it("pide los tres datos de la tarjeta, en su orden y con los nombres de la tarjeta", () => {
    const order = ["Código del colegio", "Usuario", "Contraseña"].map((label) => html.indexOf(`>${label}</label>`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("deja pegar y funciona con el gestor de contraseñas", () => {
    expect(html).toContain('autoComplete="organization"');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).not.toMatch(/onPaste|readOnly/);
  });

  it("ofrece escanear la tarjeta y no muestra ningún aviso", () => {
    expect(html).toContain('href="/ingresar/estudiante/escanear"');
    expect(html).toContain("Escanear el código de la tarjeta");
    expect(html).not.toContain('role="alert"');
    expectNoRed(html);
  });
});

describe("colegio recordado", () => {
  const html = render(controller({ code: "sanjose" }), { school: { name: "Colegio San José" } });

  it("son dos campos, con el nombre del colegio y el botón para cambiarlo", () => {
    expect(html).toContain("Colegio San José");
    expect(html).toContain("Recordado en este dispositivo");
    expect(html).toContain("Cambiar");
    expect(html).not.toContain("Código del colegio");
    expect(html).toContain(">Usuario</label>");
    expect(html).toContain(">Contraseña</label>");
  });
});

describe("error neutro", () => {
  const typed = { code: "sanjose", username: "luciaf", password: "nube tigre 47", reveal: true };
  const html = render(withNotice({ kind: "wrong" }, typed), { school: { name: "Colegio San José" } });

  it("tiene ícono, pista concreta y es un aviso para el lector de pantalla", () => {
    expectNeutralAlert(html);
    expect(html).toContain("Probemos de nuevo.");
    expect(html).toContain("sol-nube-tigre-47");
    expect(html).toContain("bg-slate-100");
  });

  it("no borra lo escrito y ofrece reintentar", () => {
    expect(html).toContain('value="luciaf"');
    expect(html).toContain('value="nube tigre 47"');
    expect(html).toContain('type="text"');
    expect(html).toContain("Probar de nuevo</button>");
  });

  it("con una tarjeta escaneada la pista es sobre la contraseña", () => {
    const card = render(withNotice({ kind: "wrong" }, { username: "luciaf", password: "x" }), { school: { name: "Colegio San José" }, fromCard: true });
    expect(card).toContain("Esa no es la contraseña.");
    expectNeutralAlert(card);
  });
});

describe("el colegio", () => {
  it("un código que no existe se dice con el nombre escrito", () => {
    const html = render(controller({ code: "sanjos" }, { kind: "missing" }));
    expectNeutralAlert(html);
    expect(html).toContain("No encontramos el colegio <strong>sanjos</strong>");
    expect(html).toContain('aria-invalid="true"');
  });

  it("uno que existe muestra su nombre con un tilde y texto", () => {
    const html = render(controller({ code: "sanjose" }, { kind: "found", name: "Colegio San José" }));
    expect(html).toContain("Colegio San José");
    expect(html).toContain('role="status"');
    expectNoRed(html);
  });
});

describe("falta un dato", () => {
  it("el aviso está al lado del campo y no borra lo otro", () => {
    const html = render(withNotice({ kind: "missing", field: "username" }, { password: "sol-nube-tigre-47" }));
    const field = html.indexOf('id="usuario"');
    expect(html.indexOf("Falta tu usuario.")).toBeGreaterThan(field);
    expect(html.indexOf("Falta tu usuario.")).toBeLessThan(html.indexOf('id="contrasena"'));
    expect(html).toContain('aria-describedby="usuario-falta"');
    expect(html).toContain("sol-nube-tigre-47");
    expectNeutralAlert(html);
  });
});

describe("cuando los servicios no responden", () => {
  it("muestra un error genérico que no culpa al estudiante, y lo escrito sigue", () => {
    const html = render(withNotice({ kind: "unavailable" }, { username: "luciaf", password: "x" }));
    expectNeutralAlert(html);
    expect(html).toContain("No pudimos conectarnos.");
    expect(html).toContain("No hiciste nada mal");
    expect(html).toContain('value="luciaf"');
  });
});

describe("con la tarjeta escaneada", () => {
  const html = render(controller({ code: "sanjose", username: "luciaf" }), { school: { name: "Colegio San José" }, fromCard: true });

  it("queda solo la contraseña y el usuario va escondido para el gestor de contraseñas", () => {
    expect(html).toContain("Colegio San José");
    expect(html).toContain("Usuario luciaf");
    expect(html).toContain("No soy yo");
    expect(html).not.toContain(">Usuario</label>");
    expect(html).toMatch(/<input[^>]*autoComplete="username"[^>]*aria-hidden="true"[^>]*value="luciaf"/);
    expect(html).not.toContain("Escanear el código");
  });
});

describe("el estudiante nunca ve su perfil", () => {
  it("ninguna pantalla dice nada de perfiles, adaptaciones ni versiones", () => {
    const states = [controller(), withNotice({ kind: "wrong" }), withNotice({ kind: "unavailable" })];
    for (const login of states) expect(render(login)).not.toMatch(/perfil|TDAH|dislexia|autis|\bTEA\b|motriz|disgraf|adaptad|versi[oó]n/i);
  });
});
