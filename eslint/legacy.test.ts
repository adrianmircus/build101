import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyFiles } from "./legacy.mjs";

describe("legacy exception list", () => {
  it.each(legacyFiles)("%s still exists (delete the entry when a file is split or removed)", (file) => {
    expect(existsSync(resolve(__dirname, "..", file))).toBe(true);
  });
});
