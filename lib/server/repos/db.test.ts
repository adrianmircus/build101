import { expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ created: 0, value: { rpc: vi.fn() } }));
vi.mock("../db/client", () => ({
  createSessionClient: async () => {
    client.created += 1;
    return client.value;
  },
}));

import { sessionDb } from "./db";

it("sessionDb crea el cliente de sesión del pedido, uno por llamada", async () => {
  expect(await sessionDb()).toBe(client.value);
  await sessionDb();
  expect(client.created).toBe(2);
});
