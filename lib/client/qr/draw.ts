import { createGrid, flipModule, isFunction, setFunction, setModule, type Grid, type Point } from "./grid";
import { alignmentPositions, formatBits, masked, sizeOf, versionBits } from "./spec";

// Drawing the symbol: function patterns, the codewords in their zigzag and the mask (ISO/IEC 18004, 6 and 7.7 to 7.10).

function drawFinder(grid: Grid, center: Point) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy)); // 0 to 2 the pattern, 3 the white ring, 4 the separator
      setFunction(grid, { x: center.x + dx, y: center.y + dy }, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlignment(grid: Grid, center: Point) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) setFunction(grid, { x: center.x + dx, y: center.y + dy }, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
}

/** The format information, twice, and the dark module. */
export function drawFormat(grid: Grid, mask: number) {
  const bits = formatBits(mask);
  const put = (x: number, y: number, i: number) => setFunction(grid, { x, y }, ((bits >>> i) & 1) !== 0);
  const { size } = grid;
  for (let i = 0; i <= 5; i++) put(8, i, i);
  put(8, 7, 6);
  put(8, 8, 7);
  put(7, 8, 8);
  for (let i = 9; i < 15; i++) put(14 - i, 8, i);
  for (let i = 0; i < 8; i++) put(size - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) put(8, size - 15 + i, i);
  setFunction(grid, { x: 8, y: size - 8 }, true);
}

function drawVersion(grid: Grid, version: number) {
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = grid.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(grid, { x: a, y: b }, dark);
    setFunction(grid, { x: b, y: a }, dark);
  }
}

/** Alignment patterns go on every crossing of the positions, except the three that would sit on a finder. */
function alignmentCenters(version: number): Point[] {
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  const centers: Point[] = [];
  positions.forEach((y, row) => {
    positions.forEach((x, column) => {
      const onFinder = (row === 0 && column === 0) || (row === 0 && column === last) || (row === last && column === 0);
      if (!onFinder) centers.push({ x, y });
    });
  });
  return centers;
}

export function drawFunctionPatterns(grid: Grid, version: number) {
  const { size } = grid;
  for (let i = 0; i < size; i++) {
    setFunction(grid, { x: 6, y: i }, i % 2 === 0);
    setFunction(grid, { x: i, y: 6 }, i % 2 === 0);
  }
  for (const center of [{ x: 3, y: 3 }, { x: size - 4, y: 3 }, { x: 3, y: size - 4 }]) drawFinder(grid, center);
  for (const center of alignmentCenters(version)) drawAlignment(grid, center);
  drawFormat(grid, 0); // reserves the area; the real mask is drawn at the end
  if (version >= 7) drawVersion(grid, version);
}

/** The order the codewords go in: pairs of columns from the right, up and then down; column 6 belongs to no pair. */
function zigzag(size: number): Point[] {
  const order: Point[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      order.push({ x: right, y }, { x: right - 1, y });
    }
  }
  return order;
}

export function placeCodewords(grid: Grid, words: readonly number[]) {
  let i = 0;
  for (const at of zigzag(grid.size)) {
    if (isFunction(grid, at)) continue;
    const word = words[i >>> 3] ?? 0;
    setModule(grid, at, i < words.length * 8 && ((word >>> (7 - (i & 7))) & 1) !== 0);
    i++;
  }
}

export function applyMask(grid: Grid, mask: number) {
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) {
      if (!isFunction(grid, { x, y }) && masked(mask, x, y)) flipModule(grid, { x, y });
    }
  }
}

/** A symbol with its function patterns drawn and nothing else. */
export function emptySymbol(version: number): Grid {
  const grid = createGrid(sizeOf(version));
  drawFunctionPatterns(grid, version);
  return grid;
}
