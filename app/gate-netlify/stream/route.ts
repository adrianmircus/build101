import { admit } from "@/lib/server/gate/handlers";
import { gateStream } from "@/lib/server/gate/stream";

export const maxDuration = 60;

// Form B: answer 200 with a stream (a space every 5 s, the result as a JSON line at the end).
export async function POST(request: Request) {
  const req = admit(request, "stream");
  if (req instanceof Response) return req;
  return new Response(gateStream(req), {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
