import type { Page } from "@playwright/test";
import { checkAccessibility } from "./support/a11y";
import { expect, test } from "./support/fixtures";
import { createGroupWithStudents, emulatePrint, issueCards, panelPath, printCalls, qrPathFor, readPrintedCards, signInAsAdmin, uniqueFirstName } from "./support/panel";
import { world } from "./support/world";

// Recorridos del admin con las cuentas de los estudiantes (T2.9, T2.10): crear el grupo y las cuentas en el panel e imprimir las tarjetas.
// Corren contra el Supabase local, con el colegio y el admin que crea el global setup (tests/e2e/support/global-setup.ts).
// Cada test usa nombres que nadie más usa: corren en paralelo, en escritorio y en celular.

// The route announcer of Next is also role=alert: it is left out so the locator is one element.
function alertBox(page: Page) {
  return page.locator("[role=alert]:not(#__next-route-announcer__)");
}

test.describe("crear cuentas de estudiantes", () => {
  test("pegar nombres, revisar los usuarios (con repetidos), cambiar uno y crear", async ({ page }) => {
    const first = uniqueFirstName();
    const a = `${first} Fagúndez`;
    const b = `${first} Ferreira`;
    await signInAsAdmin(page);
    await page.goto(panelPath("/crear-cuentas"));
    await page.getByLabel("Grupo").selectOption({ label: `${world().group.name} · Matemática 2027` });
    await page.getByLabel("Nombres y apellidos").fill(`${a}\n${b}`);
    await page.getByRole("button", { name: "Revisar" }).click();
    await expect(page.getByRole("heading", { name: "Revisá los usuarios" })).toBeFocused();
    // Two people with the same first name and initial: the second one gets a number.
    const username = first.toLowerCase() + "f";
    await expect(page.getByLabel(`Usuario de ${a}`)).toHaveValue(username);
    await expect(page.getByLabel(`Usuario de ${b}`)).toHaveValue(`${username}2`);
    await page.getByLabel(`Usuario de ${b}`).fill(username);
    await page.getByRole("button", { name: "Crear 2 cuentas" }).click();
    await expect(alertBox(page)).toContainText("Hay 2 usuarios para corregir");
    await expect(page.getByLabel(`Usuario de ${b}`)).toHaveAccessibleDescription(/repetido/);
    await checkAccessibility(page, "crear cuentas, revisar con repetidos");
    await page.getByLabel(`Usuario de ${b}`).fill(`${username}x`);
    await page.getByRole("button", { name: "Crear 2 cuentas" }).click();
    await expect(page.getByRole("heading", { name: "Listas las 2 cuentas" })).toBeFocused();
    await expect(page.getByRole("link", { name: "Imprimir tarjetas" })).toHaveAttribute("href", /\/grupos\/.+\/tarjetas$/);
  });

  test("crear un grupo nuevo: nombre, materia y año", async ({ page }) => {
    const first = uniqueFirstName();
    await signInAsAdmin(page);
    await page.goto(panelPath("/crear-cuentas"));
    await page.getByLabel("Grupo").selectOption("nuevo");
    await page.getByLabel("Nombre del grupo").fill("6.º C");
    await expect(page.getByLabel("Materia")).toContainText("Matemática");
    await page.getByLabel("Nombres y apellidos").fill(`${first} Rodríguez`);
    await page.getByRole("button", { name: "Revisar" }).click();
    await expect(page.getByLabel(`Usuario de ${first} Rodríguez`)).toHaveValue(`${first.toLowerCase()}r`);
  });

  test("faltan datos: el resumen enlaza a cada campo", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(panelPath("/crear-cuentas"));
    await page.getByLabel("Grupo").selectOption("nuevo");
    await page.getByRole("button", { name: "Revisar" }).click();
    await expect(alertBox(page)).toBeFocused();
    await alertBox(page).getByRole("link", { name: /nombre del grupo/ }).click();
    await expect(page.getByLabel("Nombre del grupo")).toBeFocused();
  });
});

test.describe("imprimir las tarjetas", () => {
  test("crea un grupo con estudiantes e imprime: las contraseñas están en la hoja y no en la pantalla", async ({ page }) => {
    await emulatePrint(page);
    const names = [`${uniqueFirstName()} Fagúndez`, `${uniqueFirstName()} Silva`];
    await signInAsAdmin(page);
    const group = await createGroupWithStudents(page, names, `Grupo ${uniqueFirstName()}`);
    const { cards, qrLinks } = await issueCards(page);

    // The browser was asked to print once, with a function of ours instead of the dialog.
    expect(await printCalls(page)).toBe(1);
    expect(cards).toHaveLength(2);
    expect(qrLinks).toHaveLength(2);
    for (const student of group.students) {
      const card = cards.find((one) => one.username === student.username);
      expect(card, `la tarjeta de ${student.name}`).toBeDefined();
      expect(card?.schoolCode).toBe(world().institution.code);
      expect(card?.hello).toBe(student.name.split(" ")[0]);
      expect(card?.footer).toContain(student.name);
      expect(card?.footer).toContain(group.groupName);
      // Four words and a number: the format of the password of the card.
      expect(card?.password).toMatch(/^[a-zñ]+(-[a-zñ]+)+-\d+$/);
    }
    // Each card draws the QR of its own link (the QR is a drawing: the link is the one the server answered).
    const drawn = new Set(cards.map((card) => card.qrPath));
    for (const link of qrLinks) expect(drawn.has(qrPathFor(link)), "un QR no corresponde a ningún enlace").toBe(true);
    expect(new Set(qrLinks.map((link) => new URL(link).hash)).size).toBe(2);

    // On the screen there is no password: the sheet is display: none (the screen reader does not read it either).
    const screenText = await page.locator("body").innerText();
    for (const card of cards) expect(screenText).not.toContain(card.password);
    await expect(page.locator("[data-print-sheets]")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Las 2 tarjetas están listas" })).toBeVisible();
    // Printing again does not make new passwords.
    await page.getByRole("button", { name: "Imprimir de nuevo" }).click();
    await expect.poll(() => printCalls(page)).toBe(2);
    expect(await readPrintedCards(page)).toEqual(cards);
    // For paper the sheet does show: two cards, with the passwords.
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("[data-print-sheets]")).toBeVisible();
    expect(await page.locator("[data-print-sheets] article").count()).toBe(2);
    await page.emulateMedia({ media: "screen" });
    // «Listo» drops the passwords from the page.
    await page.getByRole("button", { name: "Listo" }).click();
    await expect(page.locator("[data-print-sheets]")).toHaveCount(0);
  });
});

