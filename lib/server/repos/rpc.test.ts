import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
import { callRpc, UnexpectedRpcError, withRequestId, type RpcBuilder, type RpcDb } from "./rpc";

type Reply = { data: unknown; error: { code?: string; message?: string; details?: string } | null };

const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const ARGS = { p_institution_id: GROUP_ID, p_name: "3A", p_subject_id: "math", p_school_year: 2027, p_op_key: GROUP_ID };

function fakeDb(reply: Reply) {
  const calls: { name: string; args: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const db: RpcDb = {
    rpc(name, args) {
      const headers: Record<string, string> = {};
      const call = { name, args, headers };
      calls.push(call);
      const builder: RpcBuilder = {
        then: (onFulfilled, onRejected) => Promise.resolve(reply).then(onFulfilled, onRejected),
        setHeader(header, value) {
          call.headers[header] = value;
          return builder;
        },
      };
      return builder;
    },
  };
  return { db, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("callRpc", () => {
  it("validates, calls and returns the parsed result", async () => {
    const { db, calls } = fakeDb({ data: { id: GROUP_ID, revision: 1 }, error: null });
    await expect(callRpc(db, "create_group", ARGS)).resolves.toEqual({ id: GROUP_ID, revision: 1 });
    expect(calls).toEqual([{ name: "create_group", args: ARGS, headers: {} }]);
  });

  it("turns an expected error into AppError with the Spanish text of its reason", async () => {
    const { db } = fakeDb({ data: null, error: { code: "P0001", message: "FORBIDDEN", details: "no_session" } });
    const failure = await callRpc(db, "create_group", ARGS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: "FORBIDDEN", message: "Tu sesión terminó. Volvé a entrar." });
  });

  it("treats any other database error as unexpected, without leaking its text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const secret = "duplicate key value (name)=(Ana Pérez)";
    const { db } = fakeDb({ data: null, error: { code: "23505", message: secret, details: secret } });
    const failure = await callRpc(db, "create_group", ARGS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnexpectedRpcError);
    expect(failure).toMatchObject({ code: "23505" });
    expect(failure).toHaveProperty("message", "Falló una llamada a la base de datos.");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Ana");
  });

  it("does not take a plain RAISE EXCEPTION for an expected error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = fakeDb({ data: null, error: { code: "P0001", message: "Hola Ana", details: "x" } });
    await expect(callRpc(db, "create_group", ARGS)).rejects.toBeInstanceOf(UnexpectedRpcError);
  });

  it("treats an answer that does not match its schema as unexpected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = fakeDb({ data: { id: GROUP_ID, revision: 1, extra: "x" }, error: null });
    await expect(callRpc(db, "create_group", ARGS)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("does not call the database with invalid arguments", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, calls } = fakeDb({ data: null, error: null });
    await expect(callRpc(db, "create_group", { ...ARGS, p_name: "" })).rejects.toMatchObject({ code: "invalid_args" });
    expect(calls).toHaveLength(0);
  });
});

// A client built with throwOnError(), or a network failure, throws instead of returning `error`.
function throwingDb(thrown: unknown, how: "sync" | "rejected"): RpcDb {
  return {
    rpc() {
      if (how === "sync") throw thrown;
      const builder: RpcBuilder = {
        then: (onFulfilled, onRejected) => Promise.reject(thrown).then(onFulfilled, onRejected),
        setHeader: () => builder,
      };
      return builder;
    },
  };
}

describe("callRpc with a client that throws", () => {
  const leaky = { code: "23505", message: 'duplicate key value: "Ana Pérez"', details: "Key (username)=(anap) exists." };

  it.each(["sync", "rejected"] as const)("never lets a thrown database error escape (%s)", async (how) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = await callRpc(throwingDb(leaky, how), "create_group", ARGS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnexpectedRpcError);
    expect(JSON.stringify(failure)).not.toContain("Ana");
    expect(String(failure)).not.toContain("Ana");
  });

  it("still translates a thrown expected error", async () => {
    const thrown = { code: "P0001", message: "FORBIDDEN", details: "no_session" };
    await expect(callRpc(throwingDb(thrown, "rejected"), "create_group", ARGS)).rejects.toBeInstanceOf(AppError);
  });

  it("treats a thrown value without a code as unexpected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(callRpc(throwingDb(new TypeError("fetch failed"), "rejected"), "create_group", ARGS)).rejects.toBeInstanceOf(
      UnexpectedRpcError,
    );
  });
});

describe("withRequestId", () => {
  it("sends the request id as x-request-id", async () => {
    const { db, calls } = fakeDb({ data: { items: [] }, error: null });
    await callRpc(withRequestId(db, "req-1"), "list_my_institutions", {});
    expect(calls[0]?.headers).toEqual({ "x-request-id": "req-1" });
  });
});
