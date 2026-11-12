import { describe, expect, it } from "vitest";
import { describeRetry } from "./retry-time";

describe("describeRetry", () => {
  const at = Date.parse("2026-11-12T15:35:00.000Z");

  it("da la hora y los minutos que faltan", () => {
    expect(describeRetry("2026-11-12T15:40:00.000Z", at, "UTC")).toEqual({ clock: "15:40", minutes: 5, iso: "2026-11-12T15:40:00.000Z" });
  });

  it("usa la hora del lugar de quien mira", () => {
    expect(describeRetry("2026-11-12T15:40:00.000Z", at, "America/Montevideo")?.clock).toBe("12:40");
  });

  it("redondea hacia arriba y nunca dice cero minutos", () => {
    expect(describeRetry("2026-11-12T15:35:20.000Z", at, "UTC")?.minutes).toBe(1);
    expect(describeRetry("2026-11-12T15:30:00.000Z", at, "UTC")?.minutes).toBe(1);
  });

  it("sin hora o con una hora rota no inventa nada", () => {
    expect(describeRetry(undefined, at)).toBeNull();
    expect(describeRetry("mañana", at)).toBeNull();
  });
});
