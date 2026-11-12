"use server";

import { headers } from "next/headers";
import { AcceptAsNewUserInput, AcceptInvitationInput, ReadInvitationInput, SignInAndAcceptInput } from "@/lib/domain/accounts/inputs";
import { clientIp } from "@/lib/server/auth/request";
import { defineAction } from "@/lib/server/entry/defineAction";
import { acceptInvitation, acceptInvitationAsNewUser, readInvitation } from "@/lib/server/services/invitations";
import { signInStaff } from "@/lib/server/services/staff-auth";

// Entries of the page of an invitation (T2.4 builds it; the services are T2.3). The token comes from the fragment of
// /invitacion#<token>, read by the client and sent in the body: it is never in a URL the server sees.

export const readInvitationAction = defineAction({ name: "invitation.read", input: ReadInvitationInput }, async ({ token }) =>
  readInvitation({ token, ip: clientIp(await headers()) }),
);

/** Someone already signed in accepts: their session has to carry the invited email. */
export const acceptInvitationAction = defineAction({ name: "invitation.accept", input: AcceptInvitationInput }, async ({ token }) =>
  acceptInvitation({ token }),
);

/** Someone with no account: it is created only if the token is still valid. */
export const acceptAsNewUserAction = defineAction({ name: "invitation.acceptAsNewUser", input: AcceptAsNewUserInput }, async (input) =>
  acceptInvitationAsNewUser({ ...input, ip: clientIp(await headers()) }),
);

/** Someone with an account but no session: signs in with the invited email, then accepts. */
export const signInAndAcceptAction = defineAction({ name: "invitation.signInAndAccept", input: SignInAndAcceptInput }, async ({ token, password }) => {
  const ip = clientIp(await headers());
  const { email } = await readInvitation({ token, ip });
  await signInStaff({ email, password, ip });
  return acceptInvitation({ token });
});
