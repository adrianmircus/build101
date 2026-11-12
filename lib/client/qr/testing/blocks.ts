import { structureOf } from "./tables";

// Undoing the interleave and checking the Reed-Solomon codewords, with the plain shift-and-add field arithmetic.

function gfMultiply(a: number, b: number): number {
  let product = 0;
  let x = a;
  for (let y = b; y > 0; y >>= 1) {
    if (y & 1) product ^= x;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  return product;
}

function gfPow(exponent: number): number {
  let value = 1;
  for (let i = 0; i < exponent; i++) value = gfMultiply(value, 2);
  return value;
}

/** True when every syndrome of the block (data and error correction) is zero. */
function isClean(block: readonly number[], eccLength: number): boolean {
  for (let i = 0; i < eccLength; i++) {
    const root = gfPow(i);
    if (block.reduce((acc, byte) => gfMultiply(acc, root) ^ byte, 0) !== 0) return false;
  }
  return true;
}

/** The data codewords, in order, after checking every block. Throws when a block does not close. */
export function dataOf(words: readonly number[], version: number): number[] {
  const { ecc, groups } = structureOf(version);
  const lengths = groups.flatMap((group) => new Array<number>(group.count).fill(group.data));
  const blocks: number[][] = lengths.map(() => []);
  let cursor = 0;
  for (let i = 0; i < Math.max(...lengths); i++) {
    lengths.forEach((length, b) => {
      if (i < length) blocks[b]?.push(words[cursor++] ?? 0);
    });
  }
  for (let i = 0; i < ecc; i++) blocks.forEach((block) => block.push(words[cursor++] ?? 0));
  if (!blocks.every((block) => isClean(block, ecc))) throw new Error("Reed-Solomon: los códigos de corrección no cierran");
  return blocks.flatMap((block, b) => block.slice(0, lengths[b] ?? 0));
}
