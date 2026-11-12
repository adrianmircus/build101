import Link from "next/link";
import type { RefObject } from "react";
import type { AccountRow } from "@/lib/domain/accounts/entities";
import { ConfirmDialog } from "./ConfirmDialog";
import type { State } from "./cards-state";
import { BackIcon } from "./icons";
import { CannotIssue, Notices } from "./Notices";
import { PrintAside } from "./PrintAside";
import { PrintSheets } from "./PrintSheets";
import { StudentList } from "./StudentList";
import { paper } from "./styles";

// The cards page as a pure view of its state: the same markup the browser shows, so every state can be rendered in a
// test. The passwords appear in one place only, <PrintSheets>, which is display: none on the screen.

export type ViewProps = {
  institutionId: string;
  groupName: string;
  institutionCode: string;
  accounts: readonly AccountRow[];
  canIssueCards: boolean;
  state: State;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onToggle: (id: string) => void;
  onToggleAll: (on: boolean) => void;
  /** Open the confirmation for these students. */
  onAsk: (ids: string[]) => void;
  onCancelAsk: () => void;
  onConfirm: () => void;
  onReprint: () => void;
  onDone: () => void;
};

function Heading({ institutionId, groupName, headingRef }: Pick<ViewProps, "institutionId" | "groupName" | "headingRef">) {
  return (
    <>
      <p>
        <Link href={`/institucion/${institutionId}`} className="inline-flex min-h-11 items-center gap-1 rounded-md font-semibold text-indigo-800 underline underline-offset-4 hover:text-indigo-950">
          <BackIcon />
          Volver al panel de la institución
        </Link>
      </p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-3xl font-bold outline-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-indigo-950 sm:text-4xl">
        Tarjetas de acceso
      </h1>
      <p className="mt-2 max-w-2xl text-lg text-slate-700">
        {groupName}. Elegí para quién. Las contraseñas se crean cuando confirmás, y las anteriores de esos estudiantes dejan de andar.
      </p>
    </>
  );
}

export function AccessCardsView(props: ViewProps) {
  const { accounts, canIssueCards, state } = props;
  // In the order of the list, whatever the order they were ticked in.
  const chosen = accounts.filter((row) => state.selected.includes(row.studentId)).map((row) => row.studentId);
  const sample = accounts.find((row) => row.studentId === chosen[0]) ?? accounts[0];
  const names = new Map(accounts.map((row) => [row.studentId, row.displayName]));
  const asking = state.asking?.map((id) => names.get(id) ?? "Un estudiante") ?? null;
  const retryIds = state.lastRequest.length > 0 ? state.lastRequest : chosen;

  return (
    <>
      <div className="print:hidden">
        <Heading institutionId={props.institutionId} groupName={props.groupName} headingRef={props.headingRef} />
        <Notices state={state} accounts={accounts} retryIds={retryIds} onAsk={props.onAsk} onReprint={props.onReprint} onDone={props.onDone} />
        {!canIssueCards && (
          <div className="mt-4">
            <CannotIssue />
          </div>
        )}
        <div className="mt-6 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <section aria-label="Estudiantes del grupo" className={paper}>
            <StudentList
              accounts={accounts}
              selected={state.selected}
              disabled={state.running}
              readOnly={!canIssueCards}
              onToggle={props.onToggle}
              onToggleAll={props.onToggleAll}
              onNewCard={(id) => props.onAsk([id])}
            />
          </section>
          {canIssueCards && sample !== undefined && (
            <PrintAside sample={sample} schoolCode={props.institutionCode} groupName={props.groupName} chosen={chosen} running={state.running} onAsk={props.onAsk} />
          )}
        </div>
        {asking !== null && <ConfirmDialog names={asking} onConfirm={props.onConfirm} onCancel={props.onCancelAsk} />}
      </div>
      {state.held !== null && <PrintSheets cards={state.held} groupName={props.groupName} />}
    </>
  );
}
