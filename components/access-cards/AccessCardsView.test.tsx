import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AccessCardsView } = await import("./AccessCardsView");
const { ACCOUNTS, PASSWORDS, TOKEN, cardFor, noop, stateWith } = await import("./fixtures");
const { ALREADY_ISSUED } = await import("./cards-state");

type View = Parameters<typeof AccessCardsView>[0];

function render(patch: Partial<View["state"]> = {}, canIssueCards = true): string {
  return renderToStaticMarkup(
    <AccessCardsView
      institutionId="00000000-0000-4000-8000-0000000000aa"
      groupName="4.º B"
      institutionCode="sanjose"
      accounts={ACCOUNTS}
      canIssueCards={canIssueCards}
      state={stateWith(patch)}
      onToggle={noop}
      onToggleAll={noop}
      onAsk={noop}
      onCancelAsk={noop}
      onConfirm={noop}
      onReprint={noop}
      onDone={noop}
    />,
  );
}

const PRINT_START = 'data-print-sheets=""';
const screenOf = (html: string) => (html.includes(PRINT_START) ? html.slice(0, html.indexOf(PRINT_START)) : html);

describe("elegir", () => {
  const html = render();
  it("lista al grupo con todos marcados, y por estudiante si entró, su última tarjeta y su cuenta", () => {
    expect(html).toContain("Para quién");
    expect(html.match(/type="checkbox"/g)).toHaveLength(ACCOUNTS.length + 1);
    expect(html.match(/checked=""/g)).toHaveLength(ACCOUNTS.length + 1);
    expect(html).toContain("ya entró");
    expect(html).toContain("todavía no entró");
    expect(html).toContain("última tarjeta el 3 de noviembre de 2026");
    expect(html).toContain("Cuenta lista");
    expect(html).toContain("Cuenta por preparar");
    expect(html).toContain("no se pudo crear la vez anterior");
  });

  it("tiene «Tarjeta nueva» en cada fila, con el nombre para el lector de pantalla", () => {
    expect(html.match(/Tarjeta nueva<span class="sr-only"> para /g)).toHaveLength(ACCOUNTS.length);
    expect(html).toContain("para Lucía Fernández");
  });

  it("muestra la tarjeta de muestra con «Se crea al imprimir» y el conteo", () => {
    expect(html).toContain("Tarjeta de muestra");
    expect(html).toContain("Hola, Lucía");
    expect(html).toContain("Se crea al imprimir");
    expect(html).toContain("5 tarjetas, 2 hojas A4");
    expect(html).toContain("Crear contraseñas e imprimir");
  });

  it("no muestra nada de perfiles, y sin nadie elegido no se puede imprimir", () => {
    expect(html).not.toMatch(/perfil|TDAH|dislexia|motriz|disgrafía/i);
    const none = render({ selected: [] });
    expect(none).toContain("Todavía no elegiste a nadie.");
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="count"/);
  });

  it("cuida el diseño: sin cursiva ni bordes decorativos", () => {
    expect(html).not.toMatch(/\bitalic\b|\bborder(-[a-z0-9]+)?\b|\bdivide-/);
  });
});

describe("no se puede imprimir (demo)", () => {
  const html = render({}, false);
  it("lo explica y no ofrece imprimir ni tarjeta nueva ni casillas", () => {
    expect(html).toContain("Acá no se pueden crear tarjetas");
    expect(html).toContain("demo");
    expect(html).not.toContain("Crear contraseñas e imprimir");
    expect(html).not.toContain("Tarjeta nueva");
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("Estudiantes del grupo");
  });
});

describe("confirmar", () => {
  it("avisa que las contraseñas son nuevas, que las anteriores dejan de andar y que se cierran las sesiones", () => {
    const html = render({ asking: ACCOUNTS.map((row) => row.studentId) });
    expect(html).toContain('aria-labelledby="confirm-title"');
    expect(html).toContain("¿Creamos las contraseñas de estos 5?");
    expect(html).toContain("Imprimir crea contraseñas nuevas");
    expect(html).toContain("dejan de andar");
    expect(html).toContain("se cierran las sesiones");
    expect(html).toContain("Sí, crear e imprimir");
    expect(html).toContain("Cancelar");
  });

  it("para una sola, habla en singular con el nombre", () => {
    const html = render({ asking: [ACCOUNTS[0]!.studentId] });
    expect(html).toContain("¿Creamos una tarjeta nueva para Lucía Fernández?");
    expect(html).toContain("deja de andar");
  });
});

describe("mientras corre", () => {
  const html = render({ running: true, announcement: "Creando las tarjetas…" });
  it("deshabilita imprimir y las tarjetas nuevas, y lo anuncia", () => {
    expect(html).toContain("Creando las tarjetas…");
    expect(html).toMatch(/aria-busy="true"/);
    expect(html.match(/<button[^>]*disabled=""/g)!.length).toBeGreaterThanOrEqual(ACCOUNTS.length + 1);
    expect(html).toMatch(/<p role="status"[^>]*>Creando las tarjetas…<\/p>/);
  });
});

describe("las tarjetas creadas", () => {
  const cards = ACCOUNTS.slice(0, 4).map(cardFor);
  const html = render({ held: cards, batch: 1, announcement: "Se crearon 4 tarjetas. Se abre la ventana de impresión." });
  const screen = screenOf(html);

  it("las contraseñas no están en el HTML de pantalla: solo en el bloque de impresión", () => {
    expect(html).toContain(PRINT_START);
    for (const password of PASSWORDS.slice(0, 4)) {
      expect(screen).not.toContain(password);
      expect(html.slice(html.indexOf(PRINT_START))).toContain(password);
    }
    expect(html).not.toContain(TOKEN);
  });

  it("el bloque de impresión está oculto en pantalla y solo se ve al imprimir; el resto no se imprime", () => {
    expect(html).toMatch(/<div data-print-sheets="" class="hidden print:block" aria-hidden="true">/);
    expect(html).toContain('class="print:hidden"');
  });

  it("pone 4 tarjetas por hoja A4, con «Hola», el colegio, el usuario y la contraseña", () => {
    const printed = html.slice(html.indexOf(PRINT_START));
    expect(printed.match(/<section /g)).toHaveLength(1);
    expect(printed.match(/<article /g)).toHaveLength(4);
    expect(printed).toContain("Hola, Lucía");
    expect(printed).toContain("Código del colegio");
    expect(printed).toContain("sanjose");
    expect(printed).toContain("luciaf");
    expect(printed).toContain("@page { size: A4; margin: 0; }");
    expect(printed).toContain("<svg");
  });

  it("con 5 tarjetas hace una segunda hoja", () => {
    const five = render({ held: ACCOUNTS.map(cardFor), batch: 1 });
    expect(five.slice(five.indexOf(PRINT_START)).match(/<section /g)).toHaveLength(2);
  });

  it("ofrece «Imprimir de nuevo» y «Listo», y anuncia el resultado", () => {
    expect(screen).toContain("Imprimir de nuevo");
    expect(screen).toContain("Listo");
    expect(screen).toContain('role="status"');
    expect(screen).toContain("Se crearon 4 tarjetas.");
  });

  it("después de «Listo» no queda ninguna contraseña en la página", () => {
    const done = render({ held: null });
    for (const password of PASSWORDS) expect(done).not.toContain(password);
    expect(done).not.toContain(PRINT_START);
  });
});

describe("los que no salieron", () => {
  const html = render({
    held: [cardFor(ACCOUNTS[0]!, 0)],
    batch: 1,
    others: [
      { studentId: ACCOUNTS[1]!.studentId, outcome: "failed" },
      { studentId: ACCOUNTS[2]!.studentId, outcome: "uncertain" },
    ],
  });
  it("los lista con su motivo y ofrece «Probar de nuevo»", () => {
    expect(html).toContain("2 tarjetas no salieron");
    expect(html).toContain("Mateo Silva");
    expect(html).toContain("No se pudo crear la cuenta.");
    expect(html).toContain("Valentina Rodríguez");
    expect(html).toContain("No pudimos confirmar. Probá de nuevo.");
    expect(html).toContain("Probar de nuevo");
  });
});

describe("avisos", () => {
  it("un conflicto dice el texto del contrato y ofrece crear de nuevo", () => {
    const html = render({ notice: { kind: "conflict", text: ALREADY_ISSUED, canRetry: true, key: 1 }, lastRequest: [ACCOUNTS[0]!.studentId] });
    expect(html).toContain('role="alert"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Las tarjetas ya se crearon. Si no llegaste a imprimirlas, creá nuevas.");
    expect(html).toContain("Crear tarjetas nuevas");
  });

  it("un error de la acción se anuncia con ícono y ofrece probar de nuevo", () => {
    const html = render({ notice: { kind: "failure", text: "Todavía no está disponible.", canRetry: true, key: 1 }, lastRequest: [ACCOUNTS[0]!.studentId] });
    expect(html).toContain('role="alert"');
    expect(html).toContain("<svg");
    expect(html).toContain("Todavía no está disponible.");
    expect(html).toContain("Probar de nuevo");
  });

  it("sin permiso no ofrece reintentar", () => {
    const html = render({ notice: { kind: "failure", text: "No tenés permiso para hacer esto.", canRetry: false, key: 1 } });
    expect(html).not.toContain("Probar de nuevo");
  });
});
