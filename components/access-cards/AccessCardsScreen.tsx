"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";
import type { ActionFn } from "@/components/auth/staff/actionFn";
import { callAction } from "@/lib/client/callAction";
import type { AccountRow } from "@/lib/domain/accounts/entities";
import type { IssuedCards } from "@/lib/domain/accounts/results";
import { AccessCardsView } from "./AccessCardsView";
import { initialState, reducer } from "./cards-state";

// The cards page of a group. It holds the state of the screen in a reducer and does the three things that need a
// browser: ask the action for the cards (with a new opKey per request), print when the cards arrive, and drop the
// passwords on pagehide. The cards live only in the memory of this component.

export type IssueAction = ActionFn<{ groupId: string; studentIds: string[]; opKey: string }, IssuedCards>;

type Props = {
  institutionId: string;
  groupId: string;
  groupName: string;
  institutionCode: string;
  accounts: AccountRow[];
  canIssueCards: boolean;
  issue: IssueAction;
};

export function AccessCardsScreen({ institutionId, groupId, groupName, institutionCode, accounts, canIssueCards, issue }: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, accounts, initialState);
  const heading = useRef<HTMLHeadingElement>(null);
  const running = useRef(false);

  // The printing: after the sheet is in the page. The dialog of the browser stops the script until it closes.
  useEffect(() => {
    if (state.printNonce > 0) window.print();
  }, [state.printNonce]);

  // Leaving the page drops the passwords (it also covers the page going to the back-forward cache).
  useEffect(() => {
    const drop = () => dispatch({ type: "clear" });
    window.addEventListener("pagehide", drop);
    return () => window.removeEventListener("pagehide", drop);
  }, []);

  async function confirm() {
    const ids = state.asking;
    if (ids === null || running.current) return;
    running.current = true;
    dispatch({ type: "start", ids });
    // A new opKey for every request: the server answers a repeated one with «ya se crearon» and cannot give the passwords back.
    const result = await callAction(issue, { groupId, studentIds: ids, opKey: crypto.randomUUID() });
    running.current = false;
    if (result.ok) {
      dispatch({ type: "issued", data: result.data });
      router.refresh();
    } else {
      dispatch({ type: "failed", failure: result });
    }
  }

  return (
    <AccessCardsView
      institutionId={institutionId}
      groupName={groupName}
      institutionCode={institutionCode}
      accounts={accounts}
      canIssueCards={canIssueCards}
      state={state}
      headingRef={heading}
      onToggle={(id) => dispatch({ type: "toggle", id })}
      onToggleAll={(on) => dispatch({ type: "toggleAll", ids: accounts.map((row) => row.studentId), on })}
      onAsk={(ids) => dispatch({ type: "ask", ids })}
      onCancelAsk={() => dispatch({ type: "cancelAsk" })}
      onConfirm={confirm}
      onReprint={() => dispatch({ type: "reprint" })}
      onDone={() => {
        dispatch({ type: "clear" });
        heading.current?.focus();
      }}
    />
  );
}
