import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizePassword } from "./normalize";
import { generateInitialPassword } from "./password";
import { passwordWords } from "./words";

const WORDS = new Set(passwordWords());

describe("generateInitialPassword", () => {
  it("is three words of the list and a number from 22 to 99 without 0 or 1", () => {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const parts = generateInitialPassword(randomInt).split("-");
      expect(parts).toHaveLength(4);
      expect(parts.slice(0, 3).every((word) => WORDS.has(word))).toBe(true);
      expect(parts[3]).toMatch(/^[2-9][2-9]$/);
    }
  });

  it("is already in the format the login normalizes to, so typing it as printed always matches", () => {
    const password = generateInitialPassword(randomInt);
    expect(normalizePassword(password)).toBe(password);
  });

  it("takes every choice from the source of chance it is given (no Math.random)", () => {
    const calls: Array<[number, number]> = [];
    const first = generateInitialPassword((min, max) => {
      calls.push([min, max]);
      return min;
    });
    const firstWord = passwordWords()[0];
    expect(first).toBe(`${firstWord}-${firstWord}-${firstWord}-22`);
    expect(calls).toEqual([
      [0, WORDS.size],
      [0, WORDS.size],
      [0, WORDS.size],
      [0, 8],
      [0, 8],
    ]);
    expect(generateInitialPassword((_min, max) => max - 1).endsWith("-99")).toBe(true);
  });

  it("does not repeat itself in practice", () => {
    const seen = new Set(Array.from({ length: 300 }, () => generateInitialPassword(randomInt)));
    expect(seen.size).toBeGreaterThan(295);
  });
});
