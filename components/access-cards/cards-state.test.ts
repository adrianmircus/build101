import { describe, expect, it } from "vitest";
import { ACCOUNTS, PASSWORDS, TOKEN, cardFor } from "./fixtures";
import { ALREADY_ISSUED, countText, firstName, initialState, noticeFor, reducer, sheetsLabel, studentLines } from "./cards-state";

const ids = ACCOUNTS.map((row) => row.studentId);

describe("selección", () => {
  it("arranca con todo el grupo marcado", () => {
    expect(initialState(ACCOUNTS).selected).toEqual(ids);
  });

  it("marca y desmarca de a uno y todo el grupo", () => {
    let state = reducer(initialState(ACCOUNTS), { type: "toggle", id: ids[0]! });
    expect(state.selected).not.toContain(ids[0]);
    state = reducer(state, { type: "toggle", id: ids[0]! });
    expect(state.selected).toContain(ids[0]);
    state = reducer(state, { type: "toggleAll", ids, on: false });
    expect(state.selected).toEqual([]);
    expect(reducer(state, { type: "toggleAll", ids, on: true }).selected).toEqual(ids);
  });

  it("dice cuántas tarjetas y hojas salen", () => {
    expect(countText(0)).toBe("Todavía no elegiste a nadie.");
    expect(countText(1)).toBe("1 tarjeta, 1 hoja A4");
    expect(countText(4)).toBe("4 tarjetas, 1 hoja A4");
    expect(countText(5)).toBe("5 tarjetas, 2 hojas A4");
    expect(sheetsLabel(28)).toBe("7 hojas A4");
  });
});

// A request as the screen makes it: «start» with an id, and the answer with the same id.
const begin = (state = initialState(ACCOUNTS), request = 1) => reducer(state, { type: "start", ids, request });
const CARDS = ACCOUNTS.slice(0, 2).map(cardFor);

describe("pedir las tarjetas", () => {
  it("confirmar antes: ask abre el diálogo y cancelar lo cierra", () => {
    const asked = reducer(initialState(ACCOUNTS), { type: "ask", ids: [ids[0]!] });
    expect(asked.asking).toEqual([ids[0]]);
    expect(reducer(asked, { type: "cancelAsk" }).asking).toBeNull();
  });

  it("mientras corre un pedido no se abre otro", () => {
    const running = begin();
    expect(running.running).toBe(true);
    expect(reducer(running, { type: "ask", ids }).asking).toBeNull();
  });

  it("al volver las tarjetas las guarda en memoria y lo anuncia", () => {
    const state = reducer(begin(), { type: "issued", data: { cards: CARDS, others: [] }, request: 1 });
    expect(state.running).toBe(false);
    expect(state.request).toBe(0);
    expect(state.held).toEqual(CARDS);
    expect(state.announcement).toBe("Se crearon 2 tarjetas. Se abre la ventana de impresión.");
  });

  it("los que no salieron quedan con su motivo y el aviso los cuenta", () => {
    const cards = [cardFor(ACCOUNTS[0]!, 0)];
    const others = [
      { studentId: ids[1]!, outcome: "failed" as const },
      { studentId: ids[2]!, outcome: "uncertain" as const },
    ];
    const state = reducer(begin(), { type: "issued", data: { cards, others }, request: 1 });
    expect(state.others).toEqual(others);
    expect(state.announcement).toContain("A 2 estudiantes no pudimos crearle la tarjeta");
  });

  it("si no salió ninguna no guarda nada para imprimir", () => {
    const state = reducer(begin(), { type: "issued", data: { cards: [], others: [{ studentId: ids[1]!, outcome: "failed" }] }, request: 1 });
    expect(state.held).toBeNull();
  });

  it("imprimir de nuevo no cambia las tarjetas, y listo las borra", () => {
    let state = reducer(begin(), { type: "issued", data: { cards: [cardFor(ACCOUNTS[0]!, 0)], others: [] }, request: 1 });
    const held = state.held;
    state = reducer(state, { type: "reprint" });
    expect(state.held).toEqual(held);
    state = reducer(state, { type: "clear" });
    expect(state.held).toBeNull();
    expect(reducer(state, { type: "reprint" })).toBe(state);
  });
});

describe("salir de la pantalla borra las contraseñas", () => {
  const withCards = () => reducer(begin(), { type: "issued", data: { cards: CARDS, others: [] }, request: 1 });

  it("al desactivarse no queda ninguna contraseña en el estado", () => {
    const state = reducer(withCards(), { type: "deactivate" });
    expect(state.held).toBeNull();
    expect(JSON.stringify(state)).not.toContain(PASSWORDS[0]);
    expect(JSON.stringify(state)).not.toContain(TOKEN);
  });

  it("al desactivarse se cierra todo lo que estaba a medias: diálogo, avisos, pedido en curso", () => {
    let state = reducer(begin(), { type: "failed", failure: { code: "UNAVAILABLE", message: "x" }, request: 1 });
    state = reducer(reducer(state, { type: "ask", ids }), { type: "deactivate" });
    expect(state).toMatchObject({ asking: null, notice: null, running: false, request: 0, announcement: "" });
  });

  it("una respuesta que llega después de desactivarse se descarta con sus contraseñas", () => {
    const left = reducer(begin(), { type: "deactivate" });
    const late = reducer(left, { type: "issued", data: { cards: CARDS, others: [] }, request: 1 });
    expect(late).toBe(left);
    expect(late.held).toBeNull();
    expect(reducer(left, { type: "failed", failure: { code: "UNAVAILABLE", message: "x" }, request: 1 })).toBe(left);
  });

  it("la respuesta de un pedido viejo no pisa a uno nuevo", () => {
    const second = begin(reducer(begin(), { type: "deactivate" }), 2);
    expect(reducer(second, { type: "issued", data: { cards: CARDS, others: [] }, request: 1 })).toBe(second);
    expect(reducer(second, { type: "issued", data: { cards: CARDS, others: [] }, request: 2 }).held).toEqual(CARDS);
  });

  it("al volver a mostrarse la pantalla no hay nada que imprimir ni que reimprimir", () => {
    const back = reducer(withCards(), { type: "deactivate" });
    expect(reducer(back, { type: "reprint" })).toBe(back);
    expect(back).not.toHaveProperty("printNonce");
  });
});

describe("avisos de error", () => {
  it("un CONFLICT es «ya se crearon» y se puede crear de nuevo", () => {
    const notice = noticeFor({ code: "CONFLICT", message: "otra cosa" }, 1);
    expect(notice).toMatchObject({ kind: "conflict", text: ALREADY_ISSUED, canRetry: true });
    expect(notice.text).toBe("Las tarjetas ya se crearon. Si no llegaste a imprimirlas, creá nuevas.");
  });

  it("sin permiso no ofrece reintentar y cada aviso lleva una clave nueva", () => {
    expect(noticeFor({ code: "FORBIDDEN", message: "No tenés permiso para hacer esto." }, 1).canRetry).toBe(false);
    const a = reducer(begin(), { type: "failed", failure: { code: "UNAVAILABLE", message: "x" }, request: 1 });
    const b = reducer(begin(a, 2), { type: "failed", failure: { code: "UNAVAILABLE", message: "x" }, request: 2 });
    expect(b.notice!.key).not.toBe(a.notice!.key);
    expect(a.notice!.canRetry).toBe(true);
  });
});

describe("textos de la lista", () => {
  it("dice si ya entró, la última tarjeta y el estado de la cuenta", () => {
    expect(studentLines(ACCOUNTS[0]!)).toEqual({ access: "ya entró", lastCard: "última tarjeta el 3 de noviembre de 2026", account: "Cuenta lista" });
    expect(studentLines(ACCOUNTS[1]!).lastCard).toBe("todavía no tiene tarjeta");
    expect(studentLines({ ...ACCOUNTS[0]!, accountStatus: "none" }).account).toBe("Sin cuenta: es una demo");
  });

  it("saluda por el primer nombre", () => {
    expect(firstName("Lucía Fernández")).toBe("Lucía");
  });
});
