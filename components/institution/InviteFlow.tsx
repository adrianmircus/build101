"use client";

import type { InvitationView, StaffRow } from "@/lib/domain/accounts/entities";
import { InviteDone } from "./InviteDone";
import { InvitePaste } from "./InvitePaste";
import { InviteReview } from "./InviteReview";
import { useInviteFlow, type InviteAction } from "./useInviteFlow";

type Props = {
  institutionId: string;
  institutionName: string;
  members: StaffRow[];
  invitations: InvitationView[];
  invite: InviteAction;
};

// «Invitar profes»: paste, review, done. The review is the approval: nothing is sent before the admin confirms it.
export function InviteFlow({ institutionId, institutionName, ...rest }: Props) {
  const flow = useInviteFlow({ institutionId, ...rest });
  const { state, dispatch } = flow;
  const home = `/institucion/${institutionId}`;

  if (state.step === "done") {
    return <InviteDone results={state.results} homeHref={home} listHref={`${home}/profes`} onAgain={() => dispatch({ type: "again" })} />;
  }
  if (state.step === "review") {
    return (
      <InviteReview
        rows={state.rows}
        role={state.role}
        homeHref={home}
        pending={flow.pending}
        notice={flow.notice}
        onBack={() => dispatch({ type: "back" })}
        onConfirm={flow.confirm}
      />
    );
  }
  return (
    <InvitePaste
      institutionHref={home}
      institutionName={institutionName}
      text={state.text}
      role={state.role}
      problem={flow.problem}
      focus={flow.visited}
      onText={(value) => dispatch({ type: "text", value })}
      onRole={(role) => dispatch({ type: "role", value: role })}
      onReview={flow.review}
    />
  );
}
