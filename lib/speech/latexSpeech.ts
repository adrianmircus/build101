// Turns an exercise written with markdown + LaTeX into plain words to read aloud ("Escuchar"). Without AI: it only
// knows the common notation of high school math and chemistry (\ce and \pu from mhchem); anything else is read as
// close to the symbols as possible.
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

const spell = (word: string) => [...word].map((c) => LETTERS[c.toLowerCase()] ?? c).join(" ");

// Words already decided go between ⟦ ⟧ so the letter naming leaves them alone ("de" in "f de x" is not "d", "e").
const keep = (words: string) => `⟦${words}⟧`;

// Names every letter that is a variable, skipping \commands and the words already decided: "xy" is "equis i griega".
function nameLetters(tex: string): string {
  return tex.replace(/⟦[^⟧]*⟧|\\[a-zA-Z]+|[a-zA-Z]+/g, (token) =>
    token.startsWith("⟦") || token.startsWith("\\") ? token : ` ${spell(token)} `,
  );
}

// Chemistry (mhchem): \ce{2H2 + O2 -> 2H2O} is "2 hache 2 más o 2, produce, 2 hache 2 o". Element symbols are
// spelled the way a teacher reads them on the board, and the numbers stay digits, like in the math.
const ARROWS: Record<string, string> = { "<=>": "en equilibrio con", "<->": "en equilibrio con", "->": "produce", "<-": "se obtiene de" };
const STATES: Record<string, string> = { "(s)": "sólido", "(l)": "líquido", "(g)": "gaseoso", "(aq)": "acuoso" };
const CHEM_TOKEN = /<=>|<->|->|<-|\((?:s|l|g|aq)\)|\^\{?[\d+-]*\}?|_\{?\d*\}?|[A-Z][a-z]?|[a-z]+|\d+(?:[.,]\d+)?|\S/g;

// "2-" is "2 menos" and "+" is "más"; anything else (an isotope's mass number) is read as is.
const charge = (sup: string) => sup.replace(/^(\d*)([+-])$/, (_, n: string, sign: string) => `${n} ${sign === "+" ? "más" : "menos"}`);

function speakChem(body: string): string {
  const words: string[] = [];
  for (const { 0: token, index } of body.matchAll(CHEM_TOKEN)) {
    const next = body[index + token.length] ?? " ";
    // A sign stuck to the species is its charge (Na+, Cl-), with a pause after so "Na+ + Cl-" isn't "más más".
    const stuck = index > 0 && /\S/.test(body[index - 1]);
    if (token in ARROWS) words.push(`, ${ARROWS[token]},`);
    else if (token in STATES) words.push(STATES[token]);
    else if (token.startsWith("^")) words.push(`, ${charge(token.replace(/^\^\{?|\}$/g, ""))},`);
    else if (token.startsWith("_")) words.push(token.replace(/^_\{?|\}$/g, ""));
    else if (/^[A-Za-z]/.test(token)) words.push(spell(token));
    else if (/^\d/.test(token)) words.push(decimal(token));
    // A "-" between two symbols is a bond (CH3-CH3), a pause.
    else if (token === "-" && stuck && /[A-Za-z0-9]/.test(next)) words.push(",");
    else if (token === "+" || token === "-") words.push(`${token === "+" ? "más" : "menos"}${stuck ? "," : ""}`);
    // Parentheses, brackets and the dot of a hydrate (CuSO4*5H2O) are pauses.
    else words.push(",");
  }
  return words.join(" ");
}

// Units (\pu{9.8 m/s^2}): "9,8 metros por segundo al cuadrado". A unit missing here is spelled letter by letter.
const UNITS: Record<string, [string, string]> = {
  m: ["metro", "metros"], cm: ["centímetro", "centímetros"], mm: ["milímetro", "milímetros"], km: ["kilómetro", "kilómetros"],
  s: ["segundo", "segundos"], min: ["minuto", "minutos"], h: ["hora", "horas"],
  g: ["gramo", "gramos"], kg: ["kilogramo", "kilogramos"], mg: ["miligramo", "miligramos"],
  mol: ["mol", "moles"], L: ["litro", "litros"], mL: ["mililitro", "mililitros"], M: ["molar", "molar"],
  K: ["kelvin", "kelvin"], "°C": ["grado Celsius", "grados Celsius"],
  N: ["newton", "newtons"], J: ["joule", "joules"], kJ: ["kilojoule", "kilojoules"], W: ["watt", "watts"],
  Pa: ["pascal", "pascales"], kPa: ["kilopascal", "kilopascales"], atm: ["atmósfera", "atmósferas"],
  A: ["ampere", "amperes"], V: ["volt", "volts"], Hz: ["hertz", "hertz"],
};
const POWERS: Record<string, string> = { "2": "al cuadrado", "3": "al cubo" };
const negative = (n: string) => n.replace("-", "menos ");
// "9.8" and "9,8" are "9 coma 8": a bare comma would read as a pause.
const decimal = (n: string) => n.replace(/[.,]/, " coma ");

function speakUnits(body: string): string {
  const words: string[] = [];
  // Plural unless the amount is exactly 1; after "/" the unit is singular: "kilojoules por mol".
  let singular = /^\s*1\s/.test(body);
  for (const [token] of body.matchAll(/°C|[A-Za-zµΩ]+|-?\d+(?:[.,]\d+)?(?:e-?\d+)?|\^\{?-?\d+\}?|\//g)) {
    if (token === "/") {
      words.push("por");
      singular = true;
    } else if (token.startsWith("^")) {
      const power = token.replace(/^\^\{?|\}$/g, "");
      words.push(POWERS[power] ?? `a la ${negative(power)}`);
    } else if (/^-?\d/.test(token)) {
      const [number, exponent] = token.split("e");
      words.push(negative(decimal(number)),...(exponent ? [`por 10 a la ${negative(exponent)}`] : []));
    } else words.push(UNITS[token]?.[singular ? 0 : 1] ?? spell(token));
  }
  return words.join(" ");
}

// Function names: any letter but the usual variables, so x(x + 1) stays a product and f(x), C(x), d(t) are functions.
const FUNCTION = /(?<![\\a-zA-Z])([a-wA-Z])('*)\(([^()]*)\)/g;

function speakMath(tex: string): string {
  let out = tex
    // Chemistry and units first, already in words: the "-" in \ce{SO4^2-} is a charge, not a subtraction.
    .replace(/\\(ce|pu)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_, kind: string, body: string) =>
      ` ${keep(kind === "ce" ? speakChem(body) : speakUnits(body))} `,
    )
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
