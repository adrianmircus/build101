// Tables of ISO/IEC 18004 for the decoder of the tests (level M, versions 1 to 10). They are typed in from the standard
// (tables 1, 7 and E.1), not taken from the encoder, so the two do not share a mistake.

export type Group = { count: number; data: number };
export type Structure = { ecc: number; groups: Group[] };

const STRUCTURES: Structure[] = [
  { ecc: 10, groups: [{ count: 1, data: 16 }] },
  { ecc: 16, groups: [{ count: 1, data: 28 }] },
  { ecc: 26, groups: [{ count: 1, data: 44 }] },
  { ecc: 18, groups: [{ count: 2, data: 32 }] },
  { ecc: 24, groups: [{ count: 2, data: 43 }] },
  { ecc: 16, groups: [{ count: 4, data: 27 }] },
  { ecc: 18, groups: [{ count: 4, data: 31 }] },
  { ecc: 22, groups: [{ count: 2, data: 38 }, { count: 2, data: 39 }] },
  { ecc: 22, groups: [{ count: 3, data: 36 }, { count: 2, data: 37 }] },
  { ecc: 26, groups: [{ count: 4, data: 43 }, { count: 1, data: 44 }] },
];

const ALIGNMENT: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

export function structureOf(version: number): Structure {
  const found = STRUCTURES[version - 1];
  if (found === undefined) throw new Error(`Versión sin tabla: ${version}`);
  return found;
}

export function alignmentOf(version: number): number[] {
  return ALIGNMENT[version - 1] ?? [];
}
