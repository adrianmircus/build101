import "server-only";
import { getStore } from "@netlify/blobs";
import type { GateRecord, GateStoreKind } from "./types";

const memory: Map<string, GateRecord> =
  ((globalThis as Record<string, unknown>).__gateMemory as Map<string, GateRecord> | undefined) ??
  new Map();
(globalThis as Record<string, unknown>).__gateMemory = memory;

type BlobStore = ReturnType<typeof getStore>;

/** Netlify Blobs when the environment provides it; null locally without `netlify dev`. */
function openBlobs(): BlobStore | null {
  try {
    return getStore("gate");
  } catch {
    return null;
  }
}

export function storeKind(): GateStoreKind {
  return openBlobs() ? "blobs" : "memory";
}

export async function saveRecord(record: Omit<GateRecord, "writtenAt" | "store">): Promise<GateRecord> {
  const blobs = openBlobs();
  const full: GateRecord = {
    ...record,
    writtenAt: new Date().toISOString(),
    store: blobs ? "blobs" : "memory",
  };
  if (blobs) await blobs.setJSON(record.id, full);
  else memory.set(record.id, full);
  return full;
}

export async function readRecord(id: string): Promise<GateRecord | null> {
  const blobs = openBlobs();
  if (blobs) return ((await blobs.get(id, { type: "json" })) as GateRecord | null) ?? null;
  return memory.get(id) ?? null;
}
