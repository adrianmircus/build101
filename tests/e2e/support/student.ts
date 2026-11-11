import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

const PROFILE_WORDS = /TDAH|dislexia|disgraf|motriz|\bTEA\b/i;

// The student never sees a label that would reveal the profile, in the text or in the accessible names.
// The only thing left out is the tour itself (its bubble and its "Recorrido: ..." announcer): that is the teacher's guide.
export async function expectNoProfileLabels(page: Page) {
  const { text, names } = await page.evaluate(() => {
    const isTour = (el: Element) => !!el.closest('[role="dialog"][aria-labelledby^="tour-"]');
    const tourText = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-labelledby^="tour-"], [role="status"]')]
      .filter((el) => isTour(el) || el.innerText.startsWith("Recorrido:"))
      .map((el) => el.innerText);
    const text = tourText.reduce((rest, part) => rest.replace(part, ""), document.body.innerText);
    // Accessible names that are not visible text: what a screen reader reads.
    const names = [...document.querySelectorAll("[aria-label], [title], img[alt]")]
      .filter((el) => !isTour(el))
      .map((el) => el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.getAttribute("alt") ?? "");
    return { text, names };
  });
  expect(text).not.toMatch(PROFILE_WORDS);
  expect(names.filter((name) => PROFILE_WORDS.test(name))).toEqual([]);
}
