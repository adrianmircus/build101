import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TokenHash } from "@/lib/domain/accounts/rpc";
import { Token } from "@/lib/domain/accounts/inputs";
import { deriveOpKey, hashToken, newToken } from "./tokens";

describe("newToken", () => {
  it("are 32 bytes in base64url, the shape the routes accept", () => {
    const token = newToken();
    expect(Token.safeParse(token).success).toBe(true);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("never repeats", () => {
    expect(new Set(Array.from({ length: 200 }, newToken)).size).toBe(200);
  });
});

describe("hashToken", () => {
  it("is the sha256 of the token as a bytea of the registry", () => {
    const token = newToken();
    const hash = hashToken(token);
    expect(TokenHash.safeParse(hash).success).toBe(true);
    expect(hash).toBe(`\\x${createHash("sha256").update(token).digest("hex")}`);
  });
});

describe("deriveOpKey", () => {
  const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

  it("matches the UUID v5 of the RFC (the name www.example.com in the DNS namespace)", () => {
    expect(deriveOpKey(NAMESPACE, "www.example.com")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("is stable per name and different between names", () => {
    expect(deriveOpKey(NAMESPACE, "a@b.test")).toBe(deriveOpKey(NAMESPACE, "a@b.test"));
    expect(deriveOpKey(NAMESPACE, "a@b.test")).not.toBe(deriveOpKey(NAMESPACE, "c@d.test"));
  });

  it("refuses a namespace that is not a UUID", () => {
    expect(() => deriveOpKey("no-es-un-uuid", "x")).toThrow();
  });
});
