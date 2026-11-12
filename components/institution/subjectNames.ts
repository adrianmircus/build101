// The catalog of subjects in code: the database only knows ids (app.subjects), the Spanish name lives here and
// nowhere else. A subject that is not in it yet reads as «Materia nueva» instead of showing a raw id.
// Phase 2 only enables math; physics and chemistry come later (docs/ROADMAP.md).

const NAMES: Record<string, string> = {
  math: "Matemática",
  physics: "Física",
  chemistry: "Química",
};

export function subjectName(id: string): string {
  return NAMES[id] ?? "Materia nueva";
}
