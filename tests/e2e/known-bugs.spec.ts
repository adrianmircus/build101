import { expect, test } from "./support/fixtures";
import { bubble, insideViewport } from "./support/tour";
import { walkToChanges, walkToGazeQuestions, walkToProfiles } from "./support/demo-path";

// Bugs of the app that demo.spec.ts works around. The test.fail case passes while the bug exists and turns red when
// someone fixes it: then delete test.fail (and the matching entry in known-gaps.ts).

test.describe("bug conocido: botón «Seguir» fuera de la pantalla", () => {
  test.skip(({ isMobile }) => isMobile, "Se mide en escritorio a 1280x720");
  test.fail();

  test("el mouse llega a «Seguir» en «Cada cambio, con su porqué»", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await walkToChanges(page);
    // No fallback to Enter: this is what a mouse user does. Playwright can click a fixed element that is below the
    // fold (and toBeInViewport says yes to it), so the box is compared with the screen by hand.
    const seguir = bubble(page, "Cada cambio, con su porqué").getByRole("button", { name: "Seguir" });
    await expect.poll(() => insideViewport(page, seguir), { timeout: 5_000 }).toBe(true);
    await seguir.click({ timeout: 5_000 });
  });
});

// It used to hang here with reduced motion. It no longer does at normal load (it still did with six browsers at once
// on a slow machine), so it is a normal test: if it goes red, the hang is back.
test.describe("movimiento reducido en todo el recorrido", () => {
  test.skip(({ isMobile }) => isMobile, "Se mide en escritorio");
  test.use({ reducedMotion: "reduce" });

  test("el recorrido llega a «Para responder con la mirada» con reduced motion", async ({ page }) => {
    await walkToGazeQuestions(page);
  });
});

test.describe("transiciones de vista en celular (bug arreglado)", () => {
  test.skip(({ isMobile }) => !isMobile, "Era un bug de pantallas chicas");

  test("tras entrar al grupo aparece la burbuja «Cada estudiante, su perfil»", async ({ page }) => {
    await walkToProfiles(page);
    await expect(page.getByRole("heading", { level: 1, name: "Grupo demo" })).toBeVisible();
  });
});
