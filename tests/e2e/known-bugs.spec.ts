import { expect, test } from "./support/fixtures";
import { walkToGazeQuestions, walkToProfiles } from "./support/demo-path";

// Bugs of the demo that were fixed and that a normal test keeps from coming back.

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
