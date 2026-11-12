import { describe, expect, it } from "vitest";
import { encodeQr, formatBits, qrPathData, qrToSvg, versionBits } from "./qr";
import { decodeQr } from "./qr/testing/decode";
import { REFERENCE_MATRICES } from "./qr.fixtures";

const toModules = (rows: string[]) => rows.map((row) => [...row].map((c) => c === "#"));
const TOKEN = "Zk3_9aQ-0000000000000000000000000000000000";

describe("el decodificador de prueba", () => {
  it.each(REFERENCE_MATRICES)("lee la matriz de referencia de $text, hecha por otra herramienta", ({ text, mask, rows }) => {
    const decoded = decodeQr(toModules(rows));
    expect(decoded.text).toBe(text);
    expect(decoded.mask).toBe(mask);
    expect(decoded.version).toBe(3);
  });
});

describe("constantes de la norma ISO/IEC 18004", () => {
  it("información de formato del nivel M, para las ocho máscaras (tabla C.1)", () => {
    const table = [
      "101010000010010",
      "101000100100101",
      "101111001111100",
      "101101101001011",
      "100010111111001",
      "100000011001110",
      "100111110010111",
      "100101010100000",
    ];
    table.forEach((bits, mask) => expect(formatBits(mask).toString(2).padStart(15, "0")).toBe(bits));
  });

  it("información de versión de las versiones 7 a 10 (tabla D.1)", () => {
    expect(versionBits(7)).toBe(0x07c94);
    expect(versionBits(8)).toBe(0x085bc);
    expect(versionBits(9)).toBe(0x09a99);
    expect(versionBits(10)).toBe(0x0a4d3);
  });
});

describe("encodeQr", () => {
  it("elige la versión más chica en que entra el texto (capacidad en bytes, nivel M)", () => {
    // Capacidad en modo byte, nivel M, versiones 1 a 10: 14, 26, 42, 62, 84, 106, 122, 152, 180, 213 (tabla 7).
    const capacity = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
    capacity.forEach((bytes, i) => {
      expect(encodeQr("a".repeat(bytes)).version).toBe(i + 1);
      if (i < capacity.length - 1) expect(encodeQr("a".repeat(bytes + 1)).version).toBe(i + 2);
    });
  });

  it("falla con un texto que no entra en la versión 10", () => {
    expect(() => encodeQr("a".repeat(214))).toThrow(RangeError);
  });

  it("dibuja los patrones fijos: buscadores, temporización y módulo oscuro", () => {
    const { modules, size, version } = encodeQr("https://tiza.ai/t#abc");
    expect(version).toBe(2);
    const finder = ["#######", "#.....#", "#.###.#", "#.###.#", "#.###.#", "#.....#", "#######"];
    for (const [x0, y0] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
      finder.forEach((row, dy) => [...row].forEach((c, dx) => expect(modules[y0 + dy]?.[x0 + dx]).toBe(c === "#")));
    }
    for (let i = 8; i < size - 8; i++) {
      expect(modules[6]?.[i]).toBe(i % 2 === 0);
      expect(modules[i]?.[6]).toBe(i % 2 === 0);
    }
    expect(modules[size - 8]?.[8]).toBe(true);
  });

  it("es determinista: el mismo texto da la misma matriz", () => {
    expect(encodeQr(`https://tiza.ai/t#${TOKEN}`).modules).toEqual(encodeQr(`https://tiza.ai/t#${TOKEN}`).modules);
  });

  describe("decodificar lo que genera da el mismo texto", () => {
    const urls = [
      "A",
      "https://tiza.ai/t#abc",
      `https://tiza.ai/t#${TOKEN}`,
      `https://colegio-san-jose.tiza.ai/t#${TOKEN}`,
      `https://localhost:3108/t#${TOKEN}`,
      "Hola, Joaquín: ¿cómo va? Ñandú ✓",
    ];
    it.each(urls)("%s", (text) => {
      const matrix = encodeQr(text);
      const decoded = decodeQr(matrix.modules);
      expect(decoded.text).toBe(text);
      expect(decoded.version).toBe(matrix.version);
      expect(decoded.mask).toBe(matrix.mask);
    });

    it("con cada una de las ocho máscaras", () => {
      for (let mask = 0; mask < 8; mask++) {
        const decoded = decodeQr(encodeQr(`https://tiza.ai/t#${TOKEN}`, mask).modules);
        expect(decoded.text).toBe(`https://tiza.ai/t#${TOKEN}`);
        expect(decoded.mask).toBe(mask);
      }
    });

    it("con todos los largos de 1 a 213 bytes (las diez versiones, con bloques cortos y largos)", () => {
      for (let length = 1; length <= 213; length++) {
        const text = Array.from({ length }, (_, i) => String.fromCharCode(33 + ((i * 7 + length) % 90))).join("");
        const decoded = decodeQr(encodeQr(text).modules);
        expect(decoded.text).toBe(text);
      }
    });
  });
});

describe("qrToSvg", () => {
  it("devuelve un SVG con la zona de silencio y un cuadrado oscuro por módulo oscuro", () => {
    const text = `https://tiza.ai/t#${TOKEN}`;
    const matrix = encodeQr(text);
    const svg = qrToSvg(text);
    const side = matrix.size + 8;
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${side} ${side}"`);
    expect(svg).toContain(qrPathData(matrix));
    // Cada corrida horizontal de módulos oscuros es un subtrazado; la suma de sus anchos son los módulos oscuros.
    const dark = matrix.modules.flat().filter(Boolean).length;
    const widths = [...qrPathData(matrix).matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    expect(widths).toBe(dark);
  });

  it("no lleva el texto codificado en claro dentro del SVG", () => {
    expect(qrToSvg(`https://tiza.ai/t#${TOKEN}`)).not.toContain(TOKEN);
  });
});
