import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { walkToGazeQuestions } from "./support/demo-path";
import { bubble, expectStep, tapInBubble } from "./support/tour";

// The guided demo on a slow device. The browser takes a picture of the tour's layer on every page and tab change
// (view transitions); the highlight's 9999px shadow made that picture huge and froze the screen for seconds on
// each change, sometimes longer than a step's wait. On a busy machine «Cada estudiante, su perfil» or «Para
// responder con la mirada» never showed. Here the CPU runs six times slower, with reduced motion as many visitors
// have it, and the whole tour has to go through, every step with a highlighted element included.

// Six times slower than the machine running the test: what reproduced the hang every few runs.
const SLOWDOWN = 6;
// Longest the screen may stay without a new frame once the tour shows. With the hang it froze 6 to 20 seconds and
// more on a notebook screen; without it, at this slowdown, the longest wait is about 2 seconds.
const MAX_FROZEN_MS = 5000;

test.use({ reducedMotion: "reduce" });

// Records the longest wait between two frames of the page, in every document the tab loads, from the moment the
// tour is on the screen: loading the page on a slow CPU is not what this measures.
async function watchFrames(page: Page) {
  await page.addInitScript(() => {
    let longest = 0;
    let last = 0;
    Reflect.set(window, "__longestFrameGap", () => longest);
    const tick = (now: number) => {
      const tour = !!document.querySelector('[role="dialog"][aria-labelledby^="tour-"]');
      if (last && document.visibilityState === "visible") longest = Math.max(longest, now - last);
      last = tour || last ? now : 0;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function expectNoFrozenScreen(page: Page, where: string) {
  const gap = await page.evaluate(() => Number(Reflect.apply(Reflect.get(window, "__longestFrameGap"), window, [])));
  expect(gap, `La pantalla quedó congelada ${Math.round(gap)} ms en «${where}»`).toBeLessThan(MAX_FROZEN_MS);
}

test("en un equipo lento el recorrido muestra cada paso, también los que resaltan un elemento", async ({ page }) => {
  test.setTimeout(300_000);
  await watchFrames(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: SLOWDOWN });

  // Through «Cada estudiante, su perfil» (the first page change with a highlight) and every teacher step up to
  // «Para responder con la mirada» (the change of tab to Paula's version).
  await walkToGazeQuestions(page);
  await expectNoFrozenScreen(page, "Para responder con la mirada");
  await tapInBubble(page, bubble(page, "Para responder con la mirada"), "Seguir");

  await expectStep(page, "Sin tu aprobación, no llega");
  await page.getByRole("button", { name: /Aprobar y publicar/ }).click();
  await tapInBubble(page, await expectStep(page, "Ahora, del lado de Paula"), "Ver como Paula");

  // Paula's side: another page change, to the step that highlights the gaze screen.
  await tapInBubble(page, await expectStep(page, "Responder con la mirada"), "Terminar");
  await expectStep(page, "Eso es Tiza.ai");
  await expectNoFrozenScreen(page, "Eso es Tiza.ai");
});
