import { StatusMessage } from "@/components/auth/staff/StatusMessage";
import type { AccountRow } from "@/lib/domain/accounts/entities";
import type { State } from "./cards-state";
import { InfoIcon } from "./icons";
import { NotIssued } from "./NotIssued";
import { PrintedPanel } from "./PrintedPanel";
import { quiet } from "./styles";

// Everything that answers what the teacher did, above the list: the result in words (a polite live region that is
// always on the page), the error or conflict, the cards that were made and the students that got none.

type Props = {
  state: State;
  accounts: readonly AccountRow[];
  /** The students a retry would ask for. */
  retryIds: string[];
  onAsk: (ids: string[]) => void;
  onReprint: () => void;
  onDone: () => void;
};

function NoticeBlock({ state, retryIds, onAsk }: Pick<Props, "state" | "retryIds" | "onAsk">) {
  const { notice } = state;
  if (notice === null) return null;
  return (
    <StatusMessage key={notice.key} tone={notice.kind === "failure" ? "error" : "neutral"}>
      <p>{notice.text}</p>
      {notice.canRetry && retryIds.length > 0 && (
        <p>
          <button type="button" className={quiet} disabled={state.running} onClick={() => onAsk(retryIds)}>
            {notice.kind === "conflict" ? "Crear tarjetas nuevas" : "Probar de nuevo"}
          </button>
        </p>
      )}
    </StatusMessage>
  );
}

export function CannotIssue() {
  return (
    <section aria-labelledby="no-issue-title" className="flex items-start gap-3 rounded-2xl bg-slate-100 p-5 text-lg">
      <InfoIcon className="mt-1 size-6 text-indigo-800" />
      <div className="space-y-2">
        <h2 id="no-issue-title" className="text-xl font-bold">
          Acá no se pueden crear tarjetas
        </h2>
        <p>Pasa en la demo, que no tiene cuentas reales, y cuando tu rol no permite emitirlas. Podés ver la lista, pero no imprimir.</p>
        <p>Si necesitás tarjetas, pedíselas a quien administra la institución.</p>
      </div>
    </section>
  );
}

export function Notices({ state, accounts, retryIds, onAsk, onReprint, onDone }: Props) {
  const names = new Map(accounts.map((row) => [row.studentId, row.displayName]));
  return (
    <div className="mt-5 grid gap-4">
      {/* Always on the page, so the screen reader announces each result as the text inside changes. */}
      <p role="status" className="text-lg font-semibold text-slate-900">
        {state.announcement}
      </p>
      <NoticeBlock state={state} retryIds={retryIds} onAsk={onAsk} />
      {state.held !== null && <PrintedPanel key={state.batch} count={state.held.length} onReprint={onReprint} onDone={onDone} />}
      {state.others.length > 0 && (
        <NotIssued
          others={state.others}
          names={names}
          disabled={state.running}
          takeFocus={state.held === null}
          onRetry={() => onAsk(state.others.map((other) => other.studentId))}
        />
      )}
    </div>
  );
}
