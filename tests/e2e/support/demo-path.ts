import type { Page } from "@playwright/test";
import { bubble, expectStep, tapInBubble } from "./tour";
import { expect } from "./fixtures";

// «Seguir» tapped like a mouse or a finger would: these helpers are only the way to get to the step a test is about.
async function seguir(page: Page, title: string) {
  await tapInBubble(page, await expectStep(page, title), "Seguir");
}

// Enters the demo and goes to the first step that needs a page change: «Cada estudiante, su perfil».
export async function walkToProfiles(page: Page) {
  await page.goto("/demo");
  const welcome = await expectStep(page, "Sos profe de matemática de 6.º");
  await welcome.getByRole("button", { name: "Empezar" }).click();
  await expectStep(page, "Entrá a tu grupo");
  await page.getByRole("link", { name: /Grupo demo/ }).click();
  await expectStep(page, "Cada estudiante, su perfil");
}

// From there to «Cada cambio, con su porqué», generating the versions with the mouse.
export async function walkToChanges(page: Page) {
  await walkToProfiles(page);
  await seguir(page, "Cada estudiante, su perfil");
  await expectStep(page, "Cargá un práctico");
  await page.getByRole("link", { name: "Nuevo práctico o parcial" }).click();
  await seguir(page, "El práctico de siempre");
  await seguir(page, "Tres versiones, no una por alumno");
  await expectStep(page, "Generá las versiones");
  await page.getByRole("button", { name: "Generar 3 versiones" }).click();
  await expect(bubble(page, "Cada cambio, con su porqué").or(bubble(page, "Un agente por perfil"))).toBeVisible();
  await expectStep(page, "Cada cambio, con su porqué");
}

// From «Cada cambio, con su porqué» to «Para responder con la mirada» (the tab of Paula's version).
export async function walkToGazeQuestions(page: Page) {
  await walkToChanges(page);
  await seguir(page, "Cada cambio, con su porqué");
  await expectStep(page, "Ahora, la versión de Paula");
  await page.getByRole("button", { name: /^Motriz/ }).click();
  await expectStep(page, "Para responder con la mirada");
}
