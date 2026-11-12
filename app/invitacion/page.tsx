import type { Metadata } from "next";
import { InvitationFlow } from "@/components/auth/staff/InvitationFlow";
import { signOutAction } from "../salir/actions";
import { acceptAsNewUserAction, acceptInvitationAction, readInvitationAction, signInAndAcceptAction } from "./actions";

// The token is in the fragment (/invitacion#<token>), which the server never sees: InvitationFlow, a Client Component,
// reads it, clears the bar and sends it in the body of the actions. This page stays a Server Component only so it can
// set the title and keep the page out of search engines; the headers (no-store, no-referrer) are put by proxy.ts (T2.1).
export const metadata: Metadata = { title: "Invitación", robots: { index: false } };

const ACTIONS = {
  accept: acceptInvitationAction,
  acceptAsNew: acceptAsNewUserAction,
  signInAndAccept: signInAndAcceptAction,
  signOut: signOutAction,
};

export default function InvitationPage() {
  return <InvitationFlow read={readInvitationAction} actions={ACTIONS} />;
}
