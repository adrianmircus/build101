import { FieldFrame, describedBy } from "@/components/auth/staff/FieldFrame";
import { problemFor, type FieldProblem } from "@/components/auth/staff/ErrorSummary";
import { field } from "@/components/ui/styles";
import type { Fields } from "./createFlowState";
import { subjectName } from "./subjectNames";

type Props = {
  fields: Fields;
  subjects: { id: string }[];
  problems: FieldProblem[];
  onField: (name: keyof Fields, value: string) => void;
};

// The data of a group that does not exist yet. The subject is the one the platform has enabled, named from the catalog.
export function NewGroupFields({ fields, subjects, problems, onField }: Props) {
  const nameError = problemFor(problems, "cr-grupo-nombre");
  const subjectError = problemFor(problems, "cr-grupo-materia");
  const yearError = problemFor(problems, "cr-grupo-anio");
  const nameHint = "Como lo conocen en el colegio, por ejemplo 4.º B.";
  return (
    <div className="space-y-6">
      <FieldFrame id="cr-grupo-nombre" label="Nombre del grupo" hint={nameHint} error={nameError}>
        <input
          id="cr-grupo-nombre"
          type="text"
          value={fields.groupName}
          onChange={(event) => onField("groupName", event.target.value)}
          autoComplete="off"
          maxLength={120}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={describedBy("cr-grupo-nombre", { hint: nameHint, error: nameError })}
          className={field}
        />
      </FieldFrame>
      <FieldFrame id="cr-grupo-materia" label="Materia" error={subjectError}>
        <select
          id="cr-grupo-materia"
          value={fields.subjectId}
          onChange={(event) => onField("subjectId", event.target.value)}
          aria-invalid={subjectError ? true : undefined}
          aria-describedby={describedBy("cr-grupo-materia", { error: subjectError })}
          className={field}
        >
          {subjects.length !== 1 && <option value="">Elegí la materia</option>}
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subjectName(subject.id)}
            </option>
          ))}
        </select>
      </FieldFrame>
      <FieldFrame id="cr-grupo-anio" label="Año lectivo" error={yearError}>
        <input
          id="cr-grupo-anio"
          type="text"
          inputMode="numeric"
          value={fields.schoolYear}
          onChange={(event) => onField("schoolYear", event.target.value)}
          autoComplete="off"
          maxLength={4}
          aria-invalid={yearError ? true : undefined}
          aria-describedby={describedBy("cr-grupo-anio", { error: yearError })}
          className={`${field} sm:max-w-40`}
        />
      </FieldFrame>
    </div>
  );
}
