import type { Data, Student } from "./types";

// Sample data for the demo. All students are fictional.
function students(groupId: string, list: [string, string[]][]): Student[] {
  return list.map(([name, profiles], i) => ({ id: `${groupId}-s${i + 1}`, name, profiles }));
}

const SEED: Data = {
  groups: [
    {
      id: "6a",
      name: "6.º A",
      students: students("6a", [
        ["Ana P.", []],
        ["Bruno M.", ["adhd"]],
        ["Camila R.", []],
        ["Diego S.", ["dyslexia"]],
        ["Emilia G.", []],
        ["Facundo L.", ["adhd", "dyslexia"]],
        ["Florencia V.", []],
        ["Joaquín B.", ["adhd"]],
        ["Lucía F.", []],
        ["Martina C.", ["dyslexia"]],
        ["Nicolás A.", []],
        ["Valentina D.", []],
      ]),
    },
    {
      id: "6b",
      name: "6.º B",
      students: students("6b", [
        ["Agustín H.", []],
        ["Belén O.", ["asd"]],
        ["Carolina T.", []],
        ["Federico N.", []],
        ["Julieta K.", ["dyslexia"]],
        ["Mateo Z.", []],
        ["Renata I.", ["adhd", "asd"]],
        ["Santiago E.", []],
        ["Sofía U.", []],
      ]),
    },
  ],
  assessments: [],
};

export function seed(): Data {
  return structuredClone(SEED);
}
