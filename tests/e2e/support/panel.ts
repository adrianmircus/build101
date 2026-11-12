import { randomInt } from "node:crypto";
import type { Page } from "@playwright/test";
import { encodeQr, qrPathData } from "../../../lib/client/qr";
import { expect } from "./fixtures";
import { invitationToken, waitForMail } from "./mail";
import { world } from "./world";

// What the specs of the panel and of the student share: entering as the admin, inviting from the panel, and making a group of
// students with their printed cards. Everything goes through the screens, as a person would.

export async function signInAsAdmin(page: Page) {
  const { admin } = world();
  await page.goto("/ingresar/profesor");
  await page.getByLabel("Correo").fill(admin.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/grupos/);
}

export const panelPath = (path = "") => `/institucion/${world().institution.id}${path}`;

/** Invites those emails from the panel (as the admin who is already in) and returns the token of each one, read from Mailpit. */
export async function inviteFromPanel(page: Page, emails: string[], role: "Profe" | "Admin" | "Inclusión" = "Profe"): Promise<Map<string, string>> {
  await page.goto(panelPath("/invitar"));
  await page.getByLabel("Correos").fill(emails.join("\n"));
  await page.getByRole("radio", { name: new RegExp(`^${role}`) }).check();
  await page.getByRole("button", { name: "Revisar" }).click();
  await expect(page.getByRole("heading", { name: "Revisá antes de mandar" })).toBeFocused();
  await page.getByRole("button", { name: /^Mandar \d+ invitaci/ }).click();
  await expect(page.getByRole("status")).toContainText(/Mandamos \d+ invitaci/);
  const tokens = new Map<string, string>();
  for (const email of emails) tokens.set(email, invitationToken(await waitForMail(email)));
  return tokens;
}

/** A first name nobody else in the run has, so two tests (or two projects) never ask for the same username. */
export function uniqueFirstName(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const word = Array.from({ length: 6 }, () => letters[randomInt(0, letters.length)]).join("");
  return `Lu${word}`;
}

export type PrintedCard = { hello: string; schoolCode: string; username: string; password: string; footer: string; qrPath: string };

/** Counts the calls to window.print instead of opening the dialog of the browser. Call it before the first goto. */
export async function emulatePrint(page: Page) {
  await page.addInitScript(() => {
    Reflect.set(window, "__printCalls", 0);
    window.print = () => Reflect.set(window, "__printCalls", Number(Reflect.get(window, "__printCalls")) + 1);
  });
}

export const printCalls = (page: Page): Promise<number> => page.evaluate(() => Number(Reflect.get(window, "__printCalls")));

/** The cards of the print block: the only place of the page where the passwords exist (it is display: none on the screen). */
export async function readPrintedCards(page: Page): Promise<PrintedCard[]> {
  return page.locator("[data-print-sheets] article").evaluateAll((articles) =>
    articles.map((article) => {
      const entry = (label: string) => [...article.querySelectorAll("dl > div")].find((row) => row.querySelector("dt")?.textContent === label)?.querySelector("dd")?.textContent ?? "";
      const paths = [...article.querySelectorAll("svg path")];
      return {
        hello: (article.querySelector("p")?.textContent ?? "").replace(/^Hola, /, ""),
        schoolCode: entry("Código del colegio"),
        username: entry("Usuario"),
        password: entry("Contraseña"),
        footer: article.querySelector("p:last-of-type")?.textContent ?? "",
        qrPath: paths[1]?.getAttribute("d") ?? "",
      };
    }),
  );
}

/** The QR as the browser draws it for a link: what the card of this link must have printed. */
export const qrPathFor = (url: string): string => qrPathData(encodeQr(url), 1);

export type CreatedGroup = { groupName: string; students: { name: string; username: string }[] };

/** From the panel: a new group with these students (the usernames are read from the review, as the admin would). */
export async function createGroupWithStudents(page: Page, names: string[], groupName: string): Promise<CreatedGroup> {
  await page.goto(panelPath("/crear-cuentas"));
  await page.getByLabel("Grupo").selectOption("nuevo");
  await page.getByLabel("Nombre del grupo").fill(groupName);
  await page.getByLabel("Nombres y apellidos").fill(names.join("\n"));
  await page.getByRole("button", { name: "Revisar" }).click();
  await expect(page.getByRole("heading", { name: "Revisá los usuarios" })).toBeFocused();
  const students = [];
  for (const name of names) students.push({ name, username: await page.getByLabel(`Usuario de ${name}`).inputValue() });
  await page.getByRole("button", { name: names.length === 1 ? "Crear 1 cuenta" : `Crear ${names.length} cuentas` }).click();
  await expect(page.getByRole("heading", { name: names.length === 1 ? "Lista la cuenta" : `Listas las ${names.length} cuentas` })).toBeFocused();
  return { groupName, students };
}

/**
 * On the cards page of the group: asks for the passwords, confirms and waits for the sheet. It returns what the sheet printed, plus the
 * QR links the server answered (the QR is only drawn, never written as text: the link is read from the answer of the action).
 */
export async function issueCards(page: Page): Promise<{ cards: PrintedCard[]; qrLinks: string[] }> {
  const qrLinks: string[] = [];
  page.on("response", async (response) => {
    if (response.request().method() !== "POST" || !response.url().includes("/tarjetas")) return;
    const text = await response.text().catch(() => "");
    for (const match of text.matchAll(/"qrUrl":"([^"]+)"/g)) qrLinks.push(match[1] ?? "");
  });
  await page.getByRole("link", { name: "Imprimir tarjetas" }).click();
  await expect(page.getByRole("heading", { name: "Tarjetas de acceso" })).toBeVisible();
  await page.getByRole("button", { name: "Crear contraseñas e imprimir" }).click();
  await page.getByRole("button", { name: "Sí, crear e imprimir" }).click();
  await expect(page.getByRole("heading", { name: /tarjetas? (está|están) listas?|La tarjeta está lista/ })).toBeVisible();
  return { cards: await readPrintedCards(page), qrLinks };
}

export type StudentWithCard = { card: PrintedCard; qrLink: string; name: string };

/**
 * A student with a card, made as the admin would (new group, one student, cards printed) and then the admin leaves the browser: what
 * the specs of the student start from. The printed data is what the student has in the hand.
 */
export async function studentWithCard(page: Page): Promise<StudentWithCard> {
  await emulatePrint(page);
  const name = `${uniqueFirstName()} Fagúndez`;
  await signInAsAdmin(page);
  await createGroupWithStudents(page, [name], `Grupo ${uniqueFirstName()}`);
  const { cards, qrLinks } = await issueCards(page);
  const card = cards[0];
  const qrLink = qrLinks[0];
  if (cards.length !== 1 || card === undefined || qrLink === undefined) throw new Error("No salió la tarjeta del estudiante de prueba.");
  await page.context().clearCookies();
  return { card, qrLink, name };
}

/** The link of the QR as the phone opens it: this server, whatever host the link was built with. */
export function qrAddress(qrLink: string): string {
  const url = new URL(qrLink);
  return `${url.pathname}${url.hash}`;
}
