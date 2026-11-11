import "server-only";

export type GateForm = "after" | "stream";
export type GateCaller = "server" | "browser";
export type GateStoreKind = "blobs" | "memory";

/** What the worker writes at the very end of a simulated job. All times are ISO strings. */
export interface GateRecord {
  id: string;
  form: GateForm;
  caller: GateCaller;
  seconds: number;
  cold: boolean;
  receivedAt: string;
  workStartedAt: string;
  workEndedAt: string;
  writtenAt: string;
  store: GateStoreKind;
}
