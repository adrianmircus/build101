import type { Data, Student } from "./types";

// Sample data for the demo. All students are fictional.
function students(groupId: string, list: [string, string[], string[]?][]): Student[] {
  return list.map(([name, profiles, interests], i) => ({
    id: `${groupId}-s${i + 1}`,
    name,
    profiles,
    ...(interests && { interests }),
  }));
}

const SEED: Data = {
  groups: [
    {
      id: "6a",
      name: "6.º A",
      students: students("6a", [
        ["Ana P.", [], ["música", "fútbol"]],
        ["Bruno M.", ["adhd"], ["fútbol", "videojuegos"]],
        ["Camila R.", [], ["fútbol"]],
        ["Diego S.", ["dyslexia"], ["básquetbol"]],
        ["Emilia G.", [], ["música", "dibujo"]],
        ["Facundo L.", ["adhd", "dyslexia"], ["videojuegos"]],
        ["Florencia V.", []],
        ["Joaquín B.", ["adhd"], ["fútbol"]],
        ["Lucía F.", []],
        ["Martina C.", ["dyslexia"], ["música", "básquetbol"]],
        ["Nicolás A.", [], ["fútbol"]],
        ["Valentina D.", []],
      ]),
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
  assessments: [],
};

export function seed(): Data {
  return structuredClone(SEED);
}
