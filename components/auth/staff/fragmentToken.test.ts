import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetFragmentToken, takeFragmentToken } from "./fragmentToken";

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
    const replaceState = stubWindow("#abc_DEF-123");
    expect(takeFragmentToken()).toBe("abc_DEF-123");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/invitacion");
  });

  it("la segunda lectura (Strict Mode, o volver a probar) sigue teniendo el token, solo en memoria", () => {
    stubWindow("#abc");
    takeFragmentToken();
    const replaceState = stubWindow("");
    expect(takeFragmentToken()).toBe("abc");
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("sin fragmento ni nada leído antes, no hay token", () => {
    stubWindow("");
    expect(takeFragmentToken()).toBe("");
  });
});
