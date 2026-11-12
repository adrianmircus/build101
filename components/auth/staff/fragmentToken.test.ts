import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetFragmentToken, onFragmentChange, takeFragmentToken } from "./fragmentToken";

const TOKEN = "abc_DEF-123".padEnd(43, "x");
const OTHER = "z".repeat(43);

function stubWindow(hash: string) {
  const replaceState = vi.fn();
  vi.stubGlobal("window", { location: { hash, pathname: "/invitacion", search: "" }, history: { replaceState } });
  return replaceState;
}

afterEach(() => {
  forgetFragmentToken();
  vi.unstubAllGlobals();
});

describe("takeFragmentToken", () => {
  it("lee el fragmento y lo borra de la barra sin dejar rastro en el historial", () => {
    const replaceState = stubWindow(`#${TOKEN}`);
    expect(takeFragmentToken()).toBe(TOKEN);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/invitacion");
  });

  it("la segunda lectura (Strict Mode, o volver a probar) sigue teniendo el token, solo en memoria", () => {
    stubWindow(`#${TOKEN}`);
    takeFragmentToken();
    const replaceState = stubWindow("");
    expect(takeFragmentToken()).toBe(TOKEN);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("sin fragmento ni nada leído antes, no hay token", () => {
    stubWindow("");
    expect(takeFragmentToken()).toBe("");
  });
});

describe("un ancla interna no pisa el token", () => {
  it("«Saltar al contenido» (#main-content) se ignora y se conserva el token que ya había", () => {
    stubWindow(`#${TOKEN}`);
    takeFragmentToken();
    const replaceState = stubWindow("#main-content");
    expect(takeFragmentToken()).toBe(TOKEN);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("un fragmento con la forma de un token nuevo sí lo reemplaza", () => {
    stubWindow(`#${TOKEN}`);
    takeFragmentToken();
    stubWindow(`#${OTHER}`);
    expect(takeFragmentToken()).toBe(OTHER);
  });

  it("el token del enlace de recuperación (hash de Supabase, con o sin pkce_) también cuenta como token", () => {
    const hash = "ac20b40e9cbc86234ab2c8e61c4e5aa8fef5228060c284de5c93eb53";
    stubWindow(`#pkce_${hash}`);
    expect(takeFragmentToken()).toBe(`pkce_${hash}`);
    stubWindow("#main-content");
    expect(takeFragmentToken()).toBe(`pkce_${hash}`);
    stubWindow(`#${hash}`);
    expect(takeFragmentToken()).toBe(hash);
  });

  it("hashchange solo avisa cuando el fragmento es un token", () => {
    const listeners: Array<() => void> = [];
    const win = { location: { hash: "#main-content" }, addEventListener: (_: string, fn: () => void) => listeners.push(fn), removeEventListener: vi.fn() };
    vi.stubGlobal("window", win);
    const onChange = vi.fn();
    onFragmentChange(onChange);
    listeners[0]();
    expect(onChange).not.toHaveBeenCalled();
    win.location.hash = `#${TOKEN}`;
    listeners[0]();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
