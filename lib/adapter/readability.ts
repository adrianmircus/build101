// Legibilidad en español: índice de Szigriszt-Pazos (escala INFLESZ). Más alto es más fácil.
const VOWELS = "aeiouáéíóúü";
const STRONG = "aeoáéóíú"; // í y ú acentuadas rompen el diptongo (hiato)

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

export function readability(text: string): number {
  const sentences = text.split(/[.!?;:\n]+/).filter((s) => /[a-záéíóúüñ]/i.test(s));
  const words = text.split(/[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ]+/).filter(Boolean);
  if (words.length === 0 || sentences.length === 0) return 0;
  const syl = words.reduce((acc, w) => acc + syllables(w), 0);
  return Math.round(206.835 - 62.3 * (syl / words.length) - words.length / sentences.length);
}

export function readabilityLabel(score: number): string {
  if (score < 40) return "Muy difícil";
  if (score < 55) return "Algo difícil";
  if (score < 65) return "Normal";
  if (score < 80) return "Bastante fácil";
  return "Muy fácil";
}
