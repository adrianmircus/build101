import type { Field, Notice } from "./failure-view";

// What the student typed lives here and no action ever clears it: a failure only adds a notice or a pause.

export type LoginState = {
  code: string;
  username: string;
  password: string;
  reveal: boolean;
  busy: boolean;
  notice: Notice | null;
  /** Changes with every notice so the message takes the focus again, even if it is the same text. */
  noticeKey: number;
  pause: { retryAt: string | undefined; at: number } | null;
};

export type LoginAction =
  | { type: "edit"; field: Field; value: string }
  | { type: "reveal" }
  | { type: "start" }
  | { type: "notice"; notice: Notice }
  | { type: "pause"; retryAt: string | undefined; at: number }
  | { type: "resume" };

export function initialLoginState(start: { code: string; username: string }): LoginState {
  return { ...start, password: "", reveal: false, busy: false, notice: null, noticeKey: 0, pause: null };
}

export function loginReducer(state: LoginState, action: LoginAction): LoginState {
  switch (action.type) {
    case "edit": {
      const cleared = state.notice?.kind === "missing" && state.notice.field === action.field;
      return { ...state, [action.field]: action.value, notice: cleared ? null : state.notice };
    }
    case "reveal":
      return { ...state, reveal: !state.reveal };
    case "start":
      return { ...state, busy: true, notice: null };
    case "notice":
      return { ...state, busy: false, notice: action.notice, noticeKey: state.noticeKey + 1 };
    case "pause":
      return { ...state, busy: false, notice: null, pause: { retryAt: action.retryAt, at: action.at } };
    case "resume":
      return { ...state, pause: null };
  }
}

export function firstMissing(values: { code: string; username: string; password: string }): Field | null {
  if (values.code.trim() === "") return "code";
  if (values.username.trim() === "") return "username";
  if (values.password === "") return "password";
  return null;
}
