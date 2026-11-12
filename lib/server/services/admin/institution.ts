import "server-only";
import { z } from "zod";
import { messageFor } from "@/lib/domain/errors/reasons";
import { AppError } from "@/lib/errors";
import { newToken, hashToken } from "../../auth/tokens";
import { adminDb } from "../../repos/admin/db";
import { createInstitution } from "../../repos/admin/identity";
import { publicOrigin } from "../../request-origin";
import { createInvitationAsOperator } from "./invitation-signup";

// The administration command (T2.2): the first institution of a school and the invitation of its first admin, with no actor
// (the team of Tiza runs it from a terminal). A script cannot import repos/admin, so it comes here.
// The link goes back to the caller and nowhere else: nothing here logs a token, a link or an email (the database already
// audits invitation.created).

export const NewInstitutionInput = z.object({
  name: z.string().trim().min(1).max(200),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,31}$/),
  adminEmail: z.email().trim().toLowerCase(),
});
export type NewInstitutionInput = z.input<typeof NewInstitutionInput>;

/**
 * - `invited`: a new invitation was issued and `invitationLink` carries its token (the only time it exists).
 * - `already_pending`: that email already has a pending invitation for this institution. Its token is not recoverable (the
 *   database keeps only the hash) and nothing here can rotate it without an actor, so there is no link: it expires after
 *   7 days and then running the command again issues a new one.
 * - `already_admin`: that email already is an admin of the institution. Nothing to do.
 */
export type InstitutionOutcome = "invited" | "already_pending" | "already_admin";

export type InstitutionWithAdmin = {
  institutionId: string;
  /** `${origin}/invitacion#${token}`, or null when no invitation was issued in this run. */
  invitationLink: string | null;
  /**
   * True when this run issued the invitation (so there is a new link). internal_create_institution does not say whether the row
   * is new or was already there, so it is not a flag of the institution: the institution is idempotent by code either way.
   */
  created: boolean;
  outcome: InstitutionOutcome;
  /** When the new invitation expires (ISO 8601), for the mail. Null without a new invitation. */
  expiresAt: string | null;
};

const CODE_TAKEN = "Ya existe una institución con ese código y otro nombre. Usá el mismo nombre o elegí otro código.";
const BAD_INPUT = "Revisá los datos: hace falta un nombre, un código (de 3 a 32 letras minúsculas, números o guiones) y un correo válido.";

function isReason(error: unknown, code: AppError["code"], reason: string): boolean {
  return error instanceof AppError && error.code === code && error.message === messageFor(code, reason);
}

/** Idempotent by code: the same code with the same name finds the same institution instead of making another. */
export async function createInstitutionWithAdmin(input: NewInstitutionInput): Promise<InstitutionWithAdmin> {
  const parsed = NewInstitutionInput.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID", BAD_INPUT);
  const { name, code, adminEmail } = parsed.data;
  // Before touching the database: a link that cannot be built would leave an invitation nobody can open.
  const origin = publicOrigin();

  let institutionId: string;
  try {
    institutionId = (await createInstitution(adminDb(), { name, code, kind: "school" })).id;
  } catch (error) {
    if (isReason(error, "CONFLICT", "op_key_reused")) throw new AppError("CONFLICT", CODE_TAKEN);
    throw error;
  }

  const token = newToken();
  try {
    const invitation = await createInvitationAsOperator({ institutionId, email: adminEmail, role: "admin", tokenHash: hashToken(token) });
    return { institutionId, invitationLink: `${origin}/invitacion#${token}`, created: true, outcome: "invited", expiresAt: invitation.expiresAt };
  } catch (error) {
    const outcome: InstitutionOutcome | null = isReason(error, "INVALID", "already_member")
      ? "already_admin"
      : isReason(error, "CONFLICT", "invitation_pending")
        ? "already_pending"
        : null;
    if (outcome === null) throw error;
    return { institutionId, invitationLink: null, created: false, outcome, expiresAt: null };
  }
}
