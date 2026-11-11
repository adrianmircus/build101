import { beforeEach, describe, expect, it } from "vitest";
import { hasValidToken, parseGateParams } from "./params";
import { readRecord } from "./store";
import { gateStream } from "./stream";
import { newRequest, resetCold, runJob } from "./work";

const uuid = () => crypto.randomUUID();
const params = (seconds: number) => ({ id: uuid(), caller: "server" as const, seconds });

describe("gate token", () => {
  it("rejects when the variable is missing, the header is missing or differs", () => {
    expect(hasValidToken("x", undefined)).toBe(false);
    expect(hasValidToken(null, "x")).toBe(false);
    expect(hasValidToken("y", "x")).toBe(false);
    expect(hasValidToken("x", "x")).toBe(true);
  });
});

describe("gate params", () => {
  const u = (q: string) => new URL(`http://t/x?${q}`);
  it("defaults to 48 seconds and bounds 1..55", () => {
    const base = `id=${uuid()}&caller=server`;
    expect(parseGateParams(u(base)).data?.seconds).toBe(48);
    expect(parseGateParams(u(`${base}&seconds=0`)).success).toBe(false);
    expect(parseGateParams(u(`${base}&seconds=56`)).success).toBe(false);
    expect(parseGateParams(u("id=nope&caller=server")).success).toBe(false);
  });
});

describe("gate work", () => {
  beforeEach(() => resetCold());

  it("is cold only for the first request", () => {
    expect(newRequest("after", params(1)).cold).toBe(true);
    expect(newRequest("after", params(1)).cold).toBe(false);
  });

  it("writes the result to the memory store", async () => {
    const req = newRequest("after", params(0.05));
    const written = await runJob(req);
    const read = await readRecord(req.id);
    expect(read).toEqual(written);
    expect(read?.store).toBe("memory");
    expect(Date.parse(read!.writtenAt)).toBeGreaterThanOrEqual(Date.parse(read!.workEndedAt));
  });

  it("stream emits spaces then a JSON line, and writes even if the client leaves", async () => {
    const req = newRequest("stream", params(0.1));
    const reader = gateStream(req, 20).getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 300));
    expect((await readRecord(req.id))?.form).toBe("stream");

    const req2 = newRequest("stream", params(0.1));
    const text = await new Response(gateStream(req2, 20)).text();
    expect(text.startsWith(" ")).toBe(true);
    expect(JSON.parse(text.trim()).id).toBe(req2.id);
  });
});
