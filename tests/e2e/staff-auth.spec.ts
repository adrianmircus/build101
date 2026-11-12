import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { newTeacher } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { checkAccessibility } from "./support/a11y";
import { recoveryToken, waitForMail } from "./support/mail";
import { world } from "./support/world";

// Recorridos de punta a punta del login del profe, recuperar la contraseña y la invitación (T2.4, T2.10).
// Corren contra el Supabase local y Mailpit, con el colegio, el admin y el profe que crea el global setup en cada corrida
// (tests/e2e/support/global-setup.ts). Los que cambian una contraseña o gastan intentos usan un profe propio: ningún test comparte cuenta.
// Las invitaciones con un token (profe nuevo, con cuenta, de otro correo) se recorren en institution.spec.ts, que es donde un admin invita.

// The route announcer of Next is also role=alert: it is left out so the locator is one element.
function alertBox(page: Page) {
  return page.locator("[role=alert]:not(#__next-route-announcer__)");
}

async function fillLogin(page: Page, email: string, password: string) {
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

test.describe("login del profe", () => {
  test("faltan datos: el error está al lado de cada campo y el foco va al mensaje", async ({ page }) => {
    await page.goto("/ingresar/profesor");
    await page.getByRole("button", { name: "Ingresar" }).click();
    const alert = alertBox(page);
    await expect(alert).toBeFocused();
    await expect(alert).toContainText("Falta completar 2 datos");
    await expect(page.getByLabel("Correo")).toHaveAccessibleDescription(/Escribí tu correo/);
    await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAccessibleDescription(/Escribí tu contraseña/);
    await checkAccessibility(page, "login del profe con errores");
  });

  test("credenciales que no coinciden: error genérico con el enlace a crear una contraseña nueva", async ({ page }) => {
    const teacher = await newTeacher();
    await page.goto("/ingresar/profesor");
    await fillLogin(page, teacher.email, "una contraseña que no es");
    const alert = alertBox(page);
    await expect(alert).toBeFocused();
    await expect(alert).toContainText("El correo o la contraseña no coinciden.");
    await expect(page.getByLabel("Correo")).toHaveValue(teacher.email);
    await alert.getByRole("link", { name: "creá una contraseña nueva" }).click();
    await expect(page).toHaveURL(/\/ingresar\/profesor\/olvide$/);
  });

  test("demasiados intentos: pausa con la hora local para volver", async ({ page }) => {
    const teacher = await newTeacher();
    await page.goto("/ingresar/profesor");
    // The limit of attempts (T2.7) counts before trying: after ten wrong ones from the same address the pause comes.
    const pause = page.getByRole("heading", { name: "Esperá unos minutos" });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      // A click on a button still busy with the last attempt does nothing: each one starts when the form is ready again.
      await expect(page.getByRole("button", { name: "Ingresar" })).toBeEnabled();
      const answered = page.waitForResponse((response) => response.request().method() === "POST");
      await fillLogin(page, teacher.email, `intento incorrecto ${attempt}`);
      await answered;
      if (await pause.waitFor({ timeout: 2_000 }).then(() => true, () => false)) break;
    }
    await expect(pause).toBeVisible();
    await expect(alertBox(page)).toContainText(/volver a intentar (a las|el) .*\d{2}:\d{2}/);
    await expect(page.getByRole("link", { name: "Crear una contraseña nueva" })).toBeVisible();
  });

  test("entra, llega a /grupos y sale: sin sesión no vuelve a verlos", async ({ page }) => {
    const { teacher } = world();
    await page.goto("/ingresar/profesor");
    await fillLogin(page, teacher.email, teacher.password);
    await expect(page).toHaveURL(/\/grupos/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(/\/ingresar\/profesor/);
    await page.goto("/grupos");
    await expect(page).toHaveURL(/\/ingresar\/profesor/);
  });
});

test.describe("recuperar la contraseña", () => {
  test("pedir el enlace siempre dice lo mismo, exista o no la cuenta", async ({ page }) => {
    const teacher = await newTeacher();
    for (const email of [teacher.email, `nadie.${randomUUID().slice(0, 8)}@no-existe.example`]) {
      await page.goto("/ingresar/profesor/olvide");
      await page.getByLabel("Correo").fill(email);
      await page.getByRole("button", { name: "Mandarme el enlace" }).click();
      await expect(page.getByRole("status")).toContainText("Si hay una cuenta con");
    }
  });

  test("el correo de Mailpit trae el enlace: borra el token de la barra, deja elegir la contraseña y entra con la nueva", async ({ page }) => {
    const teacher = await newTeacher();
    await page.goto("/ingresar/profesor/olvide");
    await page.getByLabel("Correo").fill(teacher.email);
    await page.getByRole("button", { name: "Mandarme el enlace" }).click();
    await expect(page.getByRole("status")).toContainText("Si hay una cuenta con");

    // The host of the link is the SiteURL of the Supabase config (not this server's), so only the token is taken from the mail.
    const token = recoveryToken(await waitForMail(teacher.email));
    await page.goto(`/ingresar/profesor/nueva#${token}`);
    await expect(page.getByRole("heading", { name: "Elegí tu contraseña nueva" })).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
    await checkAccessibility(page, "recuperar contraseña, elegir la nueva");

    await page.getByLabel("Contraseña nueva").fill("corta");
    await page.getByLabel("Repetí la contraseña").fill("corta");
    await page.getByRole("button", { name: "Guardar y entrar" }).click();
    await expect(alertBox(page)).toBeFocused();
    await expect(alertBox(page)).toContainText("Le faltan 5 caracteres");

    const fresh = "una frase para acordarme";
    await page.getByLabel("Contraseña nueva").fill(fresh);
    await page.getByLabel("Repetí la contraseña").fill(fresh);
    await page.getByRole("button", { name: "Guardar y entrar" }).click();
    await expect(page).toHaveURL(/\/grupos/);

    // The link serves once; the old password stops working; the new one enters.
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(/\/ingresar\/profesor/);
    await page.goto(`/ingresar/profesor/nueva#${token}`);
    await expect(page.getByRole("heading", { name: "Este enlace ya no sirve" })).toBeVisible();
    await page.goto("/ingresar/profesor");
    await fillLogin(page, teacher.email, teacher.password);
    await expect(alertBox(page)).toContainText("El correo o la contraseña no coinciden.");
    await fillLogin(page, teacher.email, fresh);
    await expect(page).toHaveURL(/\/grupos/);
  });

  test("un enlace vencido o sin token muestra el estado vencido", async ({ page }) => {
    await page.goto("/ingresar/profesor/nueva");
    await expect(page.getByRole("heading", { name: "Este enlace ya no sirve" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pedir un enlace nuevo" })).toBeVisible();
    await checkAccessibility(page, "recuperar contraseña, enlace vencido");
  });
});

test.describe("invitación", () => {
  test("sin token en el enlace: pide abrirla desde el correo", async ({ page }) => {
    await page.goto("/invitacion");
    await expect(page.getByRole("heading", { name: "Falta algo en este enlace" })).toBeVisible();
  });

  test("a 320 px no hay scroll horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ["/ingresar/profesor", "/ingresar/profesor/olvide", "/ingresar/profesor/nueva", "/invitacion"]) {
      await page.goto(path);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(scrollWidth, path).toBeLessThanOrEqual(clientWidth);
    }
  });
});
