// Reading the segments of the data stream: byte mode (0100), alphanumeric mode (0010) and the terminator (0000).
// Other tools mix modes, and the reference matrices in the fixtures do.

const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

type Reader = { stream: string; pos: number };

function take(reader: Reader, bits: number): number {
  const value = parseInt(reader.stream.slice(reader.pos, reader.pos + bits), 2);
  reader.pos += bits;
  return value;
}

function readBytes(reader: Reader, version: number): Uint8Array {
  const count = take(reader, version <= 9 ? 8 : 16);
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count; i++) bytes[i] = take(reader, 8);
  return bytes;
}

function readAlphanumeric(reader: Reader, version: number): string {
  const count = take(reader, version <= 9 ? 9 : 11);
  let text = "";
  for (let i = 0; i < count; i += 2) {
    if (i + 1 < count) {
      const value = take(reader, 11);
      text += (ALPHANUMERIC[Math.floor(value / 45)] ?? "?") + (ALPHANUMERIC[value % 45] ?? "?");
    } else {
      text += ALPHANUMERIC[take(reader, 6)] ?? "?";
    }
  }
  return text;
}

export type Segments = { text: string; bytes: Uint8Array };

export function readSegments(data: readonly number[], version: number): Segments {
  const reader: Reader = { stream: data.map((byte) => byte.toString(2).padStart(8, "0")).join(""), pos: 0 };
  const pieces: number[] = [];
  let text = "";
  while (reader.pos + 4 <= reader.stream.length) {
    const mode = take(reader, 4);
    if (mode === 0) break;
    if (mode === 0b0100) {
      const chunk = readBytes(reader, version);
      pieces.push(...chunk);
      text += new TextDecoder().decode(chunk);
    } else if (mode === 0b0010) {
      const chunk = readAlphanumeric(reader, version);
      pieces.push(...new TextEncoder().encode(chunk));
      text += chunk;
    } else {
      throw new Error(`Modo no soportado por el decodificador de prueba: ${mode}`);
    }
  }
  return { text, bytes: Uint8Array.from(pieces) };
}
