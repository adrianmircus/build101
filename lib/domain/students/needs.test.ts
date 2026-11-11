import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NeedsFields, PROFILE_IDS } from "./needs";

describe("profile catalogue", () => {
  it("lists exactly the approved data/profiles/<id>.md files (drafts do not count)", () => {
    const approved = readdirSync("data/profiles")
      .filter((name) => name.endsWith(".md") && !name.endsWith(".draft.md") && name !== "README.md")
      .map((name) => name.slice(0, -".md".length))
      .sort();
    expect([...PROFILE_IDS].sort()).toEqual(approved);
  });
});

describe("NeedsFields", () => {
  const valid = { profiles: ["adhd"], supports: [], interests: ["fútbol"], reviewDueOn: "2027-03-01" };

  it("accepts catalogue ids and short interests", () => {
    expect(NeedsFields.safeParse(valid).success).toBe(true);
  });

  it("refuses a profile that is not validated", () => {
    expect(NeedsFields.safeParse({ ...valid, profiles: ["invented"] }).success).toBe(false);
  });

  it("refuses repeated values", () => {
    expect(NeedsFields.safeParse({ ...valid, profiles: ["adhd", "adhd"] }).success).toBe(false);
  });
});
