"use client";

import type { GroupSummary } from "@/lib/domain/groups/rpc";
import { CreateDone } from "./CreateDone";
import { CreatePaste } from "./CreatePaste";
import { CreateReview } from "./CreateReview";
import { NEW_GROUP } from "./createFlowState";
import type { CreateActions } from "./createSteps";
import { useCreateFlow } from "./useCreateFlow";

type Props = {
  institutionId: string;
  institutionName: string;
  institutionCode: string;
  groups: GroupSummary[];
  subjects: { id: string }[];
  /** The school year to suggest for a new group. */
  year: number;
  actions: CreateActions;
};

// «Crear cuentas de estudiantes»: paste, review, done. The review shows every username that will exist, and only
// the confirm creates anything.
export function CreateFlow({ institutionId, institutionName, institutionCode, groups, subjects, year, actions }: Props) {
  const flow = useCreateFlow({ institutionId, groups, subjects, year, actions });
  const { state } = flow;
  const home = `/institucion/${institutionId}`;
  const groupId = state.groupId;
  const existing = groups.find((group) => group.id === state.fields.groupChoice);
  const groupName = state.fields.groupChoice === NEW_GROUP ? state.fields.groupName.trim() : (existing?.name ?? "el grupo");

  if (state.step === "done" && groupId) {
    return <CreateDone count={state.createdIds.length} cardsHref={`${home}/grupos/${groupId}/tarjetas`} homeHref={home} />;
  }
  if (state.step === "review") {
    return (
      <CreateReview
        groupName={groupName}
        institutionName={institutionName}
        homeHref={home}
        rows={state.rows}
        flags={state.flags}
        someCreated={state.createdIds.length > 0}
        pending={flow.pending}
        summary={flow.problems}
        notice={flow.notice}
        onBack={flow.back}
        onEdit={(key, value) => flow.dispatch({ type: "edit", key, value })}
        onConfirm={flow.confirm}
      />
    );
  }
  return (
    <CreatePaste
      institutionHref={home}
      institutionName={institutionName}
      institutionCode={institutionCode}
      groups={groups}
      subjects={subjects}
      fields={state.fields}
      problems={flow.problems}
      notice={flow.notice}
      pending={flow.pending}
      focus={flow.visited}
      onField={(name, value) => flow.dispatch({ type: "field", name, value })}
      onReview={flow.review}
    />
  );
}
