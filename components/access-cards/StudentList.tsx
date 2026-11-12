"use client";

import { useEffect, useRef } from "react";
import type { AccountRow } from "@/lib/domain/accounts/entities";
import { studentLines } from "./cards-state";
import { CheckIcon, ClockIcon, InfoIcon } from "./icons";
import { quiet } from "./styles";

// «Para quién»: a list with a checkbox per student (all ticked at the start) and, on each row, what the teacher
// needs to decide: whether the student came in, when their last card was made and the state of their account. Each
// row has its own «Tarjeta nueva», for whoever lost theirs. Nothing here says anything about profiles.

type Props = {
  accounts: readonly AccountRow[];
  selected: readonly string[];
  disabled: boolean;
  /** When the cards cannot be issued the list is only information: no checkboxes and no buttons. */
  readOnly?: boolean;
  onToggle: (id: string) => void;
  onToggleAll: (on: boolean) => void;
  onNewCard: (id: string) => void;
};

function AccountIcon({ status }: { status: AccountRow["accountStatus"] }) {
  if (status === "active") return <CheckIcon className="mt-0.5 size-4" />;
  if (status === "pending") return <ClockIcon className="mt-0.5 size-4" />;
  return <InfoIcon className="mt-0.5 size-4" />;
}

function Lines({ row, id }: { row: AccountRow; id: string }) {
  const lines = studentLines(row);
  return (
    <span id={id} className="mt-0.5 block text-base text-slate-700">
      <span className="block [overflow-wrap:anywhere]">
        {row.username} · {lines.access} · {lines.lastCard}
      </span>
      <span className="flex items-start gap-1.5">
        <AccountIcon status={row.accountStatus} />
        <span>{lines.account}</span>
      </span>
    </span>
  );
}

export function StudentList({ accounts, selected, disabled, readOnly = false, onToggle, onToggleAll, onNewCard }: Props) {
  const allRef = useRef<HTMLInputElement>(null);
  const all = accounts.length > 0 && selected.length === accounts.length;
  const some = selected.length > 0 && !all;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = some;
  }, [some]);

  if (accounts.length === 0) {
    return <p className="text-lg text-slate-700">Este grupo todavía no tiene estudiantes.</p>;
  }

  if (readOnly) {
    return (
      <div>
        <h2 className="text-xl font-bold">Estudiantes del grupo</h2>
        <ul className="mt-3 grid gap-1">
          {accounts.map((row) => (
            <li key={row.studentId} className="rounded-xl px-2 py-2">
              <span className="block text-lg font-semibold [overflow-wrap:anywhere]">{row.displayName}</span>
              <Lines row={row} id={`ro-${row.studentId}`} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <fieldset className="min-w-0">
      <legend className="text-xl font-bold">Para quién</legend>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-lg font-semibold hover:bg-slate-100 has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-indigo-950">
        <input ref={allRef} type="checkbox" className="size-6 shrink-0 accent-indigo-700" checked={all} disabled={disabled} onChange={(event) => onToggleAll(event.target.checked)} />
        Todo el grupo
      </label>
      <ul className="mt-1 grid gap-1">
        {accounts.map((row) => {
          const checked = selected.includes(row.studentId);
          const infoId = `info-${row.studentId}`;
          return (
            <li key={row.studentId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl px-2 py-1 hover:bg-slate-100">
              <label className="flex min-h-11 min-w-0 flex-1 basis-60 cursor-pointer items-start gap-3 py-1.5 has-[input:focus-visible]:outline-3 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-indigo-950">
                <input
                  type="checkbox"
                  className="mt-0.5 size-6 shrink-0 accent-indigo-700"
                  checked={checked}
                  disabled={disabled}
                  aria-describedby={infoId}
                  onChange={() => onToggle(row.studentId)}
                />
                <span className="min-w-0">
                  <span className="block text-lg font-semibold [overflow-wrap:anywhere]">{row.displayName}</span>
                  <Lines row={row} id={infoId} />
                </span>
              </label>
              <button type="button" className={`${quiet} min-h-11 py-2 text-base`} disabled={disabled} onClick={() => onNewCard(row.studentId)}>
                Tarjeta nueva<span className="sr-only"> para {row.displayName}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
