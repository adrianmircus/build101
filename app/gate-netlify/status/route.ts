import { hasValidToken } from "@/lib/server/gate/params";
import { json, notFound } from "@/lib/server/gate/handlers";
import { readRecord, storeKind } from "@/lib/server/gate/store";
import { z } from "zod";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!hasValidToken(request.headers.get("x-gate-token"))) return notFound();
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return json({ error: "Falta un id válido (uuid)." }, 400);
  const record = await readRecord(id.data);
  return json({ found: record !== null, store: record?.store ?? storeKind(), record });
}
