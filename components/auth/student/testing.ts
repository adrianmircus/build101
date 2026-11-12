import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect } from "vitest";

export function markup(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

/** Nothing of the student login is told by red: no class of the red, rose, pink or orange families, and no red in a style. */
export function expectNoRed(html: string): void {
  expect(html).not.toMatch(/(?:^|[\s:"-])(?:red|rose|pink|orange)-\d{2,3}\b/);
  expect(html).not.toMatch(/#(?:dc2626|b91c1c|991b1b|ef4444|f87171)/i);
}

/** A message is never told only by color: it has its light bulb (an svg hidden from the screen reader) and words. */
export function expectNeutralAlert(html: string): void {
  expect(html).toContain('role="alert"');
  expect(html).toContain('aria-hidden="true"');
  expectNoRed(html);
}
