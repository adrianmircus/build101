import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { checkAccessibility } from "./support/a11y";

// Recorridos de punta a punta del login del profe, recuperar la contraseña y la invitación (T2.4).
//
// SE ACTIVAN AL CERRAR LA TANDA 2: hoy los servicios de lib/server/services/{staff-auth,invitations}.ts son stubs que
// responden UNAVAILABLE, y estos recorridos necesitan cuentas reales. Al activarlos hace falta una base local con:
//   E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD  una cuenta de profe con membresía
//   E2E_RECOVERY_URL                      el enlace /ingresar/profesor/nueva#<hash> de un correo de recuperación recién pedido
//   E2E_INVITE_NEW_URL, E2E_INVITE_ACCOUNT_URL, E2E_INVITE_EXPIRED_URL  enlaces /invitacion#<token> en cada caso
// Los enlaces con token se generan en cada corrida (sirven una vez); la sección «Pruebas de la fase» del contrato dice cómo.

const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL ?? "";
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD ?? "";

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
  test.skip("faltan datos: el error está al lado de cada campo y el foco va al mensaje", async ({ page }) => {
    await page.goto("/ingresar/profesor");
    await page.getByRole("button", { name: "Ingresar" }).click();
    const alert = alertBox(page);
    await expect(alert).toBeFocused();
    await expect(alert).toContainText("Falta completar 2 datos");
    await expect(page.getByLabel("Correo")).toHaveAccessibleDescription(/Escribí tu correo/);
    await expect(page.getByLabel("Contraseña", { exact: true })).toHaveAccessibleDescription(/Escribí tu contraseña/);
    await checkAccessibility(page, "login del profe con errores");
  });

  test.skip("credenciales que no coinciden: error genérico con el enlace a crear una contraseña nueva", async ({ page }) => {
    await page.goto("/ingresar/profesor");
    await fillLogin(page, STAFF_EMAIL, "una contraseña que no es");
    const alert = alertBox(page);
    await expect(alert).toBeFocused();
    await expect(alert).toContainText("El correo o la contraseña no coinciden.");
    await expect(page.getByLabel("Correo")).toHaveValue(STAFF_EMAIL);
    await alert.getByRole("link", { name: "creá una contraseña nueva" }).click();
    await expect(page).toHaveURL(/\/ingresar\/profesor\/olvide$/);
  });

  test.skip("demasiados intentos: pausa con la hora local para volver", async ({ page }) => {
    await page.goto("/ingresar/profesor");
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await fillLogin(page, STAFF_EMAIL, `intento incorrecto ${attempt}`);
      if (await page.getByRole("heading", { name: "Esperá unos minutos" }).isVisible()) break;
    }
    await expect(alertBox(page)).toContainText(/volver a intentar (a las|el) .*\d{2}:\d{2}/);
    await expect(page.getByRole("link", { name: "Crear una contraseña nueva" })).toBeVisible();
  });

  test.skip("entra y llega a /grupos", async ({ page }) => {
    await page.goto("/ingresar/profesor");
    await fillLogin(page, STAFF_EMAIL, STAFF_PASSWORD);
    await expect(page).toHaveURL(/\/grupos/);
  });
});

test.describe("recuperar la contraseña", () => {
  test.skip("pedir el enlace siempre dice lo mismo, exista o no la cuenta", async ({ page }) => {
    for (const email of [STAFF_EMAIL, "nadie@no-existe.example"]) {
      await page.goto("/ingresar/profesor/olvide");
      await page.getByLabel("Correo").fill(email);
      await page.getByRole("button", { name: "Mandarme el enlace" }).click();
      await expect(page.getByRole("status")).toContainText("Si hay una cuenta con");
    }
  });

  test.skip("el enlace del correo borra el token de la barra y deja elegir la contraseña nueva", async ({ page }) => {
    await page.goto(process.env.E2E_RECOVERY_URL ?? "/ingresar/profesor/nueva");
    await expect(page.getByRole("heading", { name: "Elegí tu contraseña nueva" })).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
    await page.getByLabel("Contraseña nueva").fill("corta");
    await page.getByLabel("Repetí la contraseña").fill("corta");
    await page.getByRole("button", { name: "Guardar y entrar" }).click();
    await expect(alertBox(page)).toBeFocused();
    await expect(alertBox(page)).toContainText("Le faltan 5 caracteres");
    await page.getByLabel("Contraseña nueva").fill("una frase para acordarme");
    await page.getByLabel("Repetí la contraseña").fill("una frase para acordarme");
    await page.getByRole("button", { name: "Guardar y entrar" }).click();
    await expect(page).toHaveURL(/\/grupos/);
  });

  test.skip("un enlace vencido o sin token muestra el estado vencido", async ({ page }) => {
    await page.goto("/ingresar/profesor/nueva");
    await expect(page.getByRole("heading", { name: "Este enlace ya no sirve" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pedir un enlace nuevo" })).toBeVisible();
    await checkAccessibility(page, "recuperar contraseña, enlace vencido");
  });
});

test.describe("invitación", () => {
  test.skip("sin cuenta: crea la cuenta con el correo de la invitación y queda dentro", async ({ page }) => {
    await page.goto(process.env.E2E_INVITE_NEW_URL ?? "/invitacion");
    expect(new URL(page.url()).hash).toBe("");
    await expect(page.getByRole("heading", { name: /te invitó a sumarte a/ })).toBeVisible();
    await expect(page.getByLabel("Correo")).not.toBeEditable();
    await page.getByLabel("Nombre y apellido").fill("Ana Pérez");
    await page.getByLabel("Contraseña", { exact: true }).fill("una frase para acordarme");
    await page.getByRole("button", { name: "Crear cuenta y sumarme" }).click();
    await expect(page.getByRole("status")).toContainText("Ya sos parte de");
    await checkAccessibility(page, "invitación aceptada");
  });

  test.skip("con cuenta y sin sesión: entra para aceptar", async ({ page }) => {
    await page.goto(process.env.E2E_INVITE_ACCOUNT_URL ?? "/invitacion");
    await expect(page.getByRole("heading", { name: "Entrá para aceptar" })).toBeVisible();
    await page.getByLabel("Contraseña", { exact: true }).fill(STAFF_PASSWORD);
    await page.getByRole("button", { name: "Entrar y sumarme" }).click();
    await expect(page.getByRole("status")).toContainText("Ya sos parte de");
  });

  test.skip("con sesión de otro correo: marca el choque y ofrece salir y entrar con el correo de la invitación", async ({ page }) => {
    await page.goto("/ingresar/profesor");
    await fillLogin(page, STAFF_EMAIL, STAFF_PASSWORD);
    await page.goto(process.env.E2E_INVITE_NEW_URL ?? "/invitacion");
    await expect(page.getByText("No es el correo con el que entraste")).toBeVisible();
    await page.getByRole("button", { name: /Salir y entrar con/ }).click();
    await expect(page.getByRole("heading", { name: /te invitó a sumarte a|Entrá para aceptar/ })).toBeVisible();
  });

  test.skip("vencida: lo dice y no muestra el correo", async ({ page }) => {
    await page.goto(process.env.E2E_INVITE_EXPIRED_URL ?? "/invitacion");
    await expect(page.getByRole("heading", { name: "Esta invitación venció" })).toBeVisible();
  });

  test.skip("sin token en el enlace: pide abrirla desde el correo", async ({ page }) => {
    await page.goto("/invitacion");
    await expect(page.getByRole("heading", { name: "Falta algo en este enlace" })).toBeVisible();
  });

  test.skip("a 320 px no hay scroll horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const path of ["/ingresar/profesor", "/ingresar/profesor/olvide", "/ingresar/profesor/nueva", "/invitacion"]) {
      await page.goto(path);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(scrollWidth, path).toBeLessThanOrEqual(clientWidth);
    }
  });
});
