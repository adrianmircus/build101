import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetFragmentToken, fragmentKind, onFragmentChange, takeFragmentToken } from "./fragmentToken";

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

describe("un enlace cortado invalida el contexto anterior (F2-22)", () => {
  it("un token válido de A y después uno cortado de B: A ya no está, y la barra queda limpia", () => {
    stubWindow(`#${TOKEN}`);
    expect(takeFragmentToken()).toBe(TOKEN);
    const replaceState = stubWindow(`#${OTHER.slice(0, 30)}`);
    expect(takeFragmentToken()).toBe("");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/invitacion");
    // Y no vuelve solo: sin fragmento, lo retenido sigue siendo nada.
    stubWindow("");
    expect(takeFragmentToken()).toBe("");
  });

  it("lo mismo con un hash de recuperación truncado", () => {
    const hash = "ac20b40e9cbc86234ab2c8e61c4e5aa8fef5228060c284de5c93eb53";
    stubWindow(`#pkce_${hash}`);
    expect(takeFragmentToken()).toBe(`pkce_${hash}`);
    stubWindow(`#pkce_${hash.slice(0, 40)}`);
    expect(takeFragmentToken()).toBe("");
  });

  it("después de uno cortado, un token bueno vuelve a valer", () => {
    stubWindow(`#${TOKEN}`);
    takeFragmentToken();
    stubWindow("#cortado");
    takeFragmentToken();
    stubWindow(`#${OTHER}`);
    expect(takeFragmentToken()).toBe(OTHER);
  });

  it("distingue ancla conocida, id de la página, token y enlace roto", () => {
    expect(fragmentKind("")).toBe("empty");
    expect(fragmentKind("#")).toBe("empty");
    expect(fragmentKind("#main-content")).toBe("anchor");
    expect(fragmentKind(`#${TOKEN}`)).toBe("token");
    expect(fragmentKind("#abc_DEF-123")).toBe("invalid");
    vi.stubGlobal("document", { getElementById: (id: string) => (id === "contenido-listo" ? {} : null) });
    expect(fragmentKind("#contenido-listo")).toBe("anchor");
    expect(fragmentKind("#otro-id")).toBe("invalid");
  });

  it("hashchange avisa con un enlace roto, y no con un ancla", () => {
    const listeners: Array<() => void> = [];
    const win = { location: { hash: "#main-content" }, addEventListener: (_: string, fn: () => void) => listeners.push(fn), removeEventListener: vi.fn() };
    vi.stubGlobal("window", win);
    const onChange = vi.fn();
    onFragmentChange(onChange);
    listeners[0]();
    expect(onChange).not.toHaveBeenCalled();
    win.location.hash = `#${OTHER.slice(0, 20)}`;
    listeners[0]();
    expect(onChange).toHaveBeenCalledTimes(1);
    win.location.hash = "";
    listeners[0]();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
