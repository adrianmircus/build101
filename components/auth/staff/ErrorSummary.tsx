"use client";

import type { MouseEvent } from "react";
import { StatusMessage } from "./StatusMessage";

// When a form has data to fix: one message on top (it takes the focus) with a link to each field. Each field also
// shows its own message next to it. Same pattern as the long forms of the maquetas.

/** `summary` is a shorter text for the list on top, when the message beside the field is long. */
export type FieldProblem = { field: string; message: string; summary?: string };

// The link goes to the field and leaves the address bar alone.
function focusField(event: MouseEvent<HTMLAnchorElement>, field: string) {
  event.preventDefault();
  document.getElementById(field)?.focus();
}

export function ErrorSummary({ title, problems }: { title: string; problems: FieldProblem[] }) {
  return (
    <StatusMessage tone="error">
      <p className="font-semibold">{title}</p>
      <ul className="list-disc space-y-1 pl-5">
        {problems.map((problem) => (
          <li key={problem.field}>
            <a href={`#${problem.field}`} onClick={(event) => focusField(event, problem.field)} className="font-semibold underline underline-offset-4">
              {problem.summary ?? problem.message}
            </a>
          </li>
        ))}
      </ul>
    </StatusMessage>
  );
}

export function problemFor(problems: FieldProblem[], field: string): string | undefined {
  return problems.find((problem) => problem.field === field)?.message;
}
