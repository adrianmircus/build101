import { alignmentOf } from "./tables";

// Where the data lives in a symbol, read the way a scanner does: the format information, the function patterns to skip
// and the zigzag of the codewords, unmasked.

export type Modules = readonly (readonly boolean[])[];

export function bitAt(modules: Modules, x: number, y: number): number {
  return modules[y]?.[x] === true ? 1 : 0;
}

function popcount(n: number): number {
  let count = 0;
  for (let v = n; v > 0; v >>= 1) count += v & 1;
  return count;
}

/** The two copies of the 15 format bits: around the top left finder, and split between the other two. */
function formatCopies(modules: Modules): [number, number] {
  const size = modules.length;
  let first = 0;
  let second = 0;
  for (let i = 0; i <= 5; i++) first |= bitAt(modules, 8, i) << i;
  first |= bitAt(modules, 8, 7) << 6;
  first |= bitAt(modules, 8, 8) << 7;
  first |= bitAt(modules, 7, 8) << 8;
  for (let i = 9; i < 15; i++) first |= bitAt(modules, 14 - i, 8) << i;
  for (let i = 0; i < 8; i++) second |= bitAt(modules, size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) second |= bitAt(modules, 8, size - 15 + i) << i;
  return [first, second];
}

/** The 5 data bits of the format information (level and mask), after the BCH check and the 0x5412 mask. */
export function readFormat(modules: Modules): number {
  const [first, second] = formatCopies(modules);
  if (first !== second) throw new Error("Las dos copias de la información de formato no coinciden");
  for (let data = 0; data < 32; data++) {
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) & 1 ? 0x537 : 0);
    // A scanner corrects up to 3 wrong bits.
    if (popcount((((data << 10) | rem) ^ 0x5412) ^ first) <= 3) return data;
  }
  throw new Error("Información de formato inválida");
}

type Rect = { x: number; y: number; w: number; h: number };

function reservedMap(version: number): boolean[][] {
  const size = version * 4 + 17;
  const map = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (rect: Rect) => {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      const row = map[y];
      for (let x = rect.x; x < rect.x + rect.w && row !== undefined; x++) if (row[x] === false) row[x] = true;
    }
  };
  mark({ x: 0, y: 0, w: 9, h: 9 });
  mark({ x: size - 8, y: 0, w: 8, h: 9 });
  mark({ x: 0, y: size - 8, w: 9, h: 8 });
  mark({ x: 6, y: 0, w: 1, h: size });
  mark({ x: 0, y: 6, w: size, h: 1 });
  const centers = alignmentOf(version);
  const corners = [[6, 6], [6, size - 7], [size - 7, 6]];
  for (const cy of centers) {
    for (const cx of centers) if (!corners.some(([a, b]) => a === cx && b === cy)) mark({ x: cx - 2, y: cy - 2, w: 5, h: 5 });
  }
  if (version >= 7) {
    mark({ x: size - 11, y: 0, w: 3, h: 6 });
    mark({ x: 0, y: size - 11, w: 6, h: 3 });
  }
  return map;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The cells in the order the codewords sit: pairs of columns from the right, up and then down. */
function zigzag(size: number): [number, number][] {
  const cells: [number, number][] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      cells.push([right, y], [right - 1, y]);
    }
    upward = !upward;
  }
  return cells;
}

/** The data and error correction codewords in the order they sit in the symbol (interleaved), unmasked. */
export function readCodewords(modules: Modules, version: number, mask: number): number[] {
  const reserved = reservedMap(version);
  const flips = MASKS[mask] ?? (() => false);
  const bits = zigzag(modules.length)
    .filter(([x, y]) => reserved[y]?.[x] === false)
    .map(([x, y]) => bitAt(modules, x, y) ^ (flips(x, y) ? 1 : 0));
  const words: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) words.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  return words;
}
