// Lectura en voz alta de la matemática, en español, armada desde el árbol de mathjs (sin IA, no puede inventar).
// Se usa solo en los botones de audio ("Escuchar" y el de cada fórmula). Nunca como aria-label ni alttext del MathML:
// taparía la navegación de NVDA con MathCAT y el braille matemático (DAISY lo desaconseja).
import { parse } from "mathjs";
import { normalize } from "./equivalence";

// Los campos que speakNode lee de un nodo de mathjs; cuáles vienen depende de n.type.
type Node = {
  type: string;
  value: unknown;
  name: string;
  content: Node;
  fn: string | { name?: string };
  args: Node[];
  implicit: boolean;
};

function unparen(n: Node): Node {
  return n.type === "ParenthesisNode" ? n.content : n;
}

function speakNode(n: Node): string {
  switch (n.type) {
    case "ConstantNode":
      return String(n.value).replace(".", ",");
    case "SymbolNode":
      return n.name;
    case "ParenthesisNode":
      return `abre paréntesis, ${speakNode(n.content)}, cierra paréntesis`;
    case "FunctionNode": {
      const name = (typeof n.fn === "object" ? n.fn.name : undefined) ?? String(n.fn);
      const args = n.args.map(speakNode).join(", ");
      if (name === "sqrt") return `raíz cuadrada de ${args}`;
      if (name === "abs") return `valor absoluto de ${args}`;
      // normalize ya dejó log10 para "log" (base 10, como en los prácticos), ln para el neperiano y log(x, b) para otra base.
      if (name === "log10") return `logaritmo de ${args}`;
      if (name === "ln") return `logaritmo neperiano de ${args}`;
      if (name === "log2") return `logaritmo en base 2 de ${args}`;
      if (name === "log") {
        const [x, base] = n.args.map((arg) => speakNode(unparen(arg)));
        return base === undefined ? `logaritmo neperiano de ${x}` : `logaritmo en base ${base} de ${x}`;
      }
      return `${name} de ${args}`; // f(x) -> "f de x", P(x) -> "P de x"
    }
    case "OperatorNode": {
      const [a, b] = n.args;
      switch (n.fn) {
        case "add":
          return `${speakNode(a)} más ${speakNode(b)}`;
        case "subtract":
          return `${speakNode(a)} menos ${speakNode(b)}`;
        case "multiply":
          // 5*x se lee "5 x", como se dice en clase; 3*4 se lee "3 por 4"
          return n.implicit || (a.type === "ConstantNode" && b.type !== "ConstantNode")
            ? `${speakNode(a)} ${speakNode(b)}`
            : `${speakNode(a)} por ${speakNode(b)}`;
        case "divide":
          if (a.type === "ParenthesisNode" || b.type === "ParenthesisNode") {
            return `fracción: numerador ${speakNode(unparen(a))}, denominador ${speakNode(unparen(b))}, fin de la fracción`;
          }
          return `${speakNode(a)} sobre ${speakNode(b)}`;
        case "pow": {
          const exp = b.type === "ConstantNode" ? Number(b.value) : NaN;
          if (exp === 2) return `${speakNode(a)} al cuadrado`;
          if (exp === 3) return `${speakNode(a)} al cubo`;
          return `${speakNode(a)} elevado a ${speakNode(b)}`;
        }
        case "unaryMinus":
          return `menos ${speakNode(a)}`;
        case "unaryPlus":
          return speakNode(a);
      }
      return n.toString();
    }
  }
  return n.toString();
}

export function speakMath(mathjs: string): string {
  try {
    const sides = normalize(mathjs).split("=");
    return sides.map((s) => speakNode(parse(s) as unknown as Node)).join(" igual a ");
  } catch {
    return mathjs; // inecuaciones, sistemas o algo que mathjs no parsea: se lee tal cual
  }
}
