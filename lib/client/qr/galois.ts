// Reed-Solomon over GF(256) with the polynomial 0x11D, as the standard asks for the error correction codewords.

function buildTables(): { exp: number[]; log: number[] } {
  const exp = new Array<number>(512).fill(0);
  const log = new Array<number>(256).fill(0);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255] ?? 0;
  return { exp, log };
}

const { exp: EXP, log: LOG } = buildTables();

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0;
}

/** The generator polynomial of the given degree, without its leading coefficient (that is 1). */
function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    const root = EXP[i] ?? 0;
    poly.forEach((coef, j) => {
      next[j] = (next[j] ?? 0) ^ coef;
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(coef, root);
    });
    poly = next;
  }
  return poly.slice(1);
}

/** The error correction codewords of a block of data codewords. */
export function remainder(data: readonly number[], degree: number): number[] {
  const gen = generator(degree);
  const rem = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (rem.shift() ?? 0);
    rem.push(0);
    gen.forEach((coef, i) => {
      rem[i] = (rem[i] ?? 0) ^ gfMul(coef, factor);
    });
  }
  return rem;
}
