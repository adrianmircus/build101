"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, type FormEvent } from "react";
import { findInstitutionAction } from "@/app/ingresar/estudiante/actions";
import { callAction } from "@/lib/client/callAction";
import type { RememberedSchool } from "@/lib/client/remembered-school";
import type { Field } from "./failure-view";
import { attemptLogin } from "./login-attempt";
import { firstMissing, initialLoginState, loginReducer } from "./login-state";
import { CODE_ID } from "./SchoolCodeField";
import { useSchoolLookup } from "./useSchoolLookup";

type Input = {
  /** The school already known (remembered on this device, or read from a card): the code is not asked again. */
  school: RememberedSchool | null;
  username: string;
};

/** The state and the actions of the login. The school's code is `school.code` when it is known, what was typed when not. */
export function useStudentLogin({ school, username }: Input) {
  const router = useRouter();
  const [state, dispatch] = useReducer(loginReducer, { code: school?.code ?? "", username }, initialLoginState);
  // Hidden or unmounted (Next keeps hidden screens alive with Activity, form values included): no password, no «mostrar», no busy button left.
  useEffect(() => () => dispatch({ type: "wipe" }), []);
  const lookup = useSchoolLookup(state.code, school === null);
  const code = school?.code ?? state.code.trim().toLowerCase();

  async function knownName(): Promise<string | null> {
    if (school) return school.name;
    if (lookup.state.kind === "found") return lookup.state.name;
    const found = await callAction(findInstitutionAction, { code });
    return found.ok ? found.data.name : null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (state.busy) return;
    const missing = firstMissing({ code, username: state.username, password: state.password });
    if (missing) return dispatch({ type: "notice", notice: { kind: "missing", field: missing } });
    if (!school && lookup.state.kind === "missing") return document.getElementById(CODE_ID)?.focus();
    dispatch({ type: "start" });
    await attemptLogin({ values: { code, username: state.username, password: state.password }, knownName, dispatch, go: (next) => router.push(next) });
  }

  return {
    state,
    lookup,
    code,
    submit,
    edit: (field: Field, value: string) => dispatch({ type: "edit", field, value }),
    toggleReveal: () => dispatch({ type: "reveal" }),
    resume: () => dispatch({ type: "resume" }),
  };
}

export type StudentLoginController = ReturnType<typeof useStudentLogin>;
