import { remainder } from "./galois";
import { blockCount, countBits, dataCodewords, eccPerBlock, MAX_VERSION, rawCodewords } from "./spec";

// From the bytes of the text to the codewords of the symbol: the byte mode segment, the padding, the blocks with
// their error correction and the interleave (ISO/IEC 18004, 7.4 to 7.6).

export function chooseVersion(length: number): number {
  for (let version = 1; version <= MAX_VERSION; version++) {
    if (4 + countBits(version) + length * 8 <= dataCodewords(version) * 8) return version;
  }
  throw new RangeError(`El texto es demasiado largo para el código QR (${length} bytes).`);
}

function pushBits(bits: number[], value: number, count: number) {
  for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

export function dataBits(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  pushBits(bits, 0b0100, 4); // byte mode
  pushBits(bits, bytes.length, countBits(version));
  for (const byte of bytes) pushBits(bits, byte, 8);
  const capacity = dataCodewords(version) * 8;
  pushBits(bits, 0, Math.min(4, capacity - bits.length)); // terminator
  pushBits(bits, 0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) pushBits(bits, pad, 8);
  return bits;
}

function toBytes(bits: readonly number[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  return bytes;
}

function splitBlocks(data: readonly number[], version: number): number[][] {
  const blocks = blockCount(version);
  const raw = rawCodewords(version);
  const shortLength = Math.floor(raw / blocks) - eccPerBlock(version); // data codewords of a short block
  const shortCount = blocks - (raw % blocks);
  const out: number[][] = [];
  let at = 0;
  for (let i = 0; i < blocks; i++) {
    const length = shortLength + (i < shortCount ? 0 : 1);
    out.push(data.slice(at, at + length));
    at += length;
  }
  return out;
}

/** Adds the error correction of each block and interleaves everything as the standard says. */
export function codewords(bits: readonly number[], version: number): number[] {
  const dataBlocks = splitBlocks(toBytes(bits), version);
  const eccBlocks = dataBlocks.map((block) => remainder(block, eccPerBlock(version)));
  const longest = Math.max(...dataBlocks.map((block) => block.length));
  const out: number[] = [];
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i] ?? 0);
  }
  for (let i = 0; i < eccPerBlock(version); i++) {
    for (const block of eccBlocks) out.push(block[i] ?? 0);
  }
  return out;
}
