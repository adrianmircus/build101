import { failureText } from "@/components/auth/staff/failureText";
import type { z } from "zod";
import type { ActionFn } from "@/components/auth/staff/actionFn";
import { callAction } from "@/lib/client/callAction";
import type { UsernameDraft } from "@/lib/domain/accounts/entities";
import type { CreateGroupInput, CreateStudentAccountsInput, PreviewUsernamesInput } from "@/lib/domain/accounts/inputs";
import type { CreatedAccountRow } from "@/lib/domain/accounts/results";
import { NEW_GROUP, requestSignature, type CreateState } from "./createFlowState";
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

/** The group the accounts go into: the chosen one, or a new one made once, even if the confirm is retried (same key). */
export async function groupFor(ctx: Context, state: CreateState, previous: Attempt | null): Promise<Done<{ id: string; attempt: Attempt | null }>> {
  const { fields } = state;
  if (state.groupId) return { ok: true, value: { id: state.groupId, attempt: previous } };
  if (fields.groupChoice !== NEW_GROUP) return { ok: true, value: { id: fields.groupChoice, attempt: previous } };
  const attempt = attemptFor(previous, JSON.stringify([fields.groupName, fields.subjectId, fields.schoolYear]), newKey);
  const made = await callAction(ctx.actions.createGroup, {
    institutionId: ctx.institutionId,
    name: fields.groupName.trim(),
    subjectId: fields.subjectId,
    schoolYear: Number(fields.schoolYear),
    opKey: attempt.opKey,
  });
  if (!made.ok) return { ok: false, text: failureText(made) };
  return { ok: true, value: { id: made.data.id, attempt } };
}

export function nextAttempt(state: CreateState, groupId: string): Attempt {
  return attemptFor(state.attempt, requestSignature({ ...state, groupId }), newKey);
}

export async function createRows(ctx: Context, request: { groupId: string; rows: DraftRow[]; attempt: Attempt }): Promise<Done<CreatedAccountRow[]>> {
  const { groupId, rows, attempt } = request;
  const body = rows.map((row) => ({ displayName: row.displayName, username: normalizeUsername(row.username) }));
  const result = await callAction(ctx.actions.create, { groupId, rows: body, opKey: attempt.opKey });
  if (!result.ok) return { ok: false, text: failureText(result) };
  return { ok: true, value: result.data };
}

export function partialText(created: number, left: number): string {
  const rest = left === 1 ? "Queda 1 por revisar" : `Quedan ${left} por revisar`;
  if (created === 0) return `${rest}: miralo abajo.`;
  return `${created === 1 ? "Se creó 1 cuenta." : `Se crearon ${created} cuentas.`} ${rest}: miralo abajo.`;
}
