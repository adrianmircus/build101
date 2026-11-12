import { z } from "zod";
import { DisplayName, Id, Revision, SubjectId } from "../common";
import { GroupName, SchoolYear } from "../groups/entities";
import { InstitutionCode, InvitedRole } from "../identity/entities";
import { Username } from "../students/entities";

// What the browser sends to the Server Actions of phase 2 (docs/contratos/fase-2.md, «Entradas»), validated
// with zod at the border. The IP and the origin are not here: the action reads them from the request headers
// and gives them to the service. Nobody sends an Auth id: the actor comes from the session.

/** A staff email as it is stored and compared: no spaces at the edges, lower case. */
export const StaffEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
/** A password the person chooses. 72 is the limit of bcrypt, which Auth uses. */
// Staff passwords: at least 10 characters, like minimum_password_length in supabase/config.toml (docs/contratos/fase-2.md).
export const NewPassword = z.string().min(10).max(72);
/** A password being typed to enter: whatever it is, the check is Auth's. */
export const LoginPassword = z.string().min(1).max(200);
/** A token in the route: 32 random bytes in base64url. */
export const Token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const SignInStaffInput = z.object({ email: StaffEmail, password: LoginPassword }).strict();
export const VerifyRecoveryInput = z.object({ tokenHash: z.string().min(10).max(300) }).strict();
export const RequestResetInput = z.object({ email: StaffEmail }).strict();
export const SetNewPasswordInput = z.object({ password: NewPassword, userId: Id }).strict();

export const ReadAccessCardInput = z.object({ token: Token }).strict();
export const FindInstitutionInput = z.object({ code: InstitutionCode }).strict();
export const SignInStudentInput = z.object({ code: InstitutionCode, username: Username, password: LoginPassword }).strict();

export const ReadInvitationInput = z.object({ token: Token }).strict();
export const AcceptInvitationInput = z.object({ token: Token }).strict();
export const AcceptAsNewUserInput = z.object({ token: Token, displayName: DisplayName, password: NewPassword }).strict();
export const SignInAndAcceptInput = z.object({ token: Token, password: LoginPassword }).strict();

export const InviteStaffInput = z
  .object({ institutionId: Id, emails: z.array(StaffEmail).min(1).max(50), role: InvitedRole, opKey: Id })
  .strict();
export const ResendInvitationInput = z.object({ institutionId: Id, invitationId: Id, revision: Revision }).strict();
export const RevokeInvitationInput = z.object({ institutionId: Id, invitationId: Id, revision: Revision }).strict();

export const PreviewUsernamesInput = z.object({ institutionId: Id, names: z.array(DisplayName).min(1).max(60) }).strict();
/** `slot`: the identity of the row inside the request (the op_key derives from opKey and slot). Without it, the position of the row. A retry keeps it. */
export const NewStudentRow = z.object({ displayName: DisplayName, username: Username, slot: z.int().min(0).max(100_000).optional() }).strict();
export type NewStudent = z.output<typeof NewStudentRow>;
export const CreateStudentAccountsInput = z
  .object({ groupId: Id, rows: z.array(NewStudentRow).min(1).max(60), opKey: Id })
  .strict();
export const CreateGroupInput = z
  .object({ institutionId: Id, name: GroupName, subjectId: SubjectId, schoolYear: SchoolYear, opKey: Id })
  .strict();
export const IssueAccessCardsInput = z
  .object({ groupId: Id, studentIds: z.array(Id).min(1).max(60), opKey: Id })
  .strict();
