import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { walkToChanges } from "./support/demo-path";

// WCAG 2.2 AA 1.4.10 (reflow): at 320 px wide nothing may need a horizontal scroll. A page wider than the screen also
// enlarges the layout viewport on a phone, so everything shrinks. The teacher screens of the demo are walked at the
// narrowest width and at a common phone.

const SCREENS = [
  { name: "celular chico", width: 320, height: 640 },
  { name: "celular común", width: 412, height: 915 },
];

async function expectNoHorizontalScroll(page: Page, where: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${where}: la página se pasa del ancho (${scrollWidth} > ${clientWidth})`).toBeLessThanOrEqual(clientWidth);
}

// A click before the page hydrates does nothing, so the tab is tapped again until it is the selected one.
async function openTab(page: Page, name: RegExp) {
  const tab = page.getByRole("tab", { name });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

for (const screen of SCREENS) {
  test.describe(`reflow a ${screen.width} px (${screen.name})`, () => {
    test.skip(({ isMobile }) => isMobile, "Se fija el ancho a mano en escritorio");
    test.use({ viewport: { width: screen.width, height: screen.height } });

    test("las pantallas del profe en la demo no tienen scroll horizontal", async ({ page }) => {
      await page.goto("/grupos");
      await expectNoHorizontalScroll(page, "/grupos");

      await walkToChanges(page);
      await expectNoHorizontalScroll(page, "versiones generadas");

      await page.goto("/grupos/demo");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page, "/grupos/demo, Estudiantes");

      for (const tab of ["Prácticos y parciales", "Resultados", "Estudiantes"]) {
        await openTab(page, new RegExp(tab));
        await expectNoHorizontalScroll(page, `/grupos/demo, ${tab}`);
      }

      await openTab(page, /Prácticos y parciales/);
      await page.locator('a[href*="/evaluaciones/"]:not([href$="/nueva"])').first().click();
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expectNoHorizontalScroll(page, "detalle del práctico");
    });
  });
}
