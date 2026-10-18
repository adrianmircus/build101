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
  [/\\(sin|sen)\b/g, " seno de "],
  [/\\cos\b/g, " coseno de "],
  [/\\tan\b/g, " tangente de "],
  [/\\ln\b/g, " logaritmo natural de "],
  [/\\log\b/g, " logaritmo de "],
];

// Letters said by name: a voice reading "3x" says "tres I" or "tres por"; a teacher says "tres equis".
const LETTERS: Record<string, string> = {
  a: "a", b: "be", c: "ce", d: "de", e: "e", f: "efe", g: "ge", h: "hache", i: "i", j: "jota", k: "ka", l: "ele",
  m: "eme", n: "ene", o: "o", p: "pe", q: "cu", r: "erre", s: "ese", t: "te", u: "u", v: "ve", w: "doble ve",
  x: "equis", y: "i griega", z: "zeta",
};

// Words already decided go between ⟦ ⟧ so the letter naming leaves them alone ("de" in "f de x" is not "d", "e").
const keep = (words: string) => `⟦${words}⟧`;

// Names every letter that is a variable, skipping \commands and the words already decided: "xy" is "equis i griega".
function nameLetters(tex: string): string {
  return tex.replace(/⟦[^⟧]*⟧|\\[a-zA-Z]+|[a-zA-Z]+/g, (token) =>
    token.startsWith("⟦") || token.startsWith("\\")
      ? token
      : ` ${[...token].map((c) => LETTERS[c.toLowerCase()] ?? c).join(" ")} `,
  );
}

// Function names: any letter but the usual variables, so x(x + 1) stays a product and f(x), C(x), d(t) are functions.
const FUNCTION = /(?<![\\a-zA-Z])([a-wA-Z])('*)\(([^()]*)\)/g;

function speakMath(tex: string): string {
  let out = tex
    .replace(/\\left|\\right/g, "")
    .replace(/\\(?:text|mathrm|operatorname)\{([^{}]*)\}/g, (_, words) => ` ${keep(words)} `)
    .replace(/\\mathbb\{R\}/g, keep(" los reales "))
    .replace(/\\mathbb\{N\}/g, keep(" los naturales "))
    .replace(/\\mathbb\{Z\}/g, keep(" los enteros "))
    .replace(/\\mathbb\{Q\}/g, keep(" los racionales "))
    // sen(x) is "seno de x": the parentheses go.
    .replace(/(\\(?:sin|sen|cos|tan|ln|log))\s*\(([^()]*)\)/g, "$1 $2")
    // f(x) is "efe de equis", f'(x) "efe prima de equis".
    .replace(FUNCTION, (_, name: string, primes: string, arg: string) =>
      ` ${name}${primes ? keep(" prima".repeat(primes.length) + " ") : ""} ${keep(" de ")} ${arg} `,
    )
    // |x - 2| is "valor absoluto de x menos 2".
    .replace(/\|([^|]+)\|/g, (_, inner) => ` ${keep(" valor absoluto de ")} ${inner} , `)
    // 2(x + 3) and (x + 1)(x - 1) are products.
    .replace(/(?<!\\[a-zA-Z]*)([0-9a-zA-Z)}])\s*\(/g, "$1 \\cdot (")
    // (x - 1)^2 is "x menos 1, todo al cuadrado".
    .replace(/\(([^()]*)\)\s*\^/g, ` , $1 , ${keep(" todo ")} ^`);
  out = nameLetters(out);
  // Innermost first, so nested fractions and roots also read well.
  for (let i = 0; i < 5; i++) {
    out = out
      // A pause marks where a numerator with several terms ends: "x al cuadrado menos 4, sobre x menos 2".
      .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, num: string, den: string) =>
        ` , ${num}${/[+-]/.test(num) ? " ," : ""} sobre ${den} , `,
      )
      .replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, " raíz $1 de $2 ")
      .replace(/\\sqrt\{([^{}]*)\}/g, " raíz cuadrada de $1 ")
      .replace(/\\lim_\{([^{}]*)\}/g, " límite cuando $1 de ");
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
    // What's left of the parentheses is a pause, like a teacher's: "2 por, x más 3".
    .replace(/[()]/g, " , ")
    .replace(/\\[a-zA-Z]+|[{}\\]/g, " ")
    .replace(/[⟦⟧]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(?:\s*,)+\s*/g, ", ")
    .replace(/^\s*,\s*|\s*,\s*$/g, "")
    .trim();
}

export function speechText(markdown: string): string {
  return markdown
    .replace(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g, (_, block, inline) => ` ${speakMath(block ?? inline)} `)
    .replace(/\*\*|__|^#+\s*/gm, "")
    .replace(/^\|?[\s:|-]+\|?$/gm, "")
    .replace(/\|/g, ", ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, ". ")
    .replace(/\s+([.,;:?!])/g, "$1")
    .replace(/,([.;:?!])/g, "$1")
    .trim();
}
