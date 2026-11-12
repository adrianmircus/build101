import { FieldFrame } from "@/components/auth/staff/FieldFrame";
import type { FieldProblem } from "@/components/auth/staff/ErrorSummary";
import { field } from "@/components/ui/styles";
import type { GroupSummary } from "@/lib/domain/groups/rpc";
import { NEW_GROUP, type Fields } from "./createFlowState";
import { NewGroupFields } from "./NewGroupFields";
import { subjectName } from "./subjectNames";

type Props = {
  groups: GroupSummary[];
  subjects: { id: string }[];
  fields: Fields;
  problems: FieldProblem[];
  onField: (name: keyof Fields, value: string) => void;
};

// «Grupo»: one that already exists, or a new one. With no groups yet there is nothing to choose: it goes straight to the data.
export function GroupPicker({ groups, subjects, fields, problems, onField }: Props) {
  const open = groups.filter((group) => group.archivedAt === null);
  const isNew = open.length === 0 || fields.groupChoice === NEW_GROUP;
  return (
    <div className="space-y-6">
      {open.length > 0 ? (
        <FieldFrame id="cr-grupo" label="Grupo">
          <select id="cr-grupo" value={fields.groupChoice} onChange={(event) => onField("groupChoice", event.target.value)} className={field}>
            {open.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} · {subjectName(group.subjectId)} {group.schoolYear}
              </option>
            ))}
            <option value={NEW_GROUP}>Crear un grupo nuevo</option>
          </select>
        </FieldFrame>
      ) : (
        <p className="text-lg text-slate-800">Todavía no hay grupos en el colegio. Creá el primero.</p>
      )}
      {isNew && <NewGroupFields fields={{ ...fields, groupChoice: NEW_GROUP }} subjects={subjects} problems={problems} onField={onField} />}
    </div>
  );
}
