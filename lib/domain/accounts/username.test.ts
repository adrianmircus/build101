import { describe, expect, it } from "vitest";
import { Username } from "../students/entities";
import { suggestUsername, usernameBase } from "./username";

describe("usernameBase", () => {
  it("is the first name plus the initial of the surname, without accents", () => {
    expect(usernameBase("Lucía Fernández")).toBe("luciaf");
    expect(usernameBase("Martín Núñez")).toBe("martinn");
    expect(usernameBase("  JOSÉ   pérez ")).toBe("josep");
  });

  it("takes the first word and the initial of the last one when there are more than two", () => {
    expect(usernameBase("María José Pérez Gómez")).toBe("mariag");
  });

  it("reads «Apellido, Nombre»", () => {
    expect(usernameBase("Fernández, Lucía")).toBe("luciaf");
  });

  it("is only the name when there is no surname", () => {
    expect(usernameBase("Lucía")).toBe("lucia");
  });

  it("keeps only a-z and 0-9", () => {
    expect(usernameBase("D'Angelo O'Neil")).toBe("dangeloo");
    expect(usernameBase("Ana-Laura Ríos")).toBe("analaurar");
    expect(usernameBase("Nuño Ibáñez")).toBe("nunoi");
  });

  it("always fits the username rule of the database, even for odd names", () => {
    const odd = ["", "   ", "???", "X", "李 王", "Jean-Luc", "A B", `${"a".repeat(200)} ${"b".repeat(5)}`, "Ana 2"];
    for (const name of odd) expect(Username.safeParse(usernameBase(name)).success, name).toBe(true);
  });
});

describe("suggestUsername", () => {
  it("is the base when it is free", () => {
    expect(suggestUsername("Lucía Fernández", new Set())).toBe("luciaf");
  });

  it("counts up from 2 when it is taken", () => {
    expect(suggestUsername("Lucía Fernández", new Set(["luciaf"]))).toBe("luciaf2");
    expect(suggestUsername("Lucía Fernández", new Set(["luciaf", "luciaf2", "luciaf3"]))).toBe("luciaf4");
  });

  it("does not skip a free base because a number is taken", () => {
    expect(suggestUsername("Lucía Fernández", new Set(["luciaf2"]))).toBe("luciaf");
  });

  it("gives different ones to the people of one batch when the caller adds each answer", () => {
    const taken = new Set<string>();
    const answers = ["Lucía Fernández", "Lucas Fernández", "Lucía Fuentes"].map((name) => {
      const username = suggestUsername(name, taken);
      taken.add(username);
      return username;
    });
    expect(answers).toEqual(["luciaf", "lucasf", "luciaf2"]);
  });
});
