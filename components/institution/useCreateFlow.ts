"use client";

import { useReducer, useRef, useState } from "react";
import type { GroupSummary } from "@/lib/domain/groups/rpc";
import { createRows, groupFor, nextAttempt, partialText, previewRows, type CreateActions } from "./createSteps";
import { NEW_GROUP, createReducer, initialCreate, pasteProblems, type Fields } from "./createFlowState";
import type { Attempt } from "./opKey";
import { useFlowMessages } from "./useFlowMessages";
import { blockingProblems } from "./usernameReview";

type Options = { institutionId: string; groups: GroupSummary[]; subjects: { id: string }[]; year: number; actions: CreateActions };

const YEARS = { min: 2020, max: 2100 };

export function initialFields(groups: GroupSummary[], subjects: { id: string }[], year: number): Fields {
  const first = groups.find((group) => group.archivedAt === null);
  const subjectId = subjects.length === 1 ? (subjects[0]?.id ?? "") : "";
  return { groupChoice: first?.id ?? NEW_GROUP, groupName: "", subjectId, schoolYear: String(year), names: "" };
}

// The logic of «Crear cuentas»: what each step does and what the screen says when something does not work.
export function useCreateFlow({ institutionId, groups, subjects, year, actions }: Options) {
  const [state, dispatch] = useReducer(createReducer, undefined, () => initialCreate(initialFields(groups, subjects, year)));
  const [pending, setPending] = useState(false);
  const [visited, setVisited] = useState(false);
  const groupAttempt = useRef<Attempt | null>(null);
  const messages = useFlowMessages();
  const { say } = messages;
  const ctx = { institutionId, actions };
  const stop = (text: string) => (setPending(false), say(text));

  async function review() {
    say(null);
    if (messages.flag(pasteProblems(state.fields, subjects.map((subject) => subject.id), YEARS))) return;
    setPending(true);
    const rows = await previewRows(ctx, state.fields.names);
    if (!rows.ok) return stop(rows.text);
    setPending(false);
    setVisited(true);
    dispatch({ type: "reviewing", rows: rows.value });
  }

  async function confirm() {
    if (messages.flag(blockingProblems(state.rows, state.flags))) return;
    setPending(true);
    const group = await groupFor(ctx, state, groupAttempt.current);
    if (!group.ok) return stop(group.text);
    groupAttempt.current = group.value.attempt;
    const attempt = nextAttempt(state, group.value.id);
    dispatch({ type: "started", groupId: group.value.id, attempt });
    const made = await createRows(ctx, { groupId: group.value.id, rows: state.rows, attempt });
    if (!made.ok) return stop(made.text);
    setPending(false);
    const created = made.value.filter((row) => row.outcome === "created").length;
    say(created < state.rows.length ? partialText(created, state.rows.length - created) : null);
    dispatch({ type: "results", results: made.value });
  }

  function back() {
    messages.clear();
    dispatch({ type: "back" });
  }

  return { state, dispatch, back, problems: messages.problems, notice: messages.notice, pending, visited, review, confirm };
}
