import { dataOf } from "./blocks";
import { readCodewords, readFormat, type Modules } from "./layout";
import { readSegments } from "./segments";

// A QR decoder for the tests of lib/client/qr.ts. It reads a module matrix of versions 1 to 10, level M, the way a
// scanner would, and checks the Reed-Solomon codewords. It shares no code with the encoder: the tables are typed in from
// ISO/IEC 18004 and the field arithmetic is the plain one. It only lives in tests; the app has no decoder.

export type Decoded = { version: number; mask: number; text: string; bytes: Uint8Array; data: number[] };

export function decodeQr(modules: Modules): Decoded {
  const version = (modules.length - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 10) throw new Error(`Tamaño de matriz inesperado: ${modules.length}`);
  const format = readFormat(modules);
  if (format >> 3 !== 0) throw new Error("No es nivel de corrección M");
  const mask = format & 7;
  const data = dataOf(readCodewords(modules, version, mask), version);
  return { version, mask, data, ...readSegments(data, version) };
}
