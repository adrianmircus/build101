// Voice commands for students who navigate by voice. Every command is concrete ("Ejercicio 3", "Abrir Funciones"),
// never a template, so the AI fallback always picks an id from a closed list.
export type VoiceCommand = {
  id: string;
  label: string; // what "¿Qué puedo decir?" shows
  phrases: string[]; // any of these, said inside a sentence, triggers it
  run: () => void;
};

const NUMBERS: Record<string, string> = {
  uno: "1", primero: "1", primer: "1",
  dos: "2", segundo: "2",
  tres: "3", tercero: "3", tercer: "3",
  cuatro: "4", cuarto: "4",
  cinco: "5", quinto: "5",
  seis: "6", sexto: "6",
  siete: "7", septimo: "7",
  ocho: "8", octavo: "8",
  nueve: "9", noveno: "9",
  diez: "10", decimo: "10",
  once: "11", doce: "12", trece: "13", catorce: "14", quince: "15",
  dieciseis: "16", diecisiete: "17", dieciocho: "18", diecinueve: "19", veinte: "20",
};

// Lowercase, no accents or punctuation, and number words as digits: "¿El ejercicio tres?" → "el ejercicio 3".
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim()
    .split(" ")
    .map((word) => NUMBERS[word] ?? word)
    .join(" ");
}

// The command whose phrase appears in what was heard, preferring the longest phrase ("si entregar" over "entregar").
// A phrase that more than one command uses is ambiguous ("funciones" in two assessments): it doesn't count,
// and the AI fallback decides.
export function matchCommand(heard: string, commands: VoiceCommand[]): VoiceCommand | null {
  const text = ` ${normalize(heard)} `;
  const owners = new Map<string, Set<string>>();
  for (const c of commands) {
    for (const p of c.phrases) {
      const phrase = normalize(p);
      if (phrase) owners.set(phrase, (owners.get(phrase) ?? new Set()).add(c.id));
    }
  }
  let best: { command: VoiceCommand; length: number } | null = null;
  for (const c of commands) {
    for (const p of c.phrases) {
      const phrase = normalize(p);
      if (!phrase || owners.get(phrase)!.size > 1 || !text.includes(` ${phrase} `)) continue;
      if (!best || phrase.length > best.length) best = { command: c, length: phrase.length };
    }
  }
  return best?.command ?? null;
}

const STOPWORDS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "o", "u", "en", "con", "para", "por", "un", "una", "al"]);

// Phrases to open an assessment by its topic: the whole topic and each meaningful word of it
// ("Funciones: dominio y recorrido" → "funciones", "dominio", "recorrido").
export function topicPhrases(topic: string): string[] {
  const whole = normalize(topic);
  const words = whole.split(" ").filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return [whole, ...words];
}
