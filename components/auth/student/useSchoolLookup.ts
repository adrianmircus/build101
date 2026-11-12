"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { findInstitutionAction } from "@/app/ingresar/estudiante/actions";
import { callAction } from "@/lib/client/callAction";

// When the student finishes typing the code, the school's name appears (or a message with the name that was typed).

export type Lookup = { kind: "none" } | { kind: "found"; name: string } | { kind: "missing" };

const SHAPE = /^[a-z0-9][a-z0-9-]{2,31}$/;
const PAUSE_MS = 700;

export function useSchoolLookup(rawCode: string, enabled: boolean) {
  const code = rawCode.trim().toLowerCase();
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const asked = useRef(new Set<string>());

  const ask = useCallback(async (value: string) => {
    if (!SHAPE.test(value) || asked.current.has(value)) return;
    asked.current.add(value);
    const result = await callAction(findInstitutionAction, { code: value });
    if (result.ok) setAnswers((previous) => ({ ...previous, [value]: result.data.name }));
    else if (result.code === "NOT_FOUND") setAnswers((previous) => ({ ...previous, [value]: null }));
    else asked.current.delete(value); // a failure on our side says nothing about the code: ask again later
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void ask(code), PAUSE_MS);
    return () => clearTimeout(timer);
  }, [code, enabled, ask]);

  const answer = answers[code];
  const state: Lookup = answer === undefined ? { kind: "none" } : answer === null ? { kind: "missing" } : { kind: "found", name: answer };
  return { state, lookupNow: () => void ask(code) };
}
