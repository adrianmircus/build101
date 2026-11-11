import { redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError, MESSAGES } from "@/lib/errors";
import { defineRoute } from "./defineRoute";

afterEach(() => vi.restoreAllMocks());

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

  it("answers 400 with per-field messages when the input fails the schema", async () => {
    const route = defineRoute({ name: "t.fields", input: z.object({ title: z.string().min(1, "Poné un título.") }), from: "json" }, async () => 1);
    const response = await route(post(JSON.stringify({ title: "" })));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID", fields: { title: "Poné un título." } });
  });

  it("answers 500 with a generic message when the handler has a bug", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const route = defineRoute({ name: "t.bug", input: z.object({}), from: "json" }, async () => {
      throw new Error("relation \"secret_table\" does not exist");
    });
    const response = await route(post("{}"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ code: "INTERNAL", message: MESSAGES.INTERNAL });
    expect(JSON.stringify(body)).not.toContain("secret_table");
  });

  it("lets redirect() reach Next instead of answering 500", async () => {
    const route = defineRoute({ name: "t.redirect", input: z.object({}), from: "json" }, async () => redirect("/panel"));
    await expect(route(post("{}"))).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });

  it("gives the handler the resolved params of a dynamic route like /api/jobs/[id]", async () => {
    const route = defineRoute({ name: "t.params", input: z.object({}), from: "query" }, async (_input, { params }) => params.id);
    const response = await route(new Request("http://test/api/jobs/j7"), { params: Promise.resolve({ id: "j7" }) });
    expect(await response.json()).toEqual({ ok: true, data: "j7" });
  });

  it("answers 500 INTERNAL with a request id when the schema transform throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const input = z.object({ raw: z.string().transform((text) => JSON.parse(text)) });
    const route = defineRoute({ name: "t.transform", input, from: "json" }, async () => 1);
    const response = await route(post(JSON.stringify({ raw: "{estudiante Ana" })));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, code: "INTERNAL", requestId: expect.any(String) });
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({ entry: "t.transform", requestId: body.requestId });
  });
});
