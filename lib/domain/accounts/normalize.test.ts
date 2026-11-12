import { describe, expect, it } from "vitest";
import { normalizePassword, studentSubject } from "./normalize";

describe("normalizePassword", () => {
  it("leaves a password in its own format as it is", () => {
    expect(normalizePassword("sol-nube-tigre-47")).toBe("sol-nube-tigre-47");
  });

  it("lower-cases and trims the edges", () => {
    expect(normalizePassword("  Sol-Nube-TIGRE-47\t")).toBe("sol-nube-tigre-47");
  });

  it("turns any run of spaces or hyphens into one hyphen", () => {
    expect(normalizePassword("sol nube  tigre   47")).toBe("sol-nube-tigre-47");
    expect(normalizePassword("sol - nube--tigre -- 47")).toBe("sol-nube-tigre-47");
    expect(normalizePassword("sol\tnube\ntigre 47")).toBe("sol-nube-tigre-47");
  });

  it("does not invent or remove letters", () => {
    expect(normalizePassword("sol-ñu-47")).toBe("sol-ñu-47");
    expect(normalizePassword("")).toBe("");
  });
});

describe("studentSubject", () => {
  it("is the pair, written the same however it was typed", () => {
    expect(studentSubject("Colegio-X ", " LuciaF")).toBe("colegio-x/luciaf");
    expect(studentSubject("colegio-x", "luciaf")).toBe("colegio-x/luciaf");
  });

  it("keeps two different pairs apart", () => {
    expect(studentSubject("a", "b-c")).not.toBe(studentSubject("a-b", "c"));
  });
});
