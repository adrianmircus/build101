import "server-only";
import { runJob, type GateRequest } from "./work";

const encoder = new TextEncoder();

/**
 * Body for form B: a space every 5 s, then the result as one JSON line.
 * If the client disconnects, the job keeps going and still writes its result
 * (the write does not depend on the controller).
 */
export function gateStream(req: GateRequest, tickMs = 5000): ReadableStream<Uint8Array> {
  let open = true;
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, text: string) => {
    if (!open) return;
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      open = false;
    }
  };
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // First byte right away so the edge sees a response start well before 40 s.
        send(controller, " ");
        const record = await runJob(req, { tickMs, onTick: () => send(controller, " ") });
        send(controller, JSON.stringify(record) + "\n");
      } finally {
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      open = false;
    },
  });
}
