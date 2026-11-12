import { describe, expect, it } from "vitest";
import { ACCOUNTS, cardFor } from "./fixtures";
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

describe("pedir las tarjetas", () => {
  it("confirmar antes: ask abre el diálogo y cancelar lo cierra", () => {
    const asked = reducer(initialState(ACCOUNTS), { type: "ask", ids: [ids[0]!] });
    expect(asked.asking).toEqual([ids[0]]);
    expect(reducer(asked, { type: "cancelAsk" }).asking).toBeNull();
  });

  it("mientras corre un pedido no se abre otro", () => {
    const running = reducer(initialState(ACCOUNTS), { type: "start", ids });
    expect(running.running).toBe(true);
    expect(reducer(running, { type: "ask", ids }).asking).toBeNull();
  });

  it("al volver las tarjetas las guarda en memoria, pide imprimir y lo anuncia", () => {
    const cards = ACCOUNTS.slice(0, 2).map(cardFor);
    const state = reducer(reducer(initialState(ACCOUNTS), { type: "start", ids }), { type: "issued", data: { cards, others: [] } });
    expect(state.running).toBe(false);
    expect(state.held).toEqual(cards);
    expect(state.printNonce).toBe(1);
    expect(state.announcement).toBe("Se crearon 2 tarjetas. Se abre la ventana de impresión.");
  });

  it("los que no salieron quedan con su motivo y el aviso los cuenta", () => {
    const cards = [cardFor(ACCOUNTS[0]!, 0)];
    const others = [
      { studentId: ids[1]!, outcome: "failed" as const },
      { studentId: ids[2]!, outcome: "uncertain" as const },
    ];
    const state = reducer(initialState(ACCOUNTS), { type: "issued", data: { cards, others } });
    expect(state.others).toEqual(others);
    expect(state.announcement).toContain("A 2 estudiantes no pudimos crearle la tarjeta");
  });

  it("si no salió ninguna no imprime", () => {
    const state = reducer(initialState(ACCOUNTS), { type: "issued", data: { cards: [], others: [{ studentId: ids[1]!, outcome: "failed" }] } });
    expect(state.held).toBeNull();
    expect(state.printNonce).toBe(0);
  });

  it("imprimir de nuevo no cambia las tarjetas y listo las borra", () => {
    const cards = [cardFor(ACCOUNTS[0]!, 0)];
    let state = reducer(initialState(ACCOUNTS), { type: "issued", data: { cards, others: [] } });
    state = reducer(state, { type: "reprint" });
    expect(state.held).toEqual(cards);
    expect(state.printNonce).toBe(2);
    state = reducer(state, { type: "clear" });
    expect(state.held).toBeNull();
    expect(reducer(state, { type: "reprint" }).printNonce).toBe(2);
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
    const a = reducer(initialState(ACCOUNTS), { type: "failed", failure: { code: "UNAVAILABLE", message: "x" } });
    const b = reducer(a, { type: "failed", failure: { code: "UNAVAILABLE", message: "x" } });
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
