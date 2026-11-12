import { describe, expect, it, vi } from "vitest";

// The entry point itself: Next calls register() before serving, so what it throws is what stops the server.
describe("instrumentation.register", () => {
  it("en producción sin el correo no deja arrancar", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("MAIL_FROM", "");
    vi.stubEnv("RATE_LIMIT_SECRET", "s".repeat(32));
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://usetiza.app");
    const { register } = await import("./instrumentation");
    expect(() => register()).toThrow(/RESEND_API_KEY/);
    vi.stubEnv("RESEND_API_KEY", "re_clave");
    vi.stubEnv("MAIL_FROM", "Tiza <no-responder@usetiza.app>");
    expect(() => register()).not.toThrow();
    vi.unstubAllEnvs();
  });

  it("en pruebas no exige nada", async () => {
    const { register } = await import("./instrumentation");
    expect(() => register()).not.toThrow();
  });
});
