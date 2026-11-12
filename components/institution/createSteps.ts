import { failureText } from "@/components/auth/staff/failureText";
import type { z } from "zod";
import type { ActionFn } from "@/components/auth/staff/actionFn";
import { callAction } from "@/lib/client/callAction";
import type { UsernameDraft } from "@/lib/domain/accounts/entities";
import type { CreateGroupInput, CreateStudentAccountsInput, PreviewUsernamesInput } from "@/lib/domain/accounts/inputs";
import type { CreatedAccountRow } from "@/lib/domain/accounts/results";
import { NEW_GROUP, requestSignature, type CreateAction, type CreateState } from "./createFlowState";
import { attemptFor, type Attempt } from "./opKey";
import { normalizeUsername, draftRows, type DraftRow } from "./usernameReview";
import { parseNames } from "./nameList";

// The three calls of «Crear cuentas», apart from the screen: each one says what happened as a value, so the hook only
// has to show it. Nothing here touches the browser but the random key of a request.

export type CreateActions = {
  preview: ActionFn<z.input<typeof PreviewUsernamesInput>, UsernameDraft[]>;
  createGroup: ActionFn<z.input<typeof CreateGroupInput>, { id: string }>;
  create: ActionFn<z.input<typeof CreateStudentAccountsInput>, CreatedAccountRow[]>;
};

type Done<T> = { ok: true; value: T } | { ok: false; text: string };
type Context = { institutionId: string; actions: CreateActions };

const newKey = () => crypto.randomUUID();

export async function previewRows(ctx: Context, names: string): Promise<Done<DraftRow[]>> {
  const result = await callAction(ctx.actions.preview, { institutionId: ctx.institutionId, names: parseNames(names) });
  if (!result.ok) return { ok: false, text: failureText(result) };
  return { ok: true, value: draftRows(result.data) };
}

/**
 * The group the accounts go into: the chosen one, or a new one made once. The attempt (its opKey) is saved in the
 * state BEFORE the request goes out and stays after an error or a lost answer, so the retry sends the same key and the
 * server answers with the group it already made. It is renewed only when the data of the group change.
 */
export async function groupFor(ctx: Context, state: CreateState, dispatch: (action: CreateAction) => void): Promise<Done<string>> {
  const { fields } = state;
  if (state.groupId) return { ok: true, value: state.groupId };
  if (fields.groupChoice !== NEW_GROUP) return { ok: true, value: fields.groupChoice };
  const attempt = attemptFor(state.groupAttempt, JSON.stringify([fields.groupName, fields.subjectId, fields.schoolYear]), newKey);
  dispatch({ type: "groupAttempt", attempt });
  const made = await callAction(ctx.actions.createGroup, {
    institutionId: ctx.institutionId,
    name: fields.groupName.trim(),
    subjectId: fields.subjectId,
    schoolYear: Number(fields.schoolYear),
    opKey: attempt.opKey,
  });
  if (!made.ok) return { ok: false, text: failureText(made) };
  return { ok: true, value: made.data.id };
}

export function nextAttempt(state: CreateState, groupId: string): Attempt {
  return attemptFor(state.attempt, requestSignature({ ...state, groupId }), newKey);
}

export async function createRows(ctx: Context, request: { groupId: string; rows: DraftRow[]; attempt: Attempt }): Promise<Done<CreatedAccountRow[]>> {
  const { groupId, rows, attempt } = request;
  const body = rows.map((row) => ({ displayName: row.displayName, username: normalizeUsername(row.username), slot: row.slot }));
  const result = await callAction(ctx.actions.create, { groupId, rows: body, opKey: attempt.opKey });
  if (!result.ok) return { ok: false, text: failureText(result) };
  return { ok: true, value: result.data };
}

export function partialText(created: number, left: number): string {
  const rest = left === 1 ? "Queda 1 por revisar" : `Quedan ${left} por revisar`;
  if (created === 0) return `${rest}: miralo abajo.`;
  return `${created === 1 ? "Se creó 1 cuenta." : `Se crearon ${created} cuentas.`} ${rest}: miralo abajo.`;
}

/**
 * The confirm of the flow, apart from the screen: the group, the attempt of the accounts (saved before the request) and
 * the accounts. Every key is in the state before its request leaves, which is what makes a retry safe.
 */
export async function confirmCreate(ctx: Context, state: CreateState, dispatch: (action: CreateAction) => void): Promise<Done<CreatedAccountRow[]>> {
  // Rows and «volver a los nombres» are frozen from here, before waiting for the group: the identity of the request (opKey and slots) is the one of this moment.
  dispatch({ type: "confirm", begin: true });
  const group = await groupFor(ctx, state, dispatch);
  if (!group.ok) {
    // No row went out. The group's own key is already saved, so the retry does not make a second one.
    dispatch({ type: "confirm", begin: false });
    return group;
  }
  const attempt = nextAttempt(state, group.value);
  dispatch({ type: "started", groupId: group.value, attempt });
  const made = await createRows(ctx, { groupId: group.value, rows: state.rows, attempt });
  // No answer for the whole request: any of the rows may exist, so they stay with their identity and only «Volver a crear» is left.
  if (!made.ok) dispatch({ type: "lost" });
  return made;
}
