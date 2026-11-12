"use server";

import {
  CreateGroupInput,
  CreateStudentAccountsInput,
  InviteStaffInput,
  PreviewUsernamesInput,
  ResendInvitationInput,
  RevokeInvitationInput,
} from "@/lib/domain/accounts/inputs";
import { defineAction } from "@/lib/server/entry/defineAction";
import { publicOrigin } from "@/lib/server/request-origin";
import { createGroup } from "@/lib/server/services/institution";
import { inviteStaff, resendInvitation, revokeInvitation } from "@/lib/server/services/invitations";
import { createStudentAccounts, previewUsernames } from "@/lib/server/services/student-accounts";

// Entries of the panel of the institution (T2.9 builds the screens; the services are T2.3 and T2.5b).
// The institution comes from the route and the RPC checks the actor is its admin: the browser decides nothing.

export const inviteStaffAction = defineAction({ name: "institution.inviteStaff", input: InviteStaffInput }, async (input) =>
  inviteStaff({ ...input, origin: publicOrigin() }),
);

export const resendInvitationAction = defineAction({ name: "institution.resendInvitation", input: ResendInvitationInput }, async (input) =>
  resendInvitation({ ...input, origin: publicOrigin() }),
);

export const revokeInvitationAction = defineAction({ name: "institution.revokeInvitation", input: RevokeInvitationInput }, async (input) =>
  revokeInvitation(input),
);

export const previewUsernamesAction = defineAction({ name: "institution.previewUsernames", input: PreviewUsernamesInput }, async (input) =>
  previewUsernames(input),
);

export const createStudentAccountsAction = defineAction({ name: "institution.createStudentAccounts", input: CreateStudentAccountsInput }, async (input) =>
  createStudentAccounts(input),
);

export const createGroupAction = defineAction({ name: "institution.createGroup", input: CreateGroupInput }, async (input) => createGroup(input));
