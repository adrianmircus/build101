import { describe, expect, it } from "vitest";
import { DECOY_HASH, hashPassword, verifyPassword } from "./password-hash";

describe("hashPassword and verifyPassword", () => {
  it("make a hash in the fixed format that only the same password matches", async () => {
    const hash = await hashPassword("sol-nube-tigre-47");
    expect(hash).toMatch(/^scrypt\$15\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
    expect(await verifyPassword("sol-nube-tigre-47", hash)).toBe(true);
    expect(await verifyPassword("sol-nube-tigre-48", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("use a new salt every time: the same password never gives the same hash", async () => {
    const [a, b] = await Promise.all([hashPassword("mar-luna-pez-22"), hashPassword("mar-luna-pez-22")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("mar-luna-pez-22", a)).toBe(true);
    expect(await verifyPassword("mar-luna-pez-22", b)).toBe(true);
  });

  it("say no, and never throw, to anything that is not exactly our format", async () => {
    const good = await hashPassword("x");
    const [, , , , salt, key] = good.split("$");
    const bad = [
      "",
      "scrypt",
      good.replace("scrypt$15$8$1", "scrypt$14$8$1"),
      good.replace("scrypt$15$8$1", "scrypt$15$8$2"),
      good.replace("scrypt$15$8$1", "scrypt$15$16$1"),
      good.replace("scrypt$", "scryptx$"),
      `${good}$extra`,
      `scrypt$15$8$1$${salt}`,
      `scrypt$15$8$1$${(salt ?? "").slice(0, 20)}==$${key}`,
      `scrypt$15$8$1$${salt}$${(key ?? "").slice(0, 42)}=`,
      `scrypt$15$8$1$${Buffer.alloc(24).toString("base64")}$${key}`,
      `scrypt$15$8$1$${salt}$${Buffer.alloc(33).toString("base64")}`,
      `scrypt$15$8$1$${salt}$${key}\n`,
      ` ${good}`,
    ];
    for (const hash of bad) expect(await verifyPassword("x", hash), hash).toBe(false);
  });

  it("refuse base64 that is not the canonical text of its bytes", async () => {
    // The last character of 16 bytes carries 4 spare bits: `B==` and `A==` decode to the same bytes, only one is canonical.
    const salt = Buffer.alloc(SALT).toString("base64");
    const key = Buffer.alloc(32, 7).toString("base64");
    const twisted = `${salt.slice(0, 21)}B==`;
    expect(Buffer.from(twisted, "base64").equals(Buffer.alloc(SALT))).toBe(true);
    expect(await verifyPassword("x", `scrypt$15$8$1$${twisted}$${key}`)).toBe(false);
  });
});

const SALT = 16;

describe("DECOY_HASH", () => {
  it("has exactly the parameters of a real hash, so checking against it costs the same", async () => {
    const real = await hashPassword("x");
    expect(DECOY_HASH.split("$").slice(0, 4)).toEqual(real.split("$").slice(0, 4));
    expect(DECOY_HASH).toMatch(/^scrypt\$15\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
  });

  it("is a hash that parses (so the work is done) and that no password the student can type matches", async () => {
    const typed = ["", "x", "sol-nube-tigre-47", "AAAAAAAAAAAAAAAAAAAAAA==", DECOY_HASH, "scrypt", "0".repeat(32)];
    for (const password of typed) expect(await verifyPassword(password, DECOY_HASH), password).toBe(false);
  });

  it("takes as long as a real check, not less (it is really run through scrypt)", async () => {
    const real = await hashPassword("x");
    const time = async (hash: string) => {
      const started = performance.now();
      await verifyPassword("y", hash);
      return performance.now() - started;
    };
    const [decoy, own] = [await time(DECOY_HASH), await time(real)];
    // Same order of magnitude: the decoy is never the cheap path (a malformed hash would answer in under a millisecond).
    expect(decoy).toBeGreaterThan(own / 4);
  });
});
