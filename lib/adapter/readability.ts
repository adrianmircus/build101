// Legibilidad en español: índice de Szigriszt-Pazos (escala INFLESZ). Más alto es más fácil.
const VOWELS = "aeiouáéíóúü";
const STRONG = "aeoáéóíú"; // í y ú acentuadas rompen el diptongo (hiato)

// Con menos palabras que esto (un práctico que es casi todo fórmulas), el índice no dice nada: no aplica.
export const MIN_WORDS = 15;

export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-záéíóúüñ]/g, "");
  if (!w) return 0;
  let count = 0;
  let prev: string | null = null;
  for (const ch of w) {
    if (VOWELS.includes(ch)) {
      if (prev === null) count++;
      else if (STRONG.includes(ch) && STRONG.includes(prev)) count++;
      prev = ch;
    } else {
      prev = null;
    }
  }
  return Math.max(1, count);
}

// null si el texto tiene menos de MIN_WORDS palabras. Si no, un valor entre 0 y 100.
export function readability(text: string): number | null {
  const sentences = text.split(/[.!?;:\n]+/).filter((s) => /[a-záéíóúüñ]/i.test(s));
  const words = text.split(/[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ]+/).filter(Boolean);
  if (words.length < MIN_WORDS || sentences.length === 0) return null;
  const syl = words.reduce((acc, w) => acc + syllables(w), 0);
  const score = 206.835 - 62.3 * (syl / words.length) - words.length / sentences.length;
  return Math.round(Math.min(100, Math.max(0, score)));
}

export function readabilityLabel(score: number): string {
  if (score < 40) return "Muy difícil";
  if (score < 55) return "Algo difícil";
  if (score < 65) return "Normal";
  if (score < 80) return "Bastante fácil";
  return "Muy fácil";
}
