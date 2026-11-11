// Pruebas sin IA de cómo se separan los ejercicios de una versión y de cómo se lee su Markdown con LaTeX.
import { expect, it } from "vitest";
import { splitExercises } from "@/lib/results/exercises";
import { parseMathMarkdown } from "@/lib/math-markdown";

const numbers = (text: string) => splitExercises(text).map((e) => e.number);
const texts = (text: string) => splitExercises(text).map((e) => e.text);

// Lo que devolvió el agente en la demo de 6.º A (versiones Sin adaptación, Disgrafía y TDAH + Dislexia).
const agente = `# Ecuaciones racionales

**1)** Resolvé en $\\mathbb{R}$:
$$\\frac{x+2}{x-3} = 2$$

**2)** Resolvé en $\\mathbb{R}$:
$$\\frac{3}{x} + \\frac{1}{2} = 1$$

**3)** Hallá el dominio y resolvé:
$$\\frac{x}{x+1} = \\frac{2}{x-1}$$`;
it("ejercicios: **1)** del agente da 3", () => {
  expect(numbers(agente)).toEqual([1, 2, 3]);
});
it("ejercicios: el título no queda en el primero", () => {
  expect(texts(agente)[0]).toEqual("Resolvé en $\\mathbb{R}$:\n$$\\frac{x+2}{x-3} = 2$$");
});
it("ejercicios: 1) por línea (versión TDAH)", () => {
  expect(numbers("1) Resolvé $x+1=2$\n2) Resolvé $x-1=0$\n3) Resolvé $2x=4$")).toEqual([1, 2, 3]);
});
it("ejercicios: 1. con punto", () => {
  expect(numbers("1. Resolvé\n2. Calculá\n3. Hallá")).toEqual([1, 2, 3]);
});
it("ejercicios: **1.** en negrita con punto", () => {
  expect(numbers("**1.** Resolvé\n**2.** Calculá")).toEqual([1, 2]);
});
it("ejercicios: **Ejercicio 1** solo en su línea", () => {
  expect(splitExercises("## Práctico\n**Ejercicio 1**\nResolvé $x=1$\n**Ejercicio 2:**\nCalculá")).toEqual([
  { number: 1, label: "Ej. 1", text: "Resolvé $x=1$" },
  { number: 2, label: "Ej. 2", text: "Calculá" },
]);
});
it("ejercicios: ### 1) como subtítulo", () => {
  expect(numbers("# Práctico\n### 1) Resolvé\n### 2) Calculá")).toEqual([1, 2]);
});
it("ejercicios: Ej. 3 y Ejercicio 4", () => {
  expect(numbers("Ej. 3 Resolvé\nEjercicio 4: Calculá")).toEqual([3, 4]);
});
it("ejercicios: la negrita que sigue después del número queda abierta", () => {
  expect(texts("**1) Resolvé** en R\n**2) Calculá** esto")).toEqual(["**Resolvé** en R", "**Calculá** esto"]);
});
it("ejercicios: un decimal no es un ejercicio", () => {
  expect(numbers("1) Calculá\n2.5 + 3 = ?\n2) Resolvé")).toEqual([1, 2]);
});
it("ejercicios: una cuenta con número suelto no es un ejercicio", () => {
  expect(numbers("1) Calculá:\n2 + 3 = 5\n2) Resolvé")).toEqual([1, 2]);
});
it("ejercicios: los números solo suben", () => {
  expect(numbers("1) Resolvé\n2) Calculá:\n1 - x = 3\n3) Hallá")).toEqual([1, 2, 3]);
});
it("ejercicios: los separadores --- no suman texto", () => {
  expect(texts("1) Resolvé\n---\n2) Calculá")).toEqual(["Resolvé", "Calculá"]);
});
it("ejercicios: sin numerar es uno solo, sin el título", () => {
  expect(splitExercises("# Ecuaciones\n\nResolvé $x+1=2$")).toEqual([{ number: 1, label: "Ej. 1", text: "Resolvé $x+1=2$" }]);
});
it("ejercicios: con CRLF", () => {
  expect(numbers("**1)** Resolvé\r\n**2)** Calculá\r\n")).toEqual([1, 2]);
});

// Markdown con LaTeX
it("markdown: negrita y fórmula en línea", () => {
  expect(parseMathMarkdown("**Resolvé** en $\\mathbb{R}$:")).toEqual([
  {
    kind: "line",
    heading: false,
    bullet: false,
    inlines: [
      { kind: "text", value: "Resolvé", bold: true },
      { kind: "text", value: " en ", bold: false },
      { kind: "math", value: "\\mathbb{R}", bold: false },
      { kind: "text", value: ":", bold: false },
    ],
  },
]);
});
it("markdown: $$ en bloque, sin líneas en blanco de más", () => {
  expect(parseMathMarkdown("Resolvé:\n$$\\frac{x+2}{x-3} = 2$$").map((b) => b.kind)).toEqual(["line", "math"]);
});
it("markdown: $$ en bloque en varias líneas", () => {
  expect(parseMathMarkdown("$$\n\\frac{1}{x}\n$$")).toEqual([{ kind: "math", tex: "\\frac{1}{x}" }]);
});
it("markdown: \\( \\) y \\[ \\]", () => {
  expect(parseMathMarkdown("Si \\(x>0\\):\n\\[x^2=4\\]").flatMap((b) => (b.kind === "math" ? [b.tex] : b.kind === "line" ? b.inlines.filter((i) => i.kind === "math").map((i) => i.value) : []))).toEqual(["x>0", "x^2=4"]);
});
const plata = (s: string) => parseMathMarkdown(s).flatMap((b) => (b.kind === "line" ? b.inlines.map((i) => i.kind) : []));
it("markdown: pesos con $ no son fórmulas", () => {
  expect(plata("Pagó $150 y le dieron $20 de vuelto")).toEqual(["text"]);
});
it("markdown: $ 150 con espacio no es fórmula", () => {
  expect(plata("Cuesta $ 150 y $ 200")).toEqual(["text"]);
});
it("markdown: ** sin pareja se muestra tal cual", () => {
  expect(parseMathMarkdown("2 ** 3")).toEqual([{ kind: "line", heading: false, bullet: false, inlines: [{ kind: "text", value: "2 ** 3", bold: false }] }]);
});
it("markdown: título e ítem", () => {
  expect(parseMathMarkdown("# Ecuaciones\n- a) $x=1$").map((b) => (b.kind === "line" ? [b.heading, b.bullet] : b.kind))).toEqual([[true, false], [false, true]]);
});
it("markdown: un renglón vacío entre párrafos", () => {
  expect(parseMathMarkdown("Uno\n\nDos").map((b) => b.kind)).toEqual(["line", "blank", "line"]);
});
it("markdown: --- es una pausa, no texto", () => {
  expect(parseMathMarkdown("Uno\n---\nDos").map((b) => b.kind)).toEqual(["line", "blank", "line"]);
});
