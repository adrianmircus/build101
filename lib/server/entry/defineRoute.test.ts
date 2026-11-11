import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { defineRoute } from "./defineRoute";

const post = (body: string) => new Request("http://test/api/x", { method: "POST", body });

describe("defineRoute", () => {
  it("reads the JSON body and answers 200 with no-store", async () => {
    const route = defineRoute({ name: "t.json", input: z.object({ n: z.number() }), from: "json" }, async ({ n }) => n * 2);
    const response = await route(post(JSON.stringify({ n: 21 })));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, data: 42 });
  });

  it("reads the query string", async () => {
    const route = defineRoute({ name: "t.query", input: z.object({ id: z.string() }), from: "query" }, async ({ id }) => id);
    const response = await route(new Request("http://test/api/x?id=abc"));
    expect(await response.json()).toEqual({ ok: true, data: "abc" });
  });

  it("answers 400 for a body that is not JSON", async () => {
    const route = defineRoute({ name: "t.bad", input: z.object({}), from: "json" }, async () => 1);
    const response = await route(post("{nope"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "INVALID" });
  });

  it("maps AppError codes to HTTP statuses", async () => {
    const route = defineRoute({ name: "t.forbidden", input: z.object({}), from: "json" }, async () => {
      throw new AppError("FORBIDDEN", "No tenés acceso a este grupo.");
    });
    const response = await route(post("{}"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN", message: "No tenés acceso a este grupo." });
  });
});
