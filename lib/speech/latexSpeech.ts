// Turns an exercise written with markdown + LaTeX into plain words to read aloud ("Escuchar"). Without AI: it only
// knows the common notation of high school math; anything else is read as close to the symbols as possible.
// Only for the audio: the screen keeps showing the formula drawn by KaTeX.

const COMMANDS: [RegExp, string][] = [
  [/\\left|\\right|\\displaystyle|\\,|\\;|\\!|\\quad/g, " "],
  [/\\cdot|\\times/g, " por "],
  [/\\div/g, " dividido "],
  [/\\pm/g, " más o menos "],
  [/\\leq?\b/g, " menor o igual que "],
  [/\\geq?\b/g, " mayor o igual que "],
  [/\\neq?\b/g, " distinto de "],
  [/\\approx/g, " aproximadamente "],
  [/\\infty/g, " infinito "],
  [/\\to|\\rightarrow/g, " tiende a "],
  [/\\in\b/g, " pertenece a "],
  [/\\pi\b/g, " pi "],
  [/\\mathbb\{R\}/g, " los reales "],
  [/\\mathbb\{N\}/g, " los naturales "],
  [/\\mathbb\{Z\}/g, " los enteros "],
  [/\\(sin|sen)\b/g, " seno de "],
  [/\\cos\b/g, " coseno de "],
  [/\\tan\b/g, " tangente de "],
  [/\\ln\b/g, " logaritmo natural de "],
  [/\\log\b/g, " logaritmo de "],
];

function speakMath(tex: string): string {
  let out = tex;
  // Innermost first, so nested fractions and roots also read well.
  for (let i = 0; i < 5; i++) {
    out = out
      .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, " $1 sobre $2 ")
      .replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, " raíz $1 de $2 ")
      .replace(/\\sqrt\{([^{}]*)\}/g, " raíz cuadrada de $1 ")
      .replace(/\\lim_\{([^{}]*)\}/g, " límite cuando $1 de ")
      .replace(/\\(?:text|mathrm|operatorname)\{([^{}]*)\}/g, " $1 ");
  }
  out = out
    .replace(/\^\{?2\}?/g, " al cuadrado ")
    .replace(/\^\{?3\}?/g, " al cubo ")
    .replace(/\^\{([^{}]*)\}|\^(\S)/g, (_, a, b) => ` a la ${a ?? b} `)
    .replace(/_\{([^{}]*)\}|_(\S)/g, (_, a, b) => ` sub ${a ?? b} `);
  for (const [pattern, words] of COMMANDS) out = out.replace(pattern, words);
  return out
    .replace(/=/g, " igual a ")
    .replace(/</g, " menor que ")
    .replace(/>/g, " mayor que ")
    .replace(/\+/g, " más ")
    .replace(/-/g, " menos ")
    .replace(/\(/g, " abre paréntesis ")
    .replace(/\)/g, " cierra paréntesis ")
    .replace(/\\[a-zA-Z]+|[{}\\]/g, " ");
}

export function speechText(markdown: string): string {
  return markdown
    .replace(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g, (_, block, inline) => ` ${speakMath(block ?? inline)} `)
    .replace(/\*\*|__|^#+\s*/gm, "")
    .replace(/^\|?[\s:|-]+\|?$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, ". ")
    .trim();
}
