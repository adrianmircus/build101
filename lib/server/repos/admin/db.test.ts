import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTH_FETCH_TIMEOUT_MS, authAdmin } from "./db";

// A server that accepts the request and never answers: what a stuck Auth looks like.
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
  const { port } = address;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
});

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("authAdmin", () => {
  it("the cut is 5 seconds", () => {
    expect(AUTH_FETCH_TIMEOUT_MS).toBe(5_000);
  });

  it("cuts a request that nobody answers", async () => {
    const started = Date.now();
    const { error } = await authAdmin(150).getUserById("11111111-1111-4111-8111-111111111111");
    expect(error).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("is a client with no session of its own", () => {
    const admin = authAdmin();
    expect(typeof admin.getUserById).toBe("function");
    expect(typeof admin.createUser).toBe("function");
  });
});
