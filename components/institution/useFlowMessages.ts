"use client";

import { useRef, useState } from "react";
import type { FieldProblem } from "@/components/auth/staff/ErrorSummary";

// What a flow tells the person: a list of data to fix, and a neutral notice. Each message carries an `attempt` number
// that changes every time, and the screen uses it as `key`: the message is mounted again, takes the focus and is
// announced again even when its text is the same as before.

export type Stamped<T> = { list: T; attempt: number };

export function useFlowMessages() {
  const [problems, setProblems] = useState<Stamped<FieldProblem[]> | null>(null);
  const [notice, setNotice] = useState<{ text: string; attempt: number } | null>(null);
  const counter = useRef(0);

  const say = (text: string | null) => setNotice(text ? { text, attempt: ++counter.current } : null);
  /** Shows the list (or clears it when empty) and says whether there was something to fix. */
  const flag = (list: FieldProblem[]): boolean => {
    setProblems(list.length > 0 ? { list, attempt: ++counter.current } : null);
    return list.length > 0;
  };
  const clear = () => {
    setNotice(null);
    setProblems(null);
  };

  return { problems, notice, say, flag, clear };
}
