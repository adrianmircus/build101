import type { Locator, Page } from "@playwright/test";
import { checkAccessibility } from "./support/a11y";
import { expect, test } from "./support/fixtures";
import { bubble, expectStep, expectVisibleFocus, tapInBubble } from "./support/tour";

// Tabs like a keyboard user does until the target has focus. Focus does not start in the tour's bubble on steps with
// a highlighted element, so it can take a few dozen presses to get across the page.
async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 80 && !(await target.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expectVisibleFocus(target);
}

test("recorrido completo de la demo guiada", async ({ page }) => {
  await test.step("Landing: entrar por «Probar la demo»", async () => {
    // The landing reveals its sections with a fade on scroll: axe would read half-faded text as low contrast.
    // So the landing is checked with reduced motion, and the tour below runs with its animations.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await checkAccessibility(page, "landing");
    await page.emulateMedia({ reducedMotion: null });
    await page.getByRole("link", { name: "Probar la demo" }).first().click();
  });

  await test.step("Etapa 1: tu grupo", async () => {
    let dialog = await expectStep(page, "Sos profe de matemática de 6.º", { takesFocus: true });
    await expect(page.getByRole("heading", { level: 1, name: "Mis grupos" })).toBeVisible();
    await checkAccessibility(page, "bienvenida");
    await tapInBubble(page, dialog, "Empezar");

    // From here to the generation, only the keyboard: Tab, Enter and Space.
    await expectStep(page, "Entrá a tu grupo");
    await checkAccessibility(page, "mis grupos");
    await tabTo(page, page.getByRole("link", { name: /Grupo demo/ }));
    await page.keyboard.press("Enter");

    dialog = await expectStep(page, "Cada estudiante, su perfil");
    await expect(page.getByRole("heading", { level: 1, name: "Grupo demo" })).toBeVisible();
    for (const name of ["Lucas", "Paula", "Tomás"]) await expect(page.getByText(name).first()).toBeVisible();
    await checkAccessibility(page, "grupo");
    await tabTo(page, dialog.getByRole("button", { name: "Seguir" }));
    await page.keyboard.press("Enter");
  });

  await test.step("Etapa 2: el práctico", async () => {
    await expectStep(page, "Cargá un práctico");
    await tabTo(page, page.getByRole("link", { name: "Nuevo práctico o parcial" }));
    await page.keyboard.press("Enter");

    let dialog = await expectStep(page, "El práctico de siempre");
    await expect(page.getByRole("heading", { level: 1, name: "Nuevo práctico o parcial para Grupo demo" })).toBeVisible();
    await checkAccessibility(page, "nuevo práctico");
    await tabTo(page, dialog.getByRole("button", { name: "Seguir" }));
    await page.keyboard.press("Enter");

    dialog = await expectStep(page, "Tres versiones, no una por alumno");
    await expect(page.getByRole("heading", { name: "Se van a generar 3 versiones" })).toBeVisible();
    await tabTo(page, dialog.getByRole("button", { name: "Seguir" }));
    await page.keyboard.press("Enter");

    await expectStep(page, "Generá las versiones");
    await tabTo(page, page.getByRole("button", { name: "Generar 3 versiones" }));
    await page.keyboard.press("Space");
  });

  await test.step("Etapa 3: tu revisión", async () => {
    // The versions take real seconds to come back from the fixtures: wait for the state, not for time.
    // "Un agente por perfil" closes by itself as soon as the versions are ready, so on a loaded machine it can be gone
    // before its bubble settles: either it or the next step shows the generation went through.
    await expect(bubble(page, "Un agente por perfil").or(bubble(page, "Cada cambio, con su porqué"))).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Práctico: Límites de funciones" })).toBeVisible();
    let dialog = await expectStep(page, "Cada cambio, con su porqué");
    await expect(page.getByRole("heading", { name: "Versión TDAH" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Falta tu aprobación" })).toBeVisible();
    await checkAccessibility(page, "revisión de la versión");
    await tapInBubble(page, dialog, "Seguir");

    await expectStep(page, "Ahora, la versión de Paula");
    await page.getByRole("button", { name: /^Motriz/ }).click();

    dialog = await expectStep(page, "Para responder con la mirada");
    await expect(page.getByRole("heading", { name: "Opción múltiple para responder con la mirada" })).toBeVisible();
    await expect(page.getByText("Respuesta correcta").first()).toBeVisible();
    await checkAccessibility(page, "versión motriz");
    await tapInBubble(page, dialog, "Seguir");

    await expectStep(page, "Sin tu aprobación, no llega");
    await page.getByRole("button", { name: /Aprobar y publicar/ }).click();
    await expect(page.getByText("Aprobaste la versión Motriz. Tus estudiantes ya la ven.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "✓ Aprobaste esta versión" })).toBeVisible();
  });

  await test.step("Etapa 4: lo que ve Paula", async () => {
    const dialog = await expectStep(page, "Ahora, del lado de Paula", { takesFocus: true });
    await checkAccessibility(page, "aprobada");
    await tapInBubble(page, dialog, "Ver como Paula");

    const gaze = await expectStep(page, "Responder con la mirada");
    await expect(page).toHaveURL(/\/estudiante$/);
    await expect(page.getByRole("heading", { name: "Respondé con la mirada" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Activar cámara" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Practicar sin cámara" })).toBeVisible();
    // The student never sees a label that would reveal the profile (the tour's bubble is the teacher's guide).
    // Live innerText (a detached clone would include the scripts), minus the tour's own text.
    const studentText = await page.evaluate(() => {
      const own = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="status"]')].map((el) => el.innerText);
      return own.reduce((text, part) => text.replace(part, ""), document.body.innerText);
    });
    expect(studentText).not.toMatch(/TDAH|dislexia|disgraf|motriz|\bTEA\b/i);
    await checkAccessibility(page, "estudiante");
    await tapInBubble(page, gaze, "Terminar");
  });

  await test.step("Cierre y salida de la demo", async () => {
    const end = await expectStep(page, "Eso es Tiza.ai", { takesFocus: true });
    await checkAccessibility(page, "cierre");
    await end.getByRole("link", { name: "Salir de la demo" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Probar la demo" }).first()).toBeVisible();
    // The session is gone: the teacher's area no longer opens.
    await page.goto("/grupos");
    await expect(page.getByRole("heading", { level: 1, name: "Mis grupos" })).toHaveCount(0);
  });
});
