import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { newTeacher } from "./support/accounts";
import { checkAccessibility } from "./support/a11y";
import { expect, test } from "./support/fixtures";
import { inviteFromPanel, panelPath, signInAsAdmin } from "./support/panel";
import { world } from "./support/world";

// Recorridos del panel de la institución (T2.9, T2.10): invitar profes, crear cuentas de estudiantes, imprimir las tarjetas y las listas.
// Corren contra el Supabase local y Mailpit, con el colegio y el admin que crea el global setup (tests/e2e/support/global-setup.ts).
// Cada test crea lo suyo (correos, nombres, grupos con nombres que nadie más usa): corren en paralelo, en escritorio y en celular.

// The route announcer of Next is also role=alert: it is left out so the locator is one element.
function alertBox(page: Page) {
  return page.locator("[role=alert]:not(#__next-route-announcer__)");
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth, `${where}: la página se pasa del ancho`).toBeLessThanOrEqual(clientWidth);
}

const freshEmail = (label: string) => `${label}.${randomUUID().replaceAll("-", "").slice(0, 10)}@tiza-e2e.example`;

test.describe("panel de la institución", () => {
  test("/institucion lleva al único colegio donde es admin y muestra las dos acciones y el resumen", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/institucion");
    await expect(page).toHaveURL(new RegExp(`/institucion/${world().institution.id}$`));
    await expect(page.getByRole("link", { name: "Invitar profes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Crear cuentas de estudiantes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver profes e invitaciones" })).toBeVisible();
    await checkAccessibility(page, "panel de la institución, inicio");
  });

  test("alguien que no es admin de ese colegio ve el aviso y no los datos", async ({ page }) => {
    const { teacher } = world();
    await page.goto("/ingresar/profesor");
    await page.getByLabel("Correo").fill(teacher.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(teacher.password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/grupos/);
    await page.goto(panelPath());
    await expect(page.getByRole("heading", { name: "Esta página es para admins del colegio" })).toBeVisible();
  });
});

test.describe("invitar profes", () => {
  test("pegar, revisar (mal escrito, repetido, ya es miembro) y mandar solo los que van", async ({ page }) => {
    const nuevo = freshEmail("profe.nuevo");
    await signInAsAdmin(page);
    await page.goto(panelPath("/invitar"));
    await page.getByLabel("Correos").fill([nuevo, world().teacher.email, "pablo.ferreira@sanjose", nuevo].join("\n"));
    await page.getByRole("button", { name: "Revisar" }).click();
    await expect(page.getByRole("heading", { name: "Revisá antes de mandar" })).toBeFocused();
    const table = page.getByRole("table", { name: "Correos a invitar" });
    await expect(table.getByText("Le falta el final, por ejemplo .edu.uy.")).toBeVisible();
    await expect(table.getByText("Ya está en el colegio con ese rol.")).toBeVisible();
    await expect(table.getByText("Está repetido: se manda una sola vez.")).toBeVisible();
    await checkAccessibility(page, "invitar profes, revisar");
    await page.getByRole("button", { name: "Mandar 1 invitación" }).click();
    await expect(page.getByRole("status")).toContainText("Mandamos 1 invitación");
    await expect(page.getByRole("heading", { name: "Mandamos 1 invitación" })).toBeFocused();
  });

  test("sin correos: el error está al lado del campo y el foco va al mensaje", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(panelPath("/invitar"));
    await page.getByRole("button", { name: "Revisar" }).click();
    await expect(alertBox(page)).toBeFocused();
    await expect(page.getByLabel("Correos")).toHaveAccessibleDescription(/Pegá al menos un correo/);
  });

  test("«Corregir» vuelve a los correos sin perder lo pegado", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(panelPath("/invitar"));
    await page.getByLabel("Correos").fill("pablo.ferreira@sanjose");
    await page.getByRole("button", { name: "Revisar" }).click();
    await page.getByRole("button", { name: /Corregir/ }).click();
    await expect(page.getByLabel("Correos")).toHaveValue("pablo.ferreira@sanjose");
  });
});

test.describe("el profe acepta la invitación desde el correo", () => {
  test("sin cuenta: el admin invita, el correo llega a Mailpit y el profe elige nombre y contraseña y queda adentro", async ({ page, context }) => {
    const email = freshEmail("profe.invitado");
    await signInAsAdmin(page);
    const tokens = await inviteFromPanel(page, [email]);
    // The profe has no session: the admin's goes away and the link is opened from the mail.
    await context.clearCookies();

    await page.goto(`/invitacion#${tokens.get(email)}`);
    await expect(page.getByRole("heading", { name: /te invitó a sumarte a/ })).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
    await expect(page.getByLabel("Correo")).not.toBeEditable();
    await expect(page.getByLabel("Correo")).toHaveValue(email);
    await page.getByLabel("Nombre y apellido").fill("Ana Pérez");
    await page.getByLabel("Contraseña", { exact: true }).fill("una frase para acordarme");
    await checkAccessibility(page, "invitación, crear cuenta");
    await page.getByRole("button", { name: "Crear cuenta y sumarme" }).click();
    await expect(page.getByRole("status")).toContainText("Ya sos parte de");
    await checkAccessibility(page, "invitación aceptada");

    // She is inside: her groups open with the session of the invitation, and the same link does not serve again.
    await page.goto("/grupos");
    await expect(page).toHaveURL(/\/grupos/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Salir" }).click();
    await page.goto(`/invitacion#${tokens.get(email)}`);
    await expect(page.getByRole("heading", { name: "Esta invitación ya no sirve" })).toBeVisible();
    // And she enters later with the password she chose.
    await page.goto("/ingresar/profesor");
    await page.getByLabel("Correo").fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill("una frase para acordarme");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/grupos/);
  });

  test("con cuenta y sin sesión: entra con su contraseña para aceptar", async ({ page, context }) => {
    const teacher = await newTeacher();
    await signInAsAdmin(page);
    const tokens = await inviteFromPanel(page, [teacher.email], "Inclusión");
    await context.clearCookies();

    await page.goto(`/invitacion#${tokens.get(teacher.email)}`);
    await expect(page.getByRole("heading", { name: "Entrá para aceptar" })).toBeVisible();
    await page.getByLabel("Contraseña", { exact: true }).fill(teacher.password);
    await page.getByRole("button", { name: "Entrar y sumarme" }).click();
    await expect(page.getByRole("status")).toContainText("Ya sos parte de");
  });

  test("con sesión de otro correo: marca el choque y ofrece salir y entrar con el correo de la invitación", async ({ page, context }) => {
    const email = freshEmail("profe.otro");
    await signInAsAdmin(page);
    const tokens = await inviteFromPanel(page, [email]);
    // Whoever is in this browser is the admin: not the email of the invitation.
    await page.goto(`/invitacion#${tokens.get(email)}`);
    await expect(page.getByText("No es el correo con el que entraste")).toBeVisible();
    await page.getByRole("button", { name: /Salir y entrar con/ }).click();
    await expect(page.getByRole("heading", { name: /te invitó a sumarte a|Entrá para aceptar/ })).toBeVisible();
    expect((await context.cookies()).some((cookie) => cookie.name.startsWith("sb-"))).toBe(false);
  });
});

test.describe("ver profes e invitaciones", () => {
  test("lista profes con «ya entró» e invitaciones con vencimiento; revocar pide confirmar", async ({ page }) => {
    const pending = freshEmail("profe.pendiente");
    await signInAsAdmin(page);
    await inviteFromPanel(page, [pending]);
    await page.goto(panelPath("/profes"));
    await expect(page.getByText(/ya entró alguna vez|todavía no entró/).first()).toBeVisible();
    await expect(page.getByText(/vence el|venció el/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /cambiar|rol/i })).toHaveCount(0);
    await page.getByRole("button", { name: new RegExp(`Revocar la invitación de ${pending}`) }).click();
    await expect(page.getByRole("button", { name: "No, dejarla" })).toBeFocused();
    await page.getByRole("button", { name: "No, dejarla" }).click();
    await checkAccessibility(page, "profes e invitaciones");
  });
});

test.describe("celular chico (320 px)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("ninguna pantalla del panel se pasa del ancho", async ({ page }) => {
    await signInAsAdmin(page);
    for (const path of ["", "/invitar", "/crear-cuentas", "/profes", "/grupos"]) {
      await page.goto(panelPath(path));
      await expectNoHorizontalScroll(page, `/institucion/…${path}`);
    }
  });
});
