import { describe, expect, it } from "vitest";
import { passwordWords } from "./words";

// Words that must never be in the list, nor be part of one of its words: insults, sexual or body slang of the Río de la Plata and
// Spain, drugs, violence, death and words that single a person out. A short blocklist is not a review (the words were read one by
// one): it is a net against someone adding a word later without reading it.
const BLOCKED = [
  "pija", "pito", "pene", "verga", "culo", "cola", "teta", "poto", "pedo", "caca", "popo", "mear", "cago", "puta", "puto", "coger",
  "concha", "chota", "bolas", "boludo", "pelotud", "mina", "zorra", "perra", "yuta", "trola", "gil", "tonto", "bobo", "loco", "gordo",
  "flaco", "feo", "negro", "sida", "odio", "matar", "muerte", "sexo", "nalga", "droga", "porro", "faso", "falo", "paja", "bollo", "rata",
  "burro", "cerdo", "yegua", "cabra", "gata", "mugre", "raro", "mudo", "ciego", "sordo", "zurdo", "bruja", "arma", "bomba", "bala", "tumba",
  "soga", "fosa", "hacha", "dardo", "taco", "huevo", "pico", "nabo", "mamar", "chupa", "cana", "tarado", "idiota", "imbecil", "vago",
  "gay", "trava", "moro", "indio", "chino", "judio", "pipi", "cuca", "cuco", "toto", "foca", "panza", "pecho",
];

/** Long entries are looked for inside a word («pelotud» in «pelotudo»); short ones only match a whole word, so «cana» does not take out «canal». */
const offends = (word: string, blocked: string) => (blocked.length >= 6 ? word.includes(blocked) : word === blocked);

describe("the word list of the initial passwords", () => {
  const words = passwordWords();

  it("has at least 512 words, so three of them and a number give about 33 bits", () => {
    expect(words.length).toBeGreaterThanOrEqual(512);
  });

  it("has only words of 3 to 5 letters from a to z: no accents, no ñ, no digits, no spaces", () => {
    expect(words.filter((word) => !/^[a-z]{3,5}$/.test(word))).toEqual([]);
  });

  it("has no word twice", () => {
    expect(new Set(words).size).toBe(words.length);
  });

  it("has none of the words that could offend", () => {
    expect(words.filter((word) => BLOCKED.some((blocked) => offends(word, blocked)))).toEqual([]);
  });
});
