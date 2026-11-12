import type { Page } from "@playwright/test";
import { expect } from "./fixtures";
import { announcedStrings } from "./a11y-tree";

export const PROFILE_WORDS = /TDAH|dislexia|disgraf|motriz|\bTEA\b/i;

// The student never sees a label that would reveal the profile: not in the visible text and not in anything a screen
// reader announces (resolved names and descriptions, including aria-labelledby to hidden nodes).
// The tour itself (its bubble and its "Recorrido: ..." announcer) is left out: that is the teacher's guide.
export async function expectNoProfileLabels(page: Page) {
  const text = await page.evaluate(() => {
    const tour = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-labelledby^="tour-"], [role="status"]')]
      .filter((el) => el.matches('[role="dialog"]') || el.innerText.startsWith("Recorrido:"))
      .map((el) => el.innerText);
    return tour.reduce((rest, part) => rest.replace(part, ""), document.body.innerText);
  });
  expect(text).not.toMatch(PROFILE_WORDS);
  expect((await announcedStrings(page)).filter((value) => PROFILE_WORDS.test(value))).toEqual([]);
}
