import { after } from "next/server";
import { admit, json } from "@/lib/server/gate/handlers";
import { runJob } from "@/lib/server/gate/work";

export const maxDuration = 60;

// Form A: answer 202 right away and work inside after().
export async function POST(request: Request) {
  const req = admit(request, "after");
  if (req instanceof Response) return req;
  after(async () => {
    await runJob(req);
  });
  return json({ id: req.id }, 202);
}
