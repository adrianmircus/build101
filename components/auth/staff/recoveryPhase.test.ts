import { describe, expect, it, vi } from "vitest";
import { fail, ok } from "@/lib/errors";
import { recoveryPhaseFor } from "./recoveryPhase";

const USER = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(40);

describe("recoveryPhaseFor", () => {
  it("sin token en el enlace, está vencido y no llama al servidor", async () => {
    const verify = vi.fn();
    expect(await recoveryPhaseFor(verify, "")).toEqual({ kind: "expired" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("un enlace bueno deja pedir la contraseña nueva", async () => {
    const verify = vi.fn().mockResolvedValue(ok({ verified: true, userId: USER }));
    expect(await recoveryPhaseFor(verify, HASH)).toEqual({ kind: "ready", userId: USER });
    expect(verify).toHaveBeenCalledWith({ tokenHash: HASH });
  });

  it("un enlace vencido o usado muestra el estado vencido", async () => {
    for (const code of ["NOT_FOUND", "FORBIDDEN", "INVALID"] as const) {
      expect(await recoveryPhaseFor(vi.fn().mockResolvedValue(fail(code, "x")), HASH)).toEqual({ kind: "expired" });
    }
  });

  it("si el servicio no responde, no dice que venció: deja probar de nuevo", async () => {
    const phase = await recoveryPhaseFor(vi.fn().mockResolvedValue(fail("UNAVAILABLE", "Todavía no está disponible.")), HASH);
    expect(phase.kind).toBe("error");
    expect(JSON.stringify(phase)).not.toContain("Todavía");
  });

  it("si la conexión se cae, también deja probar de nuevo", async () => {
    const phase = await recoveryPhaseFor(vi.fn().mockRejectedValue(new TypeError("fetch failed")), HASH);
    expect(phase.kind).toBe("error");
  });
});
