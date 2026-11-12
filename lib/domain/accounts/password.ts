import { passwordWords } from "./words";

// The initial password of a student: three short words and a two-digit number without 0 or 1 ("sol-nube-tigre-47", about 33
// bits). The plain password is never stored: only its scrypt hash (lib/server/auth/password-hash.ts, table student_credentials)
// and the printed sheet have it. The domain cannot import node:crypto, so the source of chance comes in as a parameter: the server
// passes `randomInt` of node:crypto, never Math.random.

/** The shape of crypto.randomInt(min, max): an integer in [min, max). */
export type RandomInt = (minInclusive: number, maxExclusive: number) => number;

/** The digits of the number of a password: no 0 (it looks like an O) and no 1 (it looks like an l), so the number goes from 22 to 99. */
const DIGITS = [2, 3, 4, 5, 6, 7, 8, 9] as const;

function pick<T>(items: readonly T[], randomInt: RandomInt): T {
  const chosen = items[randomInt(0, items.length)];
  if (chosen === undefined) throw new Error("La fuente de azar devolvió un índice fuera de la lista.");
  return chosen;
}

/** A new initial password in the format above. The three words are chosen independently (they may repeat), so each one adds the same bits. */
export function generateInitialPassword(randomInt: RandomInt): string {
  const words = passwordWords();
  const chosen = [pick(words, randomInt), pick(words, randomInt), pick(words, randomInt)];
  return `${chosen.join("-")}-${pick(DIGITS, randomInt)}${pick(DIGITS, randomInt)}`;
}
