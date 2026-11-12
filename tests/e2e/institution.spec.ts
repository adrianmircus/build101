import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { checkAccessibility } from "./support/a11y";

// Recorridos del panel de la institución (T2.9): invitar profes, crear cuentas de estudiantes y las listas.
//
// SE ACTIVAN EN LA TANDA 4: hoy los servicios de lib/server/services/{institution,invitations,student-accounts}.ts son
// stubs que responden UNAVAILABLE, y estos recorridos necesitan datos reales. Al activarlos hace falta una base local con:
//   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD  una cuenta de admin de un colegio
//   E2E_INSTITUTION_ID                    el id de ese colegio
//   E2E_MEMBER_EMAIL                      el correo de un profe que ya está en ese colegio
//   E2E_PENDING_EMAIL                     el correo de una invitación pendiente de ese colegio
// y un grupo «4.º B» de matemática con una estudiante «Lucía Fernández» (usuario luciaf) ya creada.

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
const INSTITUTION = process.env.E2E_INSTITUTION_ID ?? "";
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL ?? "";
const PENDING_EMAIL = process.env.E2E_PENDING_EMAIL ?? "";

// The route announcer of Next is also role=alert: it is left out so the locator is one element.
function alertBox(page: Page) {
  return page.locator("[role=alert]:not(#__next-route-announcer__)");
}

async function signInAsAdmin(page: Page) {
  await page.goto("/ingresar/profesor");
  await page.getByLabel("Correo").fill(ADMIN_EMAIL);
  await page.getByLabel("Contraseña", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/grupos/);
}

async function expectNoHorizontalScroll(page: Page, where: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(scrollWidth, `${where}: la página se pasa del ancho`).toBeLessThanOrEqual(clientWidth);
}

test.describe.skip("panel de la institución", () => {
  test("/institucion lleva al único colegio donde es admin y muestra las dos acciones y el resumen", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/institucion");
    await expect(page).toHaveURL(new RegExp(`/institucion/${INSTITUTION}$`));
    await expect(page.getByRole("link", { name: "Invitar profes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Crear cuentas de estudiantes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver profes e invitaciones" })).toBeVisible();
    await checkAccessibility(page, "panel de la institución, inicio");
  });

  test("alguien que no es admin de ese colegio ve el aviso y no los datos", async ({ page }) => {
    await page.goto("/ingresar/profesor");
    await page.getByLabel("Correo").fill(process.env.E2E_TEACHER_EMAIL ?? "");
    await page.getByLabel("Contraseña", { exact: true }).fill(process.env.E2E_TEACHER_PASSWORD ?? "");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await page.goto(`/institucion/${INSTITUTION}`);
    await expect(page.getByRole("heading", { name: "Esta página es para admins del colegio" })).toBeVisible();
  });
});

test.describe.skip("invitar profes", () => {
  test("pegar, revisar (mal escrito, repetido, ya es miembro) y mandar solo los que van", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`/institucion/${INSTITUTION}/invitar`);
    const nuevo = `profe.nuevo.${Date.now()}@sanjose.edu.uy`;
    await page.getByLabel("Correos").fill([nuevo, MEMBER_EMAIL, "pablo.ferreira@sanjose", nuevo].join("\n"));
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
    await page.goto(`/institucion/${INSTITUTION}/invitar`);
    await page.getByRole("button", { name: "Revisar" }).click();
    await expect(alertBox(page)).toBeFocused();
    await expect(page.getByLabel("Correos")).toHaveAccessibleDescription(/Pegá al menos un correo/);
  });

  test("«Corregir» vuelve a los correos sin perder lo pegado", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`/institucion/${INSTITUTION}/invitar`);
    await page.getByLabel("Correos").fill("pablo.ferreira@sanjose");
    await page.getByRole("button", { name: "Revisar" }).click();
    await page.getByRole("button", { name: /Corregir/ }).click();
    await expect(page.getByLabel("Correos")).toHaveValue("pablo.ferreira@sanjose");
  });
});

test.describe.skip("crear cuentas de estudiantes", () => {
  test("pegar nombres, revisar los usuarios (con repetidos), cambiar uno y crear", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`/institucion/${INSTITUTION}/crear-cuentas`);
    await page.getByLabel("Grupo").selectOption({ label: "4.º B · Matemática 2026" });
    await page.getByLabel("Nombres y apellidos").fill("Lucía Fagúndez\nMateo Silva");
    await page.getByRole("button", { name: "Revisar" }).click();
    await expect(page.getByRole("heading", { name: "Revisá los usuarios" })).toBeFocused();
    await expect(page.getByLabel("Usuario de Lucía Fagúndez")).toHaveValue("luciaf2");
    await page.getByLabel("Usuario de Mateo Silva").fill("luciaf2");
    await page.getByRole("button", { name: "Crear 2 cuentas" }).click();
    await expect(alertBox(page)).toContainText("Hay 2 usuarios para corregir");
    await expect(page.getByLabel("Usuario de Mateo Silva")).toHaveAccessibleDescription(/repetido/);
    await checkAccessibility(page, "crear cuentas, revisar con repetidos");
    await page.getByLabel("Usuario de Mateo Silva").fill("mateos");
    await page.getByRole("button", { name: "Crear 2 cuentas" }).click();
    await expect(page.getByRole("heading", { name: "Listas las 2 cuentas" })).toBeFocused();
    await expect(page.getByRole("link", { name: "Imprimir tarjetas" })).toHaveAttribute("href", /\/grupos\/.+\/tarjetas$/);
  });

  test("crear un grupo nuevo: nombre, materia y año", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`/institucion/${INSTITUTION}/crear-cuentas`);
    await page.getByLabel("Grupo").selectOption("nuevo");
    await page.getByLabel("Nombre del grupo").fill("6.º C");
    await expect(page.getByLabel("Materia")).toContainText("Matemática");
    await page.getByLabel("Nombres y apellidos").fill("Valentina Rodríguez");
    await page.getByRole("button", { name: "Revisar" }).click();
    await expect(page.getByLabel("Usuario de Valentina Rodríguez")).toHaveValue("valentinar");
  });

  test("faltan datos: el resumen enlaza a cada campo", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`/institucion/${INSTITUTION}/crear-cuentas`);
    await page.getByLabel("Grupo").selectOption("nuevo");
    await page.getByRole("button", { name: "Revisar" }).click();
    await expect(alertBox(page)).toBeFocused();
    await alertBox(page).getByRole("link", { name: /nombre del grupo/ }).click();
    await expect(page.getByLabel("Nombre del grupo")).toBeFocused();
  });
});

test.describe.skip("ver profes e invitaciones", () => {
  test("lista profes con «ya entró» e invitaciones con vencimiento; revocar pide confirmar", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(`/institucion/${INSTITUTION}/profes`);
    await expect(page.getByText(/ya entró alguna vez|todavía no entró/).first()).toBeVisible();
    await expect(page.getByText(/vence el|venció el/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /cambiar|rol/i })).toHaveCount(0);
    await page.getByRole("button", { name: new RegExp(`Revocar la invitación de ${PENDING_EMAIL}`) }).click();
    await expect(page.getByRole("button", { name: "No, dejarla" })).toBeFocused();
    await page.getByRole("button", { name: "No, dejarla" }).click();
    await checkAccessibility(page, "profes e invitaciones");
  });
});

test.describe.skip("celular chico (320 px)", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("ninguna pantalla del panel se pasa del ancho", async ({ page }) => {
    await signInAsAdmin(page);
    for (const path of ["", "/invitar", "/crear-cuentas", "/profes", "/grupos"]) {
      await page.goto(`/institucion/${INSTITUTION}${path}`);
      await expectNoHorizontalScroll(page, `/institucion/…${path}`);
    }
  });
});
