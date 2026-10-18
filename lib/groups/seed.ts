import type { Assessment, Data, ExerciseResult, Grade, Student } from "./types";
import { groupByProfiles } from "./versions";

// Sample data for the demo. All students are fictional.
function students(groupId: string, list: [string, string[], string[]?][]): Student[] {
  return list.map(([name, profiles, interests], i) => ({
    id: `${groupId}-s${i + 1}`,
    name,
    profiles,
    ...(interests && { interests }),
  }));
}

const STUDENTS_6A = students("6a", [
  ["Ana P.", [], ["música", "fútbol"]],
  ["Bruno M.", ["adhd"], ["fútbol", "videojuegos"]],
  ["Camila R.", ["dysgraphia"], ["fútbol"]],
  ["Diego S.", ["dyslexia"], ["básquetbol"]],
  ["Emilia G.", [], ["música", "dibujo"]],
  ["Facundo L.", ["adhd", "dyslexia"], ["videojuegos"]],
  ["Florencia V.", []],
  ["Joaquín B.", ["adhd"], ["fútbol"]],
  ["Lucía F.", []],
  ["Martina C.", ["dyslexia"], ["música", "básquetbol"]],
  ["Nicolás A.", [], ["fútbol"]],
  ["Valentina D.", []],
]);

// A past exam already corrected, so the Results tab has something to show from the start.
const EXAM_ORIGINAL = `1) Hallá el dominio de f(x) = √(x − 3).
2) Calculá f(2) y f(−1) para f(x) = 2x² − 3x + 1.
3) Indicá el recorrido de g(x) = x² + 1 y justificá.
4) Un taxi cobra $60 de bajada de bandera y $35 por kilómetro. Escribí la función del costo según los kilómetros y calculá cuánto sale un viaje de 8 km.
5) Graficá h(x) = |x − 2| e indicá dominio y recorrido.`;

// One line per student, in order: grade, then each exercise as status[:error,error].
// c = bien, p = parcial, w = mal, b = sin hacer.
const EXAM_RESULTS: [number, string, string?][] = [
  [9, "c c c p:interpretation c"],
  [5, "c p:calculation w:concept w:interpretation p:incomplete", "Repasá recorrido: mirá el ejercicio 3 corregido."],
  [8, "c c p:concept c c"],
  [7, "c c c w:interpretation c"],
  [10, "c c c c c", "¡Excelente trabajo!"],
  [4, "p:notation c w:concept w:interpretation b"],
  [7, "c p:calculation c p:interpretation c"],
  [6, "c c p:concept w:interpretation,calculation p:incomplete"],
  [9, "c c c c p:notation"],
  [7, "c c p:concept p:interpretation c"],
  [3, "c w:calculation w:concept w:interpretation p:incomplete"],
  [9, "c c c p:calculation c"],
];

const STATUS_CODE = { c: "correct", p: "partial", w: "wrong", b: "blank" } as const;

function exam(): Assessment {
  const gradedAt = "2026-10-12T21:00:00.000Z";
  const grades: Record<string, Grade> = {};
  const exerciseResults: Record<string, ExerciseResult[]> = {};
  EXAM_RESULTS.forEach(([score, marks, feedback], i) => {
    const id = STUDENTS_6A[i].id;
    grades[id] = { score, gradedAt, ...(feedback && { feedback }) };
    exerciseResults[id] = marks.split(" ").map((mark) => {
      const [code, errors] = mark.split(":");
      return { status: STATUS_CODE[code as keyof typeof STATUS_CODE], errors: errors ? errors.split(",") : [] };
    });
  });
  return {
    id: "demo-funciones",
    groupId: "6a",
    type: "exam",
    topic: "Funciones: dominio y recorrido",
    original: EXAM_ORIGINAL,
    versions: groupByProfiles(STUDENTS_6A).map((v) => ({
      ...v,
      status: "ready",
      content: EXAM_ORIGINAL,
      changes:
        v.profiles.length === 0 ? [] : [{ what: "Versión de ejemplo", why: "Datos de ejemplo para mostrar los resultados." }],
      approved: true,
    })),
    grades,
    exerciseResults,
    createdAt: "2026-10-09T12:00:00.000Z",
  };
}

const SEED: Data = {
  groups: [
    {
      // For the demo: one student per way of answering (writing with ADHD, eye gaze, dictation).
      id: "demo",
      name: "Grupo demo",
      students: students("demo", [
        ["Lucas R.", ["adhd"], ["fútbol"]],
        ["Paula G.", ["motor"]],
        ["Tomás V.", ["dysgraphia"], ["música"]],
      ]),
    },
    {
      id: "6a",
      name: "6.º A",
      students: STUDENTS_6A,
    },
    {
      id: "6b",
      name: "6.º B",
      students: students("6b", [
        ["Agustín H.", []],
        ["Belén O.", ["asd"], ["astronomía"]],
        ["Carolina T.", []],
        ["Federico N.", []],
        ["Julieta K.", ["dyslexia"], ["cocina"]],
        ["Mateo Z.", [], ["skate", "música"]],
        ["Renata I.", ["adhd", "asd"], ["dinosaurios"]],
        ["Santiago E.", []],
        ["Sofía U.", [], ["música"]],
      ]),
    },
  ],
  assessments: [exam()],
};

export function seed(): Data {
  return structuredClone(SEED);
}
