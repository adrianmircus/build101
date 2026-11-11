import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The tour's bubble is a non-modal dialog named after the step's title.
export function bubble(page: Page, title: string): Locator {
  return page.getByRole("dialog", { name: title });
}

async function insideViewport(page: Page, target: Locator): Promise<boolean> {
  const box = await target.boundingBox();
  const size = page.viewportSize();
  return !!box && !!size && box.y >= 0 && box.y + box.height <= size.height && box.x >= 0 && box.x + box.width <= size.width;
}

// Waits for the step to be on screen (the tour glides and fades before showing it) and records if the bubble
// ended up outside the viewport, which a mouse or finger could not reach.
export async function expectStep(page: Page, title: string, options: { takesFocus?: boolean } = {}): Promise<Locator> {
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
  // Focus should move to the new step's title so a screen reader reads it. Centered steps do it today; steps with
  // a highlighted element don't, so there it is only recorded (known gap, not a regression of this safety net).
  const heading = dialog.getByRole("heading");
  if (options.takesFocus) await expect(heading).toBeFocused();
  else if (!(await heading.evaluate((el) => el === document.activeElement))) {
    test.info().annotations.push({ type: "la burbuja no recibe el foco", description: title });
  }
  if (!(await insideViewport(page, dialog))) {
    test.info().annotations.push({ type: "burbuja fuera de la pantalla", description: title });
  }
  return dialog;
}

// Taps a bubble button. If it is off screen (see above) the tap would hang, so it falls back to Enter.
export async function tapInBubble(page: Page, dialog: Locator, name: string) {
  const button = dialog.getByRole("button", { name });
  if (await insideViewport(page, button)) await button.click();
  else await button.press("Enter");
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
