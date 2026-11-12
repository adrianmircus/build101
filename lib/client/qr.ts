import { chooseVersion, codewords, dataBits } from "./qr/data";
import { applyMask, drawFormat, emptySymbol, placeCodewords } from "./qr/draw";
import type { Grid } from "./qr/grid";
import { penalty } from "./qr/penalty";

// QR code generator for the access cards (docs/contratos/fase-2.md, «Pantallas»): ISO/IEC 18004, byte mode, error
// correction level M, the smallest version that fits the text. No dependency. It covers versions 1 to 10 (up to 213
// bytes), far more than the card URL `https://<origin>/t#<token>` (about 60 bytes); longer text throws a RangeError.
//
// The module is pure: text in, matrix or SVG out. The card token is a secret, so nothing here logs, caches or stores it.

export { formatBits, versionBits } from "./qr/spec";

/** The matrix: `true` is a dark module. `modules[y][x]`. */
export type QrMatrix = { version: number; size: number; mask: number; modules: boolean[][] };

/** The mask with the lowest penalty (the first one if they tie). The grid is left without any mask applied. */
function bestMask(grid: Grid): number {
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(grid, mask);
    drawFormat(grid, mask);
    const score = penalty(grid.modules);
    applyMask(grid, mask); // undo: the mask flips the same modules back
    if (score < bestScore) {
      best = mask;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Encodes the text (UTF-8, byte mode, level M, smallest version) and returns the module matrix. The mask is the one
 * with the lowest penalty; `forceMask` exists for the tests, to compare against matrices made with another mask.
 */
export function encodeQr(text: string, forceMask?: number): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const grid = emptySymbol(version);
  placeCodewords(grid, codewords(dataBits(bytes, version), version));
  const mask = forceMask ?? bestMask(grid);
  applyMask(grid, mask);
  drawFormat(grid, mask);
  return { version, size: grid.size, mask, modules: grid.modules };
}

/** SVG path data, one `M x y h<run> v1 h-<run> z` per horizontal run of dark modules, with the quiet zone as an offset. */
export function qrPathData(matrix: QrMatrix, quietZone = 4): string {
  const parts: string[] = [];
  matrix.modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== true) {
        x++;
        continue;
      }
      const start = x;
      while (row[x] === true) x++;
      parts.push(`M${start + quietZone} ${y + quietZone}h${x - start}v1h${start - x}z`);
    }
  });
  return parts.join("");
}

/** The side, in modules, of the drawing: the symbol and its quiet zone. */
export function qrViewSize(matrix: QrMatrix, quietZone = 4): number {
  return matrix.size + quietZone * 2;
}

/** A standalone SVG of the code on a white background. Decorative: the caller names it (or hides it) as it needs. */
export function qrToSvg(text: string, options: { quietZone?: number; dark?: string; light?: string } = {}): string {
  const { quietZone = 4, dark = "#0f172a", light = "#ffffff" } = options;
  const matrix = encodeQr(text);
  const side = qrViewSize(matrix, quietZone);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges">` +
    `<path fill="${light}" d="M0 0h${side}v${side}H0z"/><path fill="${dark}" d="${qrPathData(matrix, quietZone)}"/></svg>`
  );
}
