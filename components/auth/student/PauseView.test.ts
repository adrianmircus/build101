import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { PauseView } from "./PauseView";
import { expectNeutralAlert, markup } from "./testing";

const at = Date.parse("2026-11-12T15:35:00.000Z");

describe("PauseView", () => {
  it("muestra la hora de retryAt y cuántos minutos faltan", () => {
    const html = markup(createElement(PauseView, { retryAt: "2026-11-12T15:40:00.000Z", at, onBack: vi.fn() }));
    expect(html).toContain("Tomemos una pausa");
    expect(html).toContain('<time dateTime="2026-11-12T15:40:00.000Z"');
    expect(html).toMatch(/<time[^>]*>\d{2}:\d{2}<\/time>/);
    expect(html).toContain("en 5 minutos");
    expect(html).toContain("pedile una nueva a tu profe");
    expectNeutralAlert(html);
  });

  it("sin hora, no inventa una", () => {
    const html = markup(createElement(PauseView, { retryAt: undefined, at, onBack: vi.fn() }));
    expect(html).toContain("en unos minutos podés volver a intentar");
    expect(html).not.toContain("<time");
  });

  it("tiene cómo volver, sin culpa", () => {
    const html = markup(createElement(PauseView, { retryAt: undefined, at, onBack: vi.fn() }));
    expect(html).toContain("Volver</button>");
    expect(html).not.toMatch(/bloquead|error|incorrect/i);
  });
});
