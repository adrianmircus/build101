// Pruebas sin IA del límite de intentos del login (lib/auth/rateLimit.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLocked,
  MAX_PER_IP_AND_USER,
  MAX_PER_USER,
  memoryStore,
  recordFailure,
  recordSuccess,
  resilient,
  WINDOW_SECONDS,
  type Store,
} from "@/lib/auth/rateLimit";

async function fail(times: number, who: { ip: string; username: string }, store: Store) {
  for (let i = 0; i < times; i++) await recordFailure(who.ip, who.username, store);
}

// A fake clock the tests can move forward; each case builds its own store so none depends on another.
let now = 0;
const clock = () => now;

beforeEach(() => {
  now = 0;
});

describe("límite de intentos del login", () => {
  it("con 9 fallos todavía puede intentar", async () => {
    const store = memoryStore(clock);
    await fail(MAX_PER_IP_AND_USER - 1, { ip: "1.1.1.1", username: "ana" }, store);
    expect(await isLocked("1.1.1.1", "ana", store)).toEqual(false);
  });

  describe("con 10 fallos de la misma IP y el mismo usuario", () => {
    let store: Store;
    beforeEach(async () => {
      store = memoryStore(clock);
      await fail(MAX_PER_IP_AND_USER, { ip: "1.1.1.1", username: "ana" }, store);
    });

    it("el intento 11 queda bloqueado", async () => {
      expect(await isLocked("1.1.1.1", "ana", store)).toEqual(true);
    });
    it("el usuario no distingue mayúsculas ni espacios", async () => {
      expect(await isLocked("1.1.1.1", "  ANA ", store)).toEqual(true);
    });
    it("desde otra IP no queda bloqueado", async () => {
      expect(await isLocked("2.2.2.2", "ana", store)).toEqual(false);
    });
    it("otro usuario desde la misma IP no queda bloqueado", async () => {
      expect(await isLocked("1.1.1.1", "bruno", store)).toEqual(false);
    });
    it("pasados 15 minutos se desbloquea", async () => {
      now += WINDOW_SECONDS * 1000;
      expect(await isLocked("1.1.1.1", "ana", store)).toEqual(false);
    });
  });

  it("un acierto limpia los fallos anteriores", async () => {
    const store = memoryStore(clock);
    await fail(5, { ip: "1.1.1.1", username: "camila" }, store);
    await recordSuccess("1.1.1.1", "camila", store);
    await fail(MAX_PER_IP_AND_USER - 1, { ip: "1.1.1.1", username: "camila" }, store);
    expect(await isLocked("1.1.1.1", "camila", store)).toEqual(false);
  });

  it("30 fallos repartidos entre IPs bloquean el usuario", async () => {
    const store = memoryStore(clock);
    for (let i = 0; i < MAX_PER_USER; i++) await recordFailure(`10.0.0.${i}`, "lucas", store);
    expect(await isLocked("10.0.9.9", "lucas", store)).toEqual(true);
  });

  describe("si el store compartido falla", () => {
    const broken: Store = {
      get: () => Promise.reject(new Error("caído")),
      increment: () => Promise.reject(new Error("caído")),
      clear: () => Promise.reject(new Error("caído")),
    };
    let store: Store;
    beforeEach(async () => {
      // The fallback logs a warning on every failure; keep the test output clean.
      vi.spyOn(console, "warn").mockImplementation(() => {});
      store = resilient(broken, memoryStore(clock));
      await fail(MAX_PER_IP_AND_USER, { ip: "1.1.1.1", username: "paula" }, store);
    });
    afterEach(() => vi.restoreAllMocks());

    it("sigue contando en memoria", async () => {
      expect(await isLocked("1.1.1.1", "paula", store)).toEqual(true);
    });
    it("y el login no se traba", async () => {
      expect(await isLocked("1.1.1.1", "tomas", store)).toEqual(false);
    });
  });

  describe("con tope de claves en memoria", () => {
    // Each failure uses 2 keys (IP + usuario, y usuario): with a cap of 4, two more usernames push "ana" out.
    let store: Store;
    beforeEach(async () => {
      store = memoryStore(clock, 4);
      await fail(MAX_PER_IP_AND_USER, { ip: "1.1.1.1", username: "ana" }, store);
    });

    it("antes del tope, el bloqueo está", async () => {
      expect(await isLocked("1.1.1.1", "ana", store)).toEqual(true);
    });
    it("la memoria descarta las claves más viejas", async () => {
      for (const u of ["b", "c"]) await recordFailure("1.1.1.1", u, store);
      expect(await isLocked("1.1.1.1", "ana", store)).toEqual(false);
    });
  });
});
