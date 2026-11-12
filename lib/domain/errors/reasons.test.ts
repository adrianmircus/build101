import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REASON_MESSAGES } from "./reasons";

// The reasons SQL raises (app.raise_error) are listed, literally, in supabase/tests/030_reasons.test.sql, and that pgTAP test
// compares the list with what the function bodies of the database raise. Here the same list is compared with the texts the
// front shows: so a reason with no text, or a text for a reason nothing raises, fails in one of the two places.

function reasonsListedInSql(): string[] {
  const file = readFileSync(join(process.cwd(), "supabase", "tests", "030_reasons.test.sql"), "utf8");
  const block = /-- BEGIN REASONS([\s\S]*?)-- END REASONS/.exec(file)?.[1];
  if (block === undefined) throw new Error("030_reasons.test.sql lost its BEGIN REASONS / END REASONS markers");
  return [...block.matchAll(/\('([a-z][a-z0-9_]*)'\)/g)].map((m) => m[1] ?? "");
}

describe("REASON_MESSAGES", () => {
  const listed = reasonsListedInSql();

  it("reads a list that is not empty and has no repeats", () => {
    expect(listed.length).toBeGreaterThan(50);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("has a text for every reason SQL raises", () => {
    const missing = listed.filter((reason) => !Object.hasOwn(REASON_MESSAGES, reason));
    expect(missing).toEqual([]);
  });

  it("keeps no text for a reason nothing raises", () => {
    const orphans = Object.keys(REASON_MESSAGES).filter((reason) => !listed.includes(reason));
    expect(orphans).toEqual([]);
  });

  it("has Spanish texts that say something and do not carry a placeholder", () => {
    for (const [reason, message] of Object.entries(REASON_MESSAGES)) {
      expect(message.trim().length, reason).toBeGreaterThan(5);
      expect(message, reason).not.toMatch(/[{}<>]/);
    }
  });
});
