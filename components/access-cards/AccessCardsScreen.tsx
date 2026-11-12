"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef } from "react";
import { flushSync } from "react-dom";
import type { ActionFn } from "@/components/auth/staff/actionFn";
import { callAction } from "@/lib/client/callAction";
import type { AccountRow } from "@/lib/domain/accounts/entities";
import type { IssuedCards } from "@/lib/domain/accounts/results";
import { AccessCardsView } from "./AccessCardsView";
import { initialState, reducer } from "./cards-state";

// The cards page of a group. It holds the state of the screen in a reducer and does what needs a browser: ask the
// action for the cards, print, and drop the passwords when the screen goes away. The cards live only in the memory of
// this component.
//
// With Cache Components, a page the user leaves is not unmounted: React keeps it hidden (<Activity>) with its state, and
// pagehide does not fire on an internal navigation. So the passwords are dropped in the cleanup of an effect, which
// React runs when the screen is hidden or unmounted, and an answer that arrives after that is thrown away. The printing
// comes only from the click that confirms or reprints, never from an effect that could run again when the screen is shown.

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
  // The id of the last request; the cleanup of the effect moves it on, which invalidates the one in flight.
  const latest = useRef(0);

  // Leaving the screen drops the passwords: the cleanup runs when Activity hides it and when it unmounts. pagehide
  // covers closing the tab and the back-forward cache. Showing the screen again finds it already clean.
  useEffect(() => {
    const drop = () => {
      latest.current += 1;
      running.current = false;
      dispatch({ type: "deactivate" });
    };
    window.addEventListener("pagehide", drop);
    return () => {
      window.removeEventListener("pagehide", drop);
      drop();
    };
  }, []);

  async function confirm() {
    const ids = state.asking;
    if (ids === null || running.current) return;
    running.current = true;
    const request = ++latest.current;
    dispatch({ type: "start", ids, request });
    // A new opKey for every request: the server answers a repeated one with «ya se crearon» and cannot give the passwords back.
    const result = await callAction(issue, { groupId, studentIds: ids, opKey: crypto.randomUUID() });
    // The screen went away (or another request began) while it waited: the answer, with its passwords, is dropped.
    if (latest.current !== request) return;
    running.current = false;
    if (result.ok) {
      // The sheet has to be in the page before the browser prints it; this click is the only thing that prints.
      flushSync(() => dispatch({ type: "issued", data: result.data, request }));
      if (result.data.cards.length > 0) window.print();
      router.refresh();
    } else {
      dispatch({ type: "failed", failure: result, request });
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
      onReprint={() => {
        dispatch({ type: "reprint" });
        window.print();
      }}
      onDone={() => {
        dispatch({ type: "clear" });
        heading.current?.focus();
      }}
    />
  );
}
