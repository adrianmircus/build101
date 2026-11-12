import type { AccessCard, AccountRow } from "@/lib/domain/accounts/entities";
import type { IssuedCards, OtherCard } from "@/lib/domain/accounts/results";
import type { Failure } from "@/lib/errors";

// The state of the cards page, as pure data and a pure reducer, so every state can be tested without a browser.
// The passwords live only in `held`: memory of this component while the page is open. They are never written to
// localStorage, sessionStorage or the URL, and `clear` (the «Listo» button) and `deactivate` (the screen leaves: hidden, unmounted, or pagehide) drop them.

export const CARDS_PER_SHEET = 4;
/** The most students in one request (IssueAccessCardsInput and issue_access_cards: from 1 to 60). */
export const MAX_PER_REQUEST = 60;

/** The text the contract fixes for a repeated request (docs/contratos/fase-2.md, «Emitir tarjetas»). */
export const ALREADY_ISSUED = "Las tarjetas ya se crearon. Si no llegaste a imprimirlas, creá nuevas.";

export type Notice = {
  kind: "conflict" | "failure";
  text: string;
  /** A retry makes sense: not when the answer was «no tenés permiso» or «no existe». */
  canRetry: boolean;
  /** A new number each time, so the alert is announced again even if the text is the same. */
  key: number;
};

export type State = {
  /** Ids of the students ticked in the list. */
  selected: string[];
  /** Ids waiting in the confirm dialog; null when it is closed. */
  asking: string[] | null;
  running: boolean;
  /**
   * The id of the request in flight; 0 when none. An answer carries the id it was asked with and counts only if it is
   * still this one: when the screen goes away (deactivate) the id goes to 0 and a late answer is dropped with its passwords.
   */
  request: number;
  /** The students of the last request, to try again. */
  lastRequest: string[];
  /** The cards of the last print. Only in memory, only while the page is open. */
  held: AccessCard[] | null;
  /** The students that got no card in the last request, with the reason. */
  others: OtherCard[];
  notice: Notice | null;
  /** Goes up with each new batch of cards (not with a reprint): the panel of the batch takes the focus again. */
  batch: number;
  /** What the polite live region says. */
  announcement: string;
  noticeKey: number;
};

export type Action =
  | { type: "toggle"; id: string }
  | { type: "toggleAll"; ids: string[]; on: boolean }
  | { type: "ask"; ids: string[] }
  | { type: "cancelAsk" }
  | { type: "start"; ids: string[]; request: number }
  | { type: "issued"; data: IssuedCards; request: number }
  | { type: "failed"; failure: Pick<Failure, "code" | "message">; request: number }
  | { type: "reprint" }
  | { type: "clear" }
  | { type: "deactivate" };

export function initialState(accounts: readonly AccountRow[]): State {
  return {
    selected: accounts.map((row) => row.studentId),
    asking: null,
    running: false,
    request: 0,
    lastRequest: [],
    held: null,
    others: [],
    notice: null,
    batch: 0,
    announcement: "",
    noticeKey: 0,
  };
}

export function cardsLabel(count: number): string {
  return count === 1 ? "1 tarjeta" : `${count} tarjetas`;
}

export function sheetsLabel(cards: number): string {
  const sheets = Math.ceil(cards / CARDS_PER_SHEET);
  return sheets === 1 ? "1 hoja A4" : `${sheets} hojas A4`;
}

/** «4 tarjetas, 1 hoja A4», or what to do when nobody is ticked. */
export function countText(selected: number): string {
  return selected === 0 ? "Todavía no elegiste a nadie." : `${cardsLabel(selected)}, ${sheetsLabel(selected)}`;
}

export const TOO_MANY = `Se pueden crear hasta ${MAX_PER_REQUEST} tarjetas por vez. Desmarcá a algunos e imprimí el resto en otra tanda.`;

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? displayName;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("es-UY", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Montevideo" }).format(new Date(iso));
}

const ACCOUNT_TEXT: Record<AccountRow["accountStatus"], string> = {
  active: "Cuenta lista",
  pending: "Cuenta por preparar: se prepara al imprimir",
  failed: "La cuenta no se pudo crear la vez anterior: se vuelve a intentar al imprimir",
  none: "Sin cuenta: es una demo",
};

/** The lines of a row of the list, in the order they are read: user, whether they came in, last card, account. */
export function studentLines(row: AccountRow): { access: string; lastCard: string; account: string } {
  return {
    access: row.hasSignedIn ? "ya entró" : "todavía no entró",
    lastCard: row.lastCardAt === null ? "todavía no tiene tarjeta" : `última tarjeta el ${formatDay(row.lastCardAt)}`,
    account: ACCOUNT_TEXT[row.accountStatus],
  };
}

export const OTHER_REASON: Record<OtherCard["outcome"], string> = {
  failed: "No se pudo crear la cuenta.",
  uncertain: "No pudimos confirmar. Probá de nuevo.",
};

function describeIssued(data: IssuedCards): string {
  const made = data.cards.length;
  const missed = data.others.length;
  if (made === 0) return missed === 0 ? "No se creó ninguna tarjeta." : "No se creó ninguna tarjeta. Mirá abajo qué pasó con cada estudiante.";
  const base = `Se ${made === 1 ? "creó" : "crearon"} ${cardsLabel(made)}. Se abre la ventana de impresión.`;
  return missed === 0 ? base : `${base} A ${missed} ${missed === 1 ? "estudiante" : "estudiantes"} no pudimos crearle la tarjeta: mirá abajo.`;
}

export function noticeFor(failure: Pick<Failure, "code" | "message">, key: number): Notice {
  if (failure.code === "CONFLICT") return { kind: "conflict", text: ALREADY_ISSUED, canRetry: true, key };
  const retryable = failure.code !== "FORBIDDEN" && failure.code !== "NOT_FOUND";
  return { kind: "failure", text: failure.message, canRetry: retryable, key };
}

function selectAll(ids: string[], on: boolean): string[] {
  return on ? [...ids] : [];
}

function toggle(state: State, id: string): State {
  const selected = state.selected.includes(id) ? state.selected.filter((other) => other !== id) : [...state.selected, id];
  return { ...state, selected };
}

function select(state: State, action: Extract<Action, { type: "toggle" | "toggleAll" }>): State {
  return action.type === "toggle" ? toggle(state, action.id) : { ...state, selected: selectAll(action.ids, action.on) };
}

function issued(state: State, data: IssuedCards, request: number): State {
  if (request !== state.request) return state;
  const printed = data.cards.length > 0;
  return {
    ...state,
    running: false,
    request: 0,
    held: printed ? data.cards : state.held,
    others: data.others,
    notice: null,
    batch: printed ? state.batch + 1 : state.batch,
    announcement: describeIssued(data),
  };
}

function failed(state: State, failure: Pick<Failure, "code" | "message">, request: number): State {
  if (request !== state.request) return state;
  const noticeKey = state.noticeKey + 1;
  return { ...state, running: false, request: 0, noticeKey, notice: noticeFor(failure, noticeKey), announcement: "" };
}

function ask(state: State, ids: string[]): State {
  return state.running ? state : { ...state, asking: ids };
}

function reprint(state: State): State {
  return state.held === null ? state : { ...state, announcement: "Se abre la ventana de impresión." };
}

function cleared(state: State): State {
  const announcement = state.held === null ? state.announcement : "Listo. Las contraseñas ya no están en la página.";
  return { ...state, held: null, announcement };
}

/** The screen goes away (hidden by Activity, unmounted, or the page is left): no passwords, no request in flight. */
function deactivated(state: State): State {
  return { ...state, held: null, running: false, request: 0, asking: null, notice: null, others: [], announcement: "" };
}

/** The actions about the end of a request and the end of the screen: what happens to the passwords. */
function ending(state: State, action: Extract<Action, { type: "issued" | "failed" | "reprint" | "clear" | "deactivate" }>): State {
  switch (action.type) {
    case "issued":
      return issued(state, action.data, action.request);
    case "failed":
      return failed(state, action.failure, action.request);
    case "reprint":
      return reprint(state);
    case "clear":
      return cleared(state);
    case "deactivate":
      return deactivated(state);
  }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "toggle":
    case "toggleAll":
      return select(state, action);
    case "ask":
      return ask(state, action.ids);
    case "cancelAsk":
      return { ...state, asking: null };
    case "start":
      // A new request answers the older one: its notice and its list of pending students go away.
      return { ...state, asking: null, running: true, request: action.request, lastRequest: action.ids, notice: null, others: [], announcement: "Creando las tarjetas…" };
    default:
      return ending(state, action);
  }
}
