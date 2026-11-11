import { redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError, MESSAGES } from "@/lib/errors";
import { defineAction } from "./defineAction";

const input = z.object({ title: z.string().min(1, "Poné un título.") });

afterEach(() => vi.restoreAllMocks());

describe("defineAction", () => {
  it("passes validated input to the handler and wraps the value", async () => {
    const action = defineAction({ name: "test.ok", input }, async ({ title }) => title.toUpperCase());
    expect(await action({ title: "práctico" })).toEqual({ ok: true, data: "PRÁCTICO" });
  });

  it("answers INVALID with per-field messages and never calls the handler", async () => {
    const handler = vi.fn(async () => "never");
    const action = defineAction({ name: "test.invalid", input }, handler);
    const result = await action({ title: "" });
    expect(result).toMatchObject({ ok: false, code: "INVALID", fields: { title: "Poné un título." } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps the code and message of an AppError", async () => {
    const action = defineAction({ name: "test.conflict", input }, async () => {
      throw new AppError("CONFLICT", MESSAGES.CONFLICT);
    });
    expect(await action({ title: "x" })).toMatchObject({ ok: false, code: "CONFLICT", message: MESSAGES.CONFLICT });
  });

  it("hides unexpected errors behind a generic message and logs them with the request id", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const action = defineAction({ name: "test.bug", input }, async () => {
      throw new Error("relation \"secret_table\" does not exist");
    });
    const result = await action({ title: "x" });
    expect(result).toMatchObject({ ok: false, code: "INTERNAL", message: MESSAGES.INTERNAL });
    if (result.ok) throw new Error("expected a failure");
    expect(result.message).not.toContain("secret_table");
    const line = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ level: "error", event: "entry.unexpected", entry: "test.bug", requestId: result.requestId });
  });

  it("lets redirect() reach Next instead of answering a Result", async () => {
    const action = defineAction({ name: "test.redirect", input }, async () => redirect("/panel"));
    await expect(action({ title: "x" })).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });

  it("answers field messages in Spanish when the schema has none", async () => {
    const action = defineAction({ name: "test.defaults", input: z.object({ n: z.number(), s: z.string().min(3) }) }, async () => 1);
    const result = await action(JSON.parse('{"s":"ab"}'));
    expect(result).toMatchObject({ ok: false, fields: { n: "Este dato es obligatorio.", s: "Tiene que tener al menos 3 caracteres." } });
  });
});
