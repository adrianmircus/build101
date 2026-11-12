import { expect, test } from "./support/fixtures";
import { walkToChanges, walkToGazeQuestions } from "./support/demo-path";
import { bubble, expectStep, tapInBubble } from "./support/tour";

// Where the tour's bubble goes: whole inside the screen and, when there is room, not over the highlighted element.
// expectStep already checks that every bubble is inside the viewport and has the focus; here the two tall steps
// are walked at a short notebook screen and their buttons are tapped.

test.describe("burbuja en un notebook chico (1280x720)", () => {
  test.skip(({ isMobile }) => isMobile, "Se mide en escritorio");
  test.use({ viewport: { width: 1280, height: 720 } });

  test("los dos pasos con un elemento alto muestran «Seguir» dentro de la pantalla", async ({ page }) => {
    await walkToChanges(page);
    await tapInBubble(page, bubble(page, "Cada cambio, con su porqué"), "Seguir");
    await expectStep(page, "Ahora, la versión de Paula");
    await page.getByRole("button", { name: /^Motriz/ }).click();
    const dialog = await expectStep(page, "Para responder con la mirada");
    await tapInBubble(page, dialog, "Seguir");
    await expectStep(page, "Sin tu aprobación, no llega");
  });

  test("con lugar al lado, la burbuja no tapa el elemento resaltado", async ({ page }) => {
    await walkToChanges(page);
    await tapInBubble(page, bubble(page, "Cada cambio, con su porqué"), "Seguir");
    const dialog = await expectStep(page, "Ahora, la versión de Paula");
    const [bubbleBox, targetBox] = await Promise.all([dialog.boundingBox(), page.locator('[data-tour="version-motor"]').boundingBox()]);
    if (!bubbleBox || !targetBox) throw new Error("No se pudo medir la burbuja o el elemento resaltado");
    const [b, t] = [bubbleBox, targetBox];
    const overlaps = b.x < t.x + t.width && b.x + b.width > t.x && b.y < t.y + t.height && b.y + b.height > t.y;
    expect(overlaps, "La burbuja tapa el elemento resaltado").toBe(false);
  });
});

test.describe("burbuja en todas las pantallas", () => {
  test("el paso de la mirada también se puede seguir con el dedo o el mouse", async ({ page }) => {
    await walkToGazeQuestions(page);
    await tapInBubble(page, bubble(page, "Para responder con la mirada"), "Seguir");
    await expectStep(page, "Sin tu aprobación, no llega");
  });
});
