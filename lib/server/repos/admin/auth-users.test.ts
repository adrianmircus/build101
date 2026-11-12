import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthAdminError, createAuthUser, deleteAuthUser, exchangeMagicLink, getAuthUser, magicLinkToken } from "./auth-users";

// A server that accepts the request and never answers: what a stuck Auth looks like. Every call has to give up at 5 seconds.
let server: Server;
const sockets = new Set<import("node:net").Socket>();

beforeEach(async () => {
  server = createServer(() => undefined);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("El servidor de prueba no tiene puerto.");
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
});

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const ID = "11111111-1111-4111-8111-111111111111";
const calls: [string, () => Promise<unknown>][] = [
  ["createAuthUser", () => createAuthUser({ id: ID, email: "a@b.test", appMetadata: {} })],
  ["getAuthUser", () => getAuthUser(ID)],
  ["deleteAuthUser", () => deleteAuthUser(ID)],
  ["magicLinkToken", () => magicLinkToken("a@b.test")],
  ["exchangeMagicLink", () => exchangeMagicLink("hash")],
];

describe("every call to Auth is cut at 5 seconds", () => {
  it("each one gives up and says unavailable (all at once, so the wait is one cut)", async () => {
    const started = Date.now();
    const failures = await Promise.all(calls.map(([, call]) => call().catch((thrown: unknown) => thrown)));
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(AuthAdminError);
      expect(failure).toMatchObject({ kind: "unavailable" });
    }
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_500);
    expect(Date.now() - started).toBeLessThan(9_000);
  }, 15_000);
});

describe("AuthAdminError", () => {
  it("carries a kind and a fixed text: nothing of what was sent", () => {
    const error = new AuthAdminError("exists");
    expect(error.kind).toBe("exists");
    expect(error.message).toBe("Falló una llamada a Supabase Auth.");
  });
});
