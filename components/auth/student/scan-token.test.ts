import { describe, expect, it } from "vitest";
import { tokenFromScan } from "./scan-token";

const TOKEN = "A".repeat(43);

describe("tokenFromScan", () => {
  it("toma el fragmento de la dirección de la tarjeta", () => {
    expect(tokenFromScan(`https://tiza.example/t#${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromScan(`http://localhost:3000/t/#${TOKEN}`)).toBe(TOKEN);
  });

  it("no acepta otra cosa", () => {
    const others = ["", "hola", "https://tiza.example/t", `https://tiza.example/t#${"A".repeat(42)}`, `https://tiza.example/otra#${TOKEN}`, `https://tiza.example/t?x=${TOKEN}`, TOKEN];
    for (const raw of others) expect(tokenFromScan(raw)).toBeNull();
  });
});
