import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures";
import { KNOWN_VIOLATIONS } from "../axe-known";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);

// Runs axe on the current screen. Serious and critical violations fail the test unless axe-known.ts lists them
// for that screen. `screen` is a stable name: it is the key in the known list.
export async function checkAccessibility(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const unexpected = violations
    .filter((v) => v.impact && BLOCKING.has(v.impact))
    .filter((v) => !KNOWN_VIOLATIONS.some((k) => k.rule === v.id && k.screen === screen))
    .map((v) => `${v.id} (${v.impact}) en «${screen}»: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(unexpected, `Violaciones de accesibilidad nuevas en «${screen}»`).toEqual([]);
}
