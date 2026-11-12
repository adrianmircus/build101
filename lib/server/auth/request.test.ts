import { describe, expect, it } from "vitest";
import { clientIp } from "./request";

const headers = (entries: Record<string, string>) => new Headers(entries);

describe("clientIp", () => {
  it("prefers the Netlify header", () => {
    expect(clientIp(headers({ "x-nf-client-connection-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
  });

  it("falls back to the first value of x-forwarded-for", () => {
    expect(clientIp(headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1, 10.0.0.2" }))).toBe("198.51.100.1");
  });

  it("is unknown when there is no header", () => {
    expect(clientIp(headers({}))).toBe("unknown");
  });

  it("is unknown when the values are empty or are not an address", () => {
    expect(clientIp(headers({ "x-nf-client-connection-ip": "  ", "x-forwarded-for": "" }))).toBe("unknown");
    expect(clientIp(headers({ "x-forwarded-for": "juan@example.com" }))).toBe("unknown");
    expect(clientIp(headers({ "x-forwarded-for": "1".repeat(80) }))).toBe("unknown");
  });

  it("skips a bad Netlify value and uses x-forwarded-for", () => {
    expect(clientIp(headers({ "x-nf-client-connection-ip": "not an ip", "x-forwarded-for": "198.51.100.1" }))).toBe("198.51.100.1");
  });

  it("reads IPv6 and lowercases it", () => {
    expect(clientIp(headers({ "x-nf-client-connection-ip": "2001:DB8::1" }))).toBe("2001:db8::1");
  });
});
