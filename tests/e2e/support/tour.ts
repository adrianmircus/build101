import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";

// The tour's bubble is a non-modal dialog named after the step's title.
export function bubble(page: Page, title: string): Locator {
  return page.getByRole("dialog", { name: title });
}

export async function insideViewport(page: Page, target: Locator): Promise<boolean> {
  const box = await target.boundingBox();
  const size = page.viewportSize();
  return !!box && !!size && box.y >= 0 && box.y + box.height <= size.height && box.x >= 0 && box.x + box.width <= size.width;
}

// Waits for the step to be on screen (the tour glides and fades before showing it). Every bubble must be whole inside
// the viewport (a mouse or a finger can reach all of it) and must have taken the focus on its title (a screen reader
// reads it), whether the step is centered or highlights an element.
export async function expectStep(page: Page, title: string): Promise<Locator> {
  const dialog = bubble(page, title);
  await expect(dialog).toBeVisible();
  // The bubble fades in (200 ms): wait until it is opaque so axe doesn't read half-faded colors as low contrast.
  await expect
    .poll(() =>
      dialog.evaluate((el) => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          if (getComputedStyle(node).opacity !== "1") return false;
        }
        return true;
      }),
    )
    .toBe(true);
  await expect(dialog.getByRole("heading")).toBeFocused();
  expect(await insideViewport(page, dialog), `La burbuja de «${title}» no entra entera en la pantalla`).toBe(true);
  return dialog;
}

// Taps a bubble button like a mouse or a finger would. It has to be inside the screen: a button below the fold can't
// be reached (Playwright would scroll to a fixed element that never moves, so the box is checked first).
export async function tapInBubble(page: Page, dialog: Locator, name: string) {
  const button = dialog.getByRole("button", { name });
  const step = (await dialog.getByRole("heading").textContent()) ?? "";
  expect(await insideViewport(page, button), `El botón «${name}» de «${step}» queda fuera de la pantalla`).toBe(true);
  await button.click();
}

// The focus ring must be drawn: an outline or a shadow on an element that matches :focus-visible (WCAG 2.4.7).
export async function expectVisibleFocus(target: Locator) {
  await expect(target).toBeFocused();
  const drawn = await target.evaluate((el) => {
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
    return el.matches(":focus-visible") && (outline || style.boxShadow !== "none");
  });
  expect(drawn, "El elemento con foco no muestra un indicador visible").toBe(true);
}
