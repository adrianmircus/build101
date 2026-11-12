import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetSchool,
  parseRememberedSchool,
  readRememberedSchool,
  rememberSchool,
  subscribeRememberedSchool,
} from "./remembered-school";

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("colegio recordado", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("guarda solo el código y el nombre", () => {
    const extra = { code: "sanjose", name: "Colegio San José", username: "luciaf", password: "sol-nube-tigre-47" };
    rememberSchool(extra);
    expect([...storage.data.values()]).toHaveLength(1);
    const saved = JSON.parse([...storage.data.values()][0] ?? "null");
    expect(saved).toEqual({ code: "sanjose", name: "Colegio San José" });
    expect(JSON.stringify(saved)).not.toMatch(/luciaf|sol-nube/);
  });

  it("lo lee de vuelta y lo olvida", () => {
    rememberSchool({ code: " SanJose ", name: "Colegio San José" });
    expect(readRememberedSchool()).toEqual({ code: "sanjose", name: "Colegio San José" });
    forgetSchool();
    expect(readRememberedSchool()).toBeNull();
  });

  it("avisa a quien escucha cuando cambia", () => {
    const listener = vi.fn();
    const off = subscribeRememberedSchool(listener);
    rememberSchool({ code: "sanjose", name: "Colegio San José" });
    forgetSchool();
    off();
    rememberSchool({ code: "sanjose", name: "Colegio San José" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ignora lo que no tiene la forma esperada", () => {
    for (const raw of [null, "", "no es json", "[]", '{"code":"ab","name":"x"}', '{"code":"sanjose"}', '{"code":"sanjose","name":" "}']) {
      expect(parseRememberedSchool(raw)).toBeNull();
    }
  });

  it("descarta campos de más al leer", () => {
    expect(parseRememberedSchool('{"code":"sanjose","name":"San José","username":"luciaf"}')).toEqual({ code: "sanjose", name: "San José" });
  });

  it("no falla si el almacenamiento está bloqueado", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    });
    expect(() => rememberSchool({ code: "sanjose", name: "San José" })).not.toThrow();
    expect(readRememberedSchool()).toBeNull();
    expect(() => forgetSchool()).not.toThrow();
  });
});
