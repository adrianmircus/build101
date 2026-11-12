import { expect, test } from "./support/fixtures";
import { bubble, insideViewport } from "./support/tour";
import { walkToChanges, walkToGazeQuestions, walkToProfiles } from "./support/demo-path";

// Bugs of the app that demo.spec.ts works around. They are normal tests (no test.fail, which would also swallow a
// failure of the walk or of the guards): the path must reach the step with hard expects, then the known defect is
// asserted explicitly. When someone fixes the bug that last expect fails and says what to delete.

test.describe("bug conocido: botón «Seguir» fuera de la pantalla", () => {
  test.skip(({ isMobile }) => isMobile, "Se mide en escritorio a 1280x720");

  test("a 1280x720 «Seguir» de «Cada cambio, con su porqué» queda debajo del borde", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await walkToChanges(page);
    const seguir = bubble(page, "Cada cambio, con su porqué").getByRole("button", { name: "Seguir" });
    // The path got here: the button exists and can be pressed (a mouse user cannot reach it, a keyboard user can).
    await expect(seguir).toBeVisible();
    await expect(seguir).toBeEnabled();
    // Playwright can click a fixed element below the fold (and toBeInViewport says yes), so the box is compared by hand.
    const reachable = await insideViewport(page, seguir);
    expect(
      reachable,
      "Bug 2 arreglado: borrá esta prueba y sacá el paso de KNOWN_UNREACHABLE_BUTTON_STEPS",
    ).toBe(false);
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
