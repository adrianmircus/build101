import { describe, expect, it } from "vitest";
import { getMailSender } from "./mail";
import { assertStartupConfig, configProblems } from "./startup-config";

const COMPLETE = {
  NODE_ENV: "production",
  RESEND_API_KEY: "re_clave_de_prueba",
  MAIL_FROM: "Tiza <no-responder@usetiza.app>",
  RATE_LIMIT_SECRET: "s".repeat(32),
  NEXT_PUBLIC_SITE_URL: "https://usetiza.app",
};

describe("configProblems", () => {
  it("una configuración completa no tiene problemas", () => {
    expect(configProblems(COMPLETE)).toEqual([]);
    expect(() => assertStartupConfig(COMPLETE)).not.toThrow();
  });

  it("en desarrollo y en pruebas no exige nada", () => {
    expect(configProblems({})).toEqual([]);
    expect(configProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(configProblems({ NODE_ENV: "test" })).toEqual([]);
  });

  it("en producción, sin nada, nombra las cuatro variables", () => {
    const text = configProblems({ NODE_ENV: "production" }).join("\n");
    for (const name of ["RESEND_API_KEY", "MAIL_FROM", "RATE_LIMIT_SECRET", "NEXT_PUBLIC_SITE_URL"]) expect(text).toContain(name);
  });

  it("MAIL_DRIVER=resend o vacío exige la clave y el remitente", () => {
    for (const MAIL_DRIVER of ["resend", "", "  ", undefined]) {
      expect(configProblems({ ...COMPLETE, MAIL_DRIVER, RESEND_API_KEY: "" }).join()).toContain("RESEND_API_KEY");
      expect(configProblems({ ...COMPLETE, MAIL_DRIVER, MAIL_FROM: " " }).join()).toContain("MAIL_FROM");
    }
  });

  it("con otro driver de correo no pide la clave de Resend", () => {
    const env = { ...COMPLETE, MAIL_DRIVER: "mailpit", RESEND_API_KEY: undefined, MAIL_FROM: undefined };
    expect(configProblems(env)).toEqual([]);
  });

  it("RATE_LIMIT_SECRET corto o ausente es un problema", () => {
    expect(configProblems({ ...COMPLETE, RATE_LIMIT_SECRET: "corto" }).join()).toContain("RATE_LIMIT_SECRET");
    expect(configProblems({ ...COMPLETE, RATE_LIMIT_SECRET: undefined }).join()).toContain("RATE_LIMIT_SECRET");
  });

  it("NEXT_PUBLIC_SITE_URL: https, o http solo en localhost; lo demás es un problema", () => {
    expect(configProblems({ ...COMPLETE, NEXT_PUBLIC_SITE_URL: "http://localhost:3100" })).toEqual([]);
    for (const bad of [undefined, "", "usetiza.app", "http://usetiza.app", "javascript:alert(1)"]) {
      expect(configProblems({ ...COMPLETE, NEXT_PUBLIC_SITE_URL: bad }).join()).toContain("NEXT_PUBLIC_SITE_URL");
    }
  });
});

describe("configuración del correo: una sola regla con getMailSender", () => {
  it("MAIL_DRIVER=mailpit en producción sin RESEND_API_KEY arranca solo si Mailpit es local", () => {
    const env = { ...COMPLETE, MAIL_DRIVER: "mailpit", RESEND_API_KEY: undefined, MAIL_FROM: undefined };
    expect(configProblems(env)).toEqual([]);
    expect(configProblems({ ...env, MAIL_MAILPIT_URL: "http://127.0.0.1:54324" })).toEqual([]);
    expect(configProblems({ ...env, MAIL_MAILPIT_URL: "https://correo.example.com" }).join()).toContain("MAIL_MAILPIT_URL");
    expect(configProblems({ ...env, MAIL_MAILPIT_URL: "no es una dirección" }).join()).toContain("MAIL_MAILPIT_URL");
  });

  it("un driver desconocido no arranca", () => {
    expect(configProblems({ ...COMPLETE, MAIL_DRIVER: "sendgrid" }).join()).toContain("MAIL_DRIVER");
  });

  it("un MAIL_FROM que no es una dirección no arranca", () => {
    expect(configProblems({ ...COMPLETE, MAIL_FROM: "sin direccion" }).join()).toContain("MAIL_FROM");
  });

  it("si el arranque pasa, getMailSender no falla por configuración (y al revés)", () => {
    const cases = [
      COMPLETE,
      { ...COMPLETE, MAIL_DRIVER: "mailpit", RESEND_API_KEY: undefined, MAIL_FROM: undefined },
      { ...COMPLETE, MAIL_DRIVER: "mailpit", MAIL_MAILPIT_URL: "https://correo.example.com" },
      { ...COMPLETE, MAIL_DRIVER: "otro" },
      { ...COMPLETE, RESEND_API_KEY: "" },
      { ...COMPLETE, MAIL_FROM: "sin direccion" },
    ];
    for (const env of cases) {
      const starts = configProblems(env).filter((line) => /MAIL|RESEND/.test(line)).length === 0;
      let builds = true;
      try {
        getMailSender(env);
      } catch {
        builds = false;
      }
      expect(builds).toBe(starts);
    }
  });
});

describe("assertStartupConfig", () => {
  it("tira un error en español que nombra las variables y no incluye ningún valor", () => {
    const env = { ...COMPLETE, RESEND_API_KEY: "", RATE_LIMIT_SECRET: "clave-secreta-corta", NEXT_PUBLIC_SITE_URL: "http://sitio-secreto.example" };
    let message = "";
    try {
      assertStartupConfig(env);
    } catch (thrown) {
      message = thrown instanceof Error ? thrown.message : "";
    }
    expect(message).toMatch(/^Falta configuración para arrancar en producción/);
    expect(message).toContain("RESEND_API_KEY");
    expect(message).toContain("RATE_LIMIT_SECRET");
    expect(message).toContain("NEXT_PUBLIC_SITE_URL");
    expect(message).not.toContain("clave-secreta-corta");
    expect(message).not.toContain("sitio-secreto");
    expect(message).not.toContain("MAIL_FROM");
  });
});
