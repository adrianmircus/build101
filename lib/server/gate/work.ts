import "server-only";
import { saveRecord } from "./store";
import type { GateForm, GateRecord } from "./types";
import type { GateParams } from "./params";

// Module variable: true until this instance serves its first request.
let cold = true;

/** Returns whether the instance was cold for this request, and marks it warm. */
export function takeCold(): boolean {
  const was = cold;
  cold = false;
  return was;
}

/** Test helper. */
export function resetCold(): void {
  cold = true;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface GateRequest extends GateParams {
  form: GateForm;
  receivedAt: string;
  cold: boolean;
}

export function newRequest(form: GateForm, params: GateParams): GateRequest {
  return { ...params, form, receivedAt: new Date().toISOString(), cold: takeCold() };
}

/**
 * Simulates a long job: waits `seconds` (calling `onTick` every `tickMs`), then writes the
 * result. The write is the thing the gate measures.
 */
export async function runJob(
  req: GateRequest,
  opts: { tickMs?: number; onTick?: () => void } = {},
): Promise<GateRecord> {
  const { tickMs = 5000, onTick } = opts;
  const total = req.seconds * 1000;
  const workStartedAt = new Date().toISOString();
  const start = Date.now();
  while (Date.now() - start < total) {
    await sleep(Math.min(tickMs, Math.max(0, total - (Date.now() - start))));
    if (Date.now() - start < total) onTick?.();
  }
  const workEndedAt = new Date().toISOString();
  return saveRecord({
    id: req.id,
    form: req.form,
    caller: req.caller,
    seconds: req.seconds,
    cold: req.cold,
    receivedAt: req.receivedAt,
    workStartedAt,
    workEndedAt,
  });
}
