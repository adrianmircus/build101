import { describe, expect, it } from "vitest";
import { publicOrigin } from "./request-origin";


describe("publicOrigin", () => {
  it("takes NEXT_PUBLIC_SITE_URL and drops path and trailing slash", () => {
    expect(publicOrigin({ NEXT_PUBLIC_SITE_URL: "https://tiza.ai/algo/" })).toBe("https://tiza.ai");
  });

  it("falls back to the URL of the Netlify site", () => {
    expect(publicOrigin({ URL: "https://tiza.netlify.app" })).toBe("https://tiza.netlify.app");
  });

  it("accepts http only on localhost", () => {
    expect(publicOrigin({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(() => publicOrigin({ NEXT_PUBLIC_SITE_URL: "http://tiza.ai" })).toThrow();
  });

  it("fails without configuration instead of guessing from the request", () => {
    expect(() => publicOrigin({})).toThrow(/NEXT_PUBLIC_SITE_URL/);
    expect(() => publicOrigin({ NEXT_PUBLIC_SITE_URL: "javascript:alert(1)" })).toThrow();
  });
});
