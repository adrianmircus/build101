// Tables and formulas of ISO/IEC 18004 for level M, versions 1 to 10 (up to 213 bytes of text).

// Error correction codewords per block and number of blocks (tables 7 and 9).
const EC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
export const MAX_VERSION = EC_PER_BLOCK.length;
const FORMAT_M = 0; // the two bits of level M in the format information (L=1, M=0, Q=3, H=2)

export function sizeOf(version: number): number {
  return version * 4 + 17;
}

export function eccPerBlock(version: number): number {
  return EC_PER_BLOCK[version - 1] ?? 0;
}

export function blockCount(version: number): number {
  return BLOCKS[version - 1] ?? 1;
}

/** Row/column centers of the alignment patterns (none in version 1). */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = sizeOf(version) - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}

/** Codewords (data and error correction) the symbol holds: the modules left after the function patterns, in bytes. */
export function rawCodewords(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2;
    modules -= (25 * count - 10) * count - 55;
    if (version >= 7) modules -= 36;
  }
  return Math.floor(modules / 8);
}

export function dataCodewords(version: number): number {
  return rawCodewords(version) - eccPerBlock(version) * blockCount(version);
}

/** Bits of the byte count field: 8 up to version 9, 16 from version 10. */
export function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

function bchRemainder(value: number, generatorPoly: number, degree: number): number {
  let rem = value;
  for (let i = 0; i < degree; i++) rem = (rem << 1) ^ (((rem >>> (degree - 1)) & 1) * generatorPoly);
  return rem;
}

/** The 15 bits of the format information for level M and a mask (7.9). */
export function formatBits(mask: number): number {
  const data = (FORMAT_M << 3) | mask;
  return ((data << 10) | bchRemainder(data, 0x537, 10)) ^ 0x5412;
}

/** The 18 bits of the version information, for versions 7 and up (7.10). */
export function versionBits(version: number): number {
  return (version << 12) | bchRemainder(version, 0x1f25, 12);
}

/** Whether a mask pattern flips the module (table 10). */
export function masked(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}
