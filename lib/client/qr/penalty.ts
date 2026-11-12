// The four penalty rules that pick the mask (ISO/IEC 18004, 7.8.3): runs, 2x2 blocks, finder-like patterns and balance.

const CORE = [true, false, true, true, true, false, true]; // the 1:1:3:1:1 of a finder

function linesOf(modules: readonly (readonly boolean[])[]): boolean[][] {
  const lines: boolean[][] = modules.map((row) => [...row]);
  for (let x = 0; x < modules.length; x++) lines.push(modules.map((row) => row[x] === true));
  return lines;
}

function runScore(line: readonly boolean[]): number {
  let score = 0;
  let run = 1;
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && line[i] === line[i - 1]) {
      run++;
      continue;
    }
    score += run >= 5 ? 3 + (run - 5) : 0;
    run = 1;
  }
  return score;
}

function matchesAt(line: readonly boolean[], start: number, pattern: readonly boolean[]): boolean {
  return pattern.every((value, k) => line[start + k] === value);
}

function lightAt(line: readonly boolean[], start: number): boolean {
  return start >= 0 && start + 4 <= line.length && matchesAt(line, start, [false, false, false, false]);
}

function finderScore(line: readonly boolean[]): number {
  let score = 0;
  for (let i = 0; i + CORE.length <= line.length; i++) {
    if (!matchesAt(line, i, CORE)) continue;
    if (lightAt(line, i - 4)) score += 40;
    if (lightAt(line, i + CORE.length)) score += 40;
  }
  return score;
}

function blockScore(modules: readonly (readonly boolean[])[]): number {
  let score = 0;
  for (let y = 0; y + 1 < modules.length; y++) {
    const row = modules[y] ?? [];
    const next = modules[y + 1] ?? [];
    for (let x = 0; x + 1 < row.length; x++) {
      if (row[x] === row[x + 1] && row[x] === next[x] && row[x] === next[x + 1]) score += 3;
    }
  }
  return score;
}

function balanceScore(modules: readonly (readonly boolean[])[]): number {
  const dark = modules.flat().filter(Boolean).length;
  const total = modules.length * modules.length;
  return (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
}

export function penalty(modules: readonly (readonly boolean[])[]): number {
  const lines = linesOf(modules);
  const perLine = lines.reduce((sum, line) => sum + runScore(line) + finderScore(line), 0);
  return perLine + blockScore(modules) + balanceScore(modules);
}
