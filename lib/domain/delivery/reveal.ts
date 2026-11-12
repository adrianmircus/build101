import { normalizeText } from "./leaks";

// Advisory, never a leak: does a text a teacher is about to approve state one of its solutions?
// «Respuesta correcta: **A**», «La respuesta correcta es la A», «Clave: A», «Solución: x = 1».
// Free text is approved by a teacher before publication and the generation prompts forbid
// stating answers, so this only produces warnings: T1.4c shows them when the teacher approves and
// T1.5a when they publish, without blocking. It looks at every text a student will read, labels
// and option texts included; the student's own answers are not passed in.

/** A reveal word, an optional «correcta», a separator, an optional article, then the value. */
const REVEAL = String.raw`(correct[ao]?|respuesta|solucion|clave|answer|pista)(\s+correct[ao]?)?\s*(:|=|\bes\b|\bera\b|\bis\b)\s*((la|el|un|una|opcion)\s+)?`;

/** After the value: not a letter or digit, and not the rest of a number («1» in «1/2», «1.5», «1,5»). */
const VALUE_END = String.raw`(?![a-z0-9]|[/.,:]\d)`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lower case, no accents and no Markdown emphasis or code marks around words. */
function plain(text: string): string {
  return normalizeText(text).replace(/[*_~`]/g, "");
}

export function revealsSolution(text: string, solutions: readonly string[]): boolean {
  const normalized = plain(text);
  return solutions.some((solution) =>
    new RegExp(`${REVEAL}${escapeRegExp(plain(solution))}${VALUE_END}`).test(normalized),
  );
}

export type TextToReview = { path: string; text: string };

/** The paths of the texts that seem to state a solution, for the teacher to look at. */
export function revealWarnings(texts: readonly TextToReview[], solutions: readonly string[]): string[] {
  return texts.filter((entry) => revealsSolution(entry.text, solutions)).map((entry) => entry.path);
}
