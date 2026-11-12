// The module matrix under construction: the dark modules and which of them belong to a function pattern (finders,
// timing, alignment, format and version), which the data and the mask never touch.

export type Point = { x: number; y: number };
export type Grid = { size: number; modules: boolean[][]; isFunction: boolean[][] };

export function createGrid(size: number): Grid {
  const blank = () => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, modules: blank(), isFunction: blank() };
}

/** Sets a module of a function pattern. Points outside the symbol are ignored (the finders draw a margin). */
export function setFunction(grid: Grid, at: Point, dark: boolean) {
  const row = grid.modules[at.y];
  const marks = grid.isFunction[at.y];
  if (row === undefined || marks === undefined || at.x < 0 || at.x >= grid.size) return;
  row[at.x] = dark;
  marks[at.x] = true;
}

export function isFunction(grid: Grid, at: Point): boolean {
  return grid.isFunction[at.y]?.[at.x] === true;
}

export function setModule(grid: Grid, at: Point, dark: boolean) {
  const row = grid.modules[at.y];
  if (row !== undefined) row[at.x] = dark;
}

export function flipModule(grid: Grid, at: Point) {
  const row = grid.modules[at.y];
  if (row !== undefined) row[at.x] = row[at.x] !== true;
}
