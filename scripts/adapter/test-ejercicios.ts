// Pruebas sin IA de cómo se separan los ejercicios de una versión y de cómo se lee su Markdown con LaTeX.
// Correr con: npx tsx scripts/adapter/test-ejercicios.ts
import { splitExercises } from "../../lib/results/exercises";
import { parseMathMarkdown } from "../../lib/math-markdown";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FALLA"} ${name}${pass ? "" : `\n      esperado ${JSON.stringify(want)}\n      obtenido ${JSON.stringify(got)}`}`);
}
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
check("ejercicios: **1)** del agente da 3", numbers(agente), [1, 2, 3]);
check("ejercicios: el título no queda en el primero", texts(agente)[0], "Resolvé en $\\mathbb{R}$:\n$$\\frac{x+2}{x-3} = 2$$");
check("ejercicios: 1) por línea (versión TDAH)", numbers("1) Resolvé $x+1=2$\n2) Resolvé $x-1=0$\n3) Resolvé $2x=4$"), [1, 2, 3]);
check("ejercicios: 1. con punto", numbers("1. Resolvé\n2. Calculá\n3. Hallá"), [1, 2, 3]);
check("ejercicios: **1.** en negrita con punto", numbers("**1.** Resolvé\n**2.** Calculá"), [1, 2]);
check("ejercicios: **Ejercicio 1** solo en su línea", splitExercises("## Práctico\n**Ejercicio 1**\nResolvé $x=1$\n**Ejercicio 2:**\nCalculá"), [
  { number: 1, label: "Ej. 1", text: "Resolvé $x=1$" },
  { number: 2, label: "Ej. 2", text: "Calculá" },
]);
check("ejercicios: ### 1) como subtítulo", numbers("# Práctico\n### 1) Resolvé\n### 2) Calculá"), [1, 2]);
check("ejercicios: Ej. 3 y Ejercicio 4", numbers("Ej. 3 Resolvé\nEjercicio 4: Calculá"), [3, 4]);
check("ejercicios: la negrita que sigue después del número queda abierta", texts("**1) Resolvé** en R\n**2) Calculá** esto"), ["**Resolvé** en R", "**Calculá** esto"]);
check("ejercicios: un decimal no es un ejercicio", numbers("1) Calculá\n2.5 + 3 = ?\n2) Resolvé"), [1, 2]);
check("ejercicios: una cuenta con número suelto no es un ejercicio", numbers("1) Calculá:\n2 + 3 = 5\n2) Resolvé"), [1, 2]);
check("ejercicios: los números solo suben", numbers("1) Resolvé\n2) Calculá:\n1 - x = 3\n3) Hallá"), [1, 2, 3]);
check("ejercicios: los separadores --- no suman texto", texts("1) Resolvé\n---\n2) Calculá"), ["Resolvé", "Calculá"]);
check("ejercicios: sin numerar es uno solo, sin el título", splitExercises("# Ecuaciones\n\nResolvé $x+1=2$"), [{ number: 1, label: "Ej. 1", text: "Resolvé $x+1=2$" }]);
check("ejercicios: con CRLF", numbers("**1)** Resolvé\r\n**2)** Calculá\r\n"), [1, 2]);

// Markdown con LaTeX
check("markdown: negrita y fórmula en línea", parseMathMarkdown("**Resolvé** en $\\mathbb{R}$:"), [
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
check("markdown: $$ en bloque, sin líneas en blanco de más", parseMathMarkdown("Resolvé:\n$$\\frac{x+2}{x-3} = 2$$").map((b) => b.kind), ["line", "math"]);
check("markdown: $$ en bloque en varias líneas", parseMathMarkdown("$$\n\\frac{1}{x}\n$$"), [{ kind: "math", tex: "\\frac{1}{x}" }]);
check("markdown: \\( \\) y \\[ \\]", parseMathMarkdown("Si \\(x>0\\):\n\\[x^2=4\\]").flatMap((b) => (b.kind === "math" ? [b.tex] : b.kind === "line" ? b.inlines.filter((i) => i.kind === "math").map((i) => i.value) : [])), ["x>0", "x^2=4"]);
const plata = (s: string) => parseMathMarkdown(s).flatMap((b) => (b.kind === "line" ? b.inlines.map((i) => i.kind) : []));
check("markdown: pesos con $ no son fórmulas", plata("Pagó $150 y le dieron $20 de vuelto"), ["text"]);
check("markdown: $ 150 con espacio no es fórmula", plata("Cuesta $ 150 y $ 200"), ["text"]);
check("markdown: ** sin pareja se muestra tal cual", parseMathMarkdown("2 ** 3"), [{ kind: "line", heading: false, bullet: false, inlines: [{ kind: "text", value: "2 ** 3", bold: false }] }]);
check("markdown: título e ítem", parseMathMarkdown("# Ecuaciones\n- a) $x=1$").map((b) => (b.kind === "line" ? [b.heading, b.bullet] : b.kind)), [[true, false], [false, true]]);
check("markdown: un renglón vacío entre párrafos", parseMathMarkdown("Uno\n\nDos").map((b) => b.kind), ["line", "blank", "line"]);
check("markdown: --- es una pausa, no texto", parseMathMarkdown("Uno\n---\nDos").map((b) => b.kind), ["line", "blank", "line"]);

console.log(failed === 0 ? "\nTodo pasa." : `\n${failed} pruebas fallan.`);
process.exit(failed === 0 ? 0 : 1);
