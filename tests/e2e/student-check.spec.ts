import { expect, test } from "./support/fixtures";
import { expectNoProfileLabels } from "./support/student";

// Self-test of the student check: it has to catch what a screen reader announces even when it is not on the screen.
test.describe("chequeo de que el estudiante no ve su perfil", () => {
  test("una página limpia pasa", async ({ page }) => {
    await page.setContent('<main><h1>Tu práctico</h1><button aria-label="Seguir">Seguir</button></main>');
    await expectNoProfileLabels(page);
  });

  test("aria-labelledby a un nodo oculto con el perfil lo hace fallar", async ({ page }) => {
    await page.setContent(
      '<main><button aria-labelledby="oculto">Seguir</button><span id="oculto" hidden>Motriz</span></main>',
    );
    await expect(expectNoProfileLabels(page)).rejects.toThrow(/Motriz/);
  });

  test("aria-describedby a un nodo oculto con el perfil también lo hace fallar", async ({ page }) => {
    await page.setContent('<main><button aria-describedby="d">Seguir</button><span id="d" hidden>Dislexia</span></main>');
    await expect(expectNoProfileLabels(page)).rejects.toThrow(/Dislexia/);
  });

  test("aria-roledescription con el perfil lo hace fallar", async ({ page }) => {
    await page.setContent('<main><button aria-roledescription="Motriz">Seguir</button></main>');
    await expect(expectNoProfileLabels(page)).rejects.toThrow(/Motriz/);
  });

  test("aria-valuetext con el perfil también lo hace fallar", async ({ page }) => {
    await page.setContent(
      '<main><div role="slider" tabindex="0" aria-label="Avance" aria-valuemin="0" aria-valuemax="10" aria-valuenow="3" aria-valuetext="TDAH"></div></main>',
    );
    await expect(expectNoProfileLabels(page)).rejects.toThrow(/TDAH/);
  });

  test("un slider con valuetext inocuo pasa", async ({ page }) => {
    await page.setContent(
      '<main><div role="slider" tabindex="0" aria-label="Avance" aria-valuemin="0" aria-valuemax="10" aria-valuenow="3" aria-valuetext="3 de 10"></div></main>',
    );
    await expectNoProfileLabels(page);
  });

  test("lo que dice la burbuja del recorrido no cuenta", async ({ page }) => {
    await page.setContent(
      '<main><h1>Tu práctico</h1></main><div role="dialog" aria-labelledby="tour-1"><h2 id="tour-1">Perfil motriz</h2><p>TDAH</p></div>',
    );
    await expectNoProfileLabels(page);
  });
});
