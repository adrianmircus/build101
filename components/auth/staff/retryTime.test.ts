import { describe, expect, it } from "vitest";
import { formatDay, formatRetryTime } from "./retryTime";

const TZ = "America/Montevideo";

describe("formatRetryTime", () => {
  it("dice la hora local del mismo día, en 24 horas", () => {
    // 13:42 UTC es 10:42 en Montevideo (UTC-3).
    const now = new Date("2026-11-12T12:00:00Z");
    expect(formatRetryTime("2026-11-12T13:42:00Z", { now, timeZone: TZ })).toBe("a las 10:42");
  });

  it("respeta la zona horaria de quien mira", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    expect(formatRetryTime("2026-11-12T13:42:00Z", { now, timeZone: "UTC" })).toBe("a las 13:42");
  });

  it("agrega el día cuando no es hoy", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    expect(formatRetryTime("2026-11-13T13:05:00Z", { now, timeZone: TZ })).toBe("el viernes 13 de noviembre a las 10:05");
  });

  it("sin retryAt o con una fecha rota no inventa una hora", () => {
    expect(formatRetryTime(undefined)).toBeNull();
    expect(formatRetryTime("no es una fecha")).toBeNull();
  });
});

describe("formatDay", () => {
  it("escribe el día de la semana, el número y el mes, sin coma", () => {
    expect(formatDay("2026-11-18T15:00:00Z", TZ)).toBe("miércoles 18 de noviembre");
  });
});
