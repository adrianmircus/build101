import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { getMailSender, invitationMail } from "./index";
import { readSender } from "./from";

const MESSAGE = { to: "profe@colegio.test", subject: "Asunto", text: "Texto", html: "<p>Texto</p>" };

afterEach(() => vi.restoreAllMocks());

describe("invitationMail", () => {
  const base = {
    to: "profe@colegio.test",
    institutionName: "Liceo Uno",
    inviterName: "Ana Pérez",
    role: "teacher",
    link: "https://usetiza.app/invitacion#abc",
    expiresAt: "2026-11-19T15:00:00+00:00",
  } as const;

  it("carries the link with the token in the fragment, in Spanish", () => {
    const mail = invitationMail(base);
    expect(mail.to).toBe("profe@colegio.test");
    expect(mail.subject).toBe("Te invitaron a Liceo Uno en Tiza");
    expect(mail.text).toContain("Ana Pérez te invitó a sumarte a Liceo Uno en Tiza, como docente.");
    expect(mail.text).toContain("https://usetiza.app/invitacion#abc");
    expect(mail.text).toContain("vence el 19 de noviembre de 2026");
    expect(mail.html).toContain('href="https://usetiza.app/invitacion#abc"');
  });

  it("without an inviter says «Te invitaron» and names each role", () => {
    expect(invitationMail({ ...base, inviterName: null, role: "admin" }).text).toContain(
      "Te invitaron a sumarte a Liceo Uno en Tiza, como administración de la institución.",
    );
    expect(invitationMail({ ...base, role: "inclusion" }).text).toContain("como equipo de inclusión.");
  });

  it("escapes markup in the names and cannot add a header", () => {
    const mail = invitationMail({ ...base, institutionName: "Liceo <b>\r\nBcc: x@y.z", inviterName: "<script>alert(1)</script>" });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});

describe("getMailSender", () => {
  it("is Mailpit by default outside production, and sends to its HTTP API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await getMailSender({ NODE_ENV: "development" }).send(MESSAGE);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:54324/api/v1/send");
    expect(JSON.parse(String(init?.body))).toEqual({
      From: { Email: "no-responder@usetiza.app", Name: "Tiza" },
      To: [{ Email: "profe@colegio.test" }],
      Subject: "Asunto",
      Text: "Texto",
      HTML: "<p>Texto</p>",
    });
  });

  it("is Resend with the key and the sender when MAIL_DRIVER says so", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await getMailSender({ MAIL_DRIVER: "resend", RESEND_API_KEY: "re_clave", MAIL_FROM: "Tiza <hola@usetiza.app>" }).send(MESSAGE);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer re_clave");
    expect(JSON.parse(String(init?.body))).toMatchObject({ from: "Tiza <hola@usetiza.app>", to: ["profe@colegio.test"], subject: "Asunto" });
  });

  it("in production Resend needs its key and its sender; a local Mailpit needs neither", () => {
    expect(() => getMailSender({ NODE_ENV: "production" })).toThrow(/RESEND_API_KEY/);
    expect(() => getMailSender({ NODE_ENV: "production", MAIL_DRIVER: "resend", RESEND_API_KEY: "re_clave" })).toThrow(/MAIL_FROM/);
    expect(() => getMailSender({ NODE_ENV: "production", MAIL_DRIVER: "mailpit" })).not.toThrow();
    expect(() => getMailSender({ NODE_ENV: "production", MAIL_DRIVER: "mailpit", MAIL_MAILPIT_URL: "http://localhost:54324" })).not.toThrow();
  });

  it("in production Mailpit outside localhost is refused", () => {
    expect(() => getMailSender({ NODE_ENV: "production", MAIL_DRIVER: "mailpit", MAIL_MAILPIT_URL: "https://correo.example.com" })).toThrow(/MAIL_MAILPIT_URL/);
  });

  it("Resend without key or sender is an error outside production too, and so is an unknown driver", () => {
    expect(() => getMailSender({ MAIL_DRIVER: "resend" })).toThrow();
    expect(() => getMailSender({ MAIL_DRIVER: "resend", RESEND_API_KEY: "re_clave" })).toThrow(/MAIL_FROM/);
    expect(() => getMailSender({ MAIL_DRIVER: "otro" })).toThrow(/MAIL_DRIVER/);
  });

  it("a provider that answers an error is UNAVAILABLE with a text for the admin, and logs only the status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("el correo profe@colegio.test fue rechazado", { status: 422 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = await getMailSender({ MAIL_DRIVER: "resend", RESEND_API_KEY: "re_clave", MAIL_FROM: "Tiza <hola@usetiza.app>" })
      .send(MESSAGE)
      .catch((thrown: unknown) => thrown);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: "UNAVAILABLE", message: "No pudimos mandar el correo. Probá de nuevo en un rato." });
    const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain('"providerStatus":422');
    expect(logged).not.toContain("profe@colegio.test");
  });

  it("a provider that does not answer is UNAVAILABLE too", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(getMailSender({ NODE_ENV: "test" }).send(MESSAGE)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("readSender", () => {
  it("reads a named sender and a bare address, and refuses anything else", () => {
    expect(readSender({ MAIL_FROM: "Tiza <hola@usetiza.app>" })).toMatchObject({ name: "Tiza", email: "hola@usetiza.app" });
    expect(readSender({ MAIL_FROM: "hola@usetiza.app" })).toMatchObject({ name: "", email: "hola@usetiza.app" });
    expect(() => readSender({ MAIL_FROM: "sin direccion" })).toThrow();
  });
});
