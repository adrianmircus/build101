import { describe, expect, it } from "vitest";
import { firstMissing, initialLoginState, loginReducer, type LoginState } from "./login-state";

function typed(): LoginState {
  let state = initialLoginState({ code: "sanjose", username: "" });
  state = loginReducer(state, { type: "edit", field: "username", value: "luciaf" });
  return loginReducer(state, { type: "edit", field: "password", value: "nube tigre 47" });
}

describe("lo escrito no se borra", () => {
  const values = (s: LoginState) => [s.code, s.username, s.password];

  it("un aviso, una pausa y el volver dejan los tres datos como estaban", () => {
    const before = values(typed());
    let state = loginReducer(typed(), { type: "start" });
    state = loginReducer(state, { type: "notice", notice: { kind: "wrong" } });
    expect(values(state)).toEqual(before);
    state = loginReducer(state, { type: "pause", retryAt: "2026-11-12T15:40:00.000Z", at: 1 });
    expect(values(state)).toEqual(before);
    expect(state.pause).toEqual({ retryAt: "2026-11-12T15:40:00.000Z", at: 1 });
    expect(values(loginReducer(state, { type: "resume" }))).toEqual(before);
  });

  it("mostrar u ocultar la contraseña no toca el texto", () => {
    expect(values(loginReducer(typed(), { type: "reveal" }))).toEqual(values(typed()));
  });

  it("cada aviso nuevo cambia la clave, para que el mensaje vuelva a tomar el foco", () => {
    const first = loginReducer(typed(), { type: "notice", notice: { kind: "wrong" } });
    const second = loginReducer(first, { type: "notice", notice: { kind: "wrong" } });
    expect(second.noticeKey).toBeGreaterThan(first.noticeKey);
  });

  it("«falta un dato» se va cuando se escribe ese dato, y los otros avisos se quedan", () => {
    const missing = loginReducer(typed(), { type: "notice", notice: { kind: "missing", field: "username" } });
    expect(loginReducer(missing, { type: "edit", field: "username", value: "l" }).notice).toBeNull();
    expect(loginReducer(missing, { type: "edit", field: "password", value: "x" }).notice).toEqual({ kind: "missing", field: "username" });
    const wrong = loginReducer(typed(), { type: "notice", notice: { kind: "wrong" } });
    expect(loginReducer(wrong, { type: "edit", field: "password", value: "x" }).notice).toEqual({ kind: "wrong" });
  });
});

describe("firstMissing", () => {
  it("sigue el orden de la tarjeta", () => {
    expect(firstMissing({ code: " ", username: "", password: "" })).toBe("code");
    expect(firstMissing({ code: "sanjose", username: "", password: "" })).toBe("username");
    expect(firstMissing({ code: "sanjose", username: "luciaf", password: "" })).toBe("password");
    expect(firstMissing({ code: "sanjose", username: "luciaf", password: "x" })).toBeNull();
  });
});
