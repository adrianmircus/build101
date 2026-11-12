import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { CardProblem } from "./CardProblem";
import { NeutralMessage } from "./NeutralMessage";
import { NoCameraView } from "./NoCameraView";
import { ScanIntro } from "./ScanIntro";
import { expectNeutralAlert, expectNoRed, markup } from "./testing";

describe("sin cámara o sin permiso", () => {
  it("explica que se puede abrir la cámara del celular y ofrece escribir los datos", () => {
    for (const denied of [true, false]) {
      const html = markup(createElement(NoCameraView, { denied }));
      expect(html).toContain("cámara de tu celular");
      expect(html).toContain('href="/ingresar/estudiante"');
      expect(html).toContain("Escribir mis datos");
      expectNeutralAlert(html);
    }
  });

  it("el permiso denegado se dice sin culpa", () => {
    const html = markup(createElement(NoCameraView, { denied: true }));
    expect(html).toContain("No pudimos usar la cámara");
    expect(html).toContain("No pasa nada");
  });
});

describe("escanear", () => {
  it("la cámara se abre con un toque, y se puede escribir en vez de escanear", () => {
    const html = markup(createElement(ScanIntro, { onOpen: vi.fn() }));
    expect(html).toContain("Abrir la cámara</button>");
    expect(html).toContain("Prefiero escribir mis datos");
    expect(html).toContain("no se guarda ni se envía");
    expectNoRed(html);
  });
});

describe("una tarjeta que no sirve", () => {
  it("es neutra y lleva a escribir los datos", () => {
    for (const why of ["unusable", "unavailable"] as const) {
      const html = markup(createElement(CardProblem, { why, onRetry: vi.fn() }));
      expectNeutralAlert(html);
      expect(html).toContain("Escribir mis datos");
      expect(html).toContain("Escanear de nuevo");
    }
  });
});

describe("NeutralMessage", () => {
  it("es un aviso con ícono, se puede enfocar por código y es gris", () => {
    // eslint-disable-next-line react/no-children-prop -- createElement types ask for children inside the props
    const html = markup(createElement(NeutralMessage, { id: "m", children: createElement("p", null, "Hola") }));
    expectNeutralAlert(html);
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("bg-slate-100");
    expect(html).toContain('id="m"');
  });
});
