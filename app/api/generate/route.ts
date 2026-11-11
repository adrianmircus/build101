import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AgentError, generateVersion } from "@/lib/agent/generate";
import { PROFILES } from "@/lib/profiles";
import { isSupport } from "@/lib/supports";
import { cutShort, deadline } from "@/lib/agent/client";
import { isRejectReason, REJECT_REASONS } from "@/lib/feedback/reasons";

// Validates GenerationRequest (lib/contract.ts) before spending an AI call.
const RequestBody = z.object({
  type: z.enum(["worksheet", "exam"]),
  topic: z.string().trim().min(1).max(300),
  original: z.string().trim().min(1).max(50_000),
  profiles: z.array(z.string().refine((id) => PROFILES.some((p) => p.id === id))).max(10),
  interests: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
  supports: z.array(z.string().refine(isSupport)).max(4).optional(),
  keep: z.array(z.number().int().min(1).max(99)).max(60).optional(),
  syllabus: z
    .object({
      subject: z.string().max(200),
      course: z.string().max(200),
      units: z.array(z.object({ title: z.string().max(300), contents: z.string().max(20_000) })).max(50),
      pdfFileId: z.string().max(200).optional(),
    })
    .optional(),
  retry: z
    .object({
      reasons: z.array(z.string().refine(isRejectReason)).min(1).max(REJECT_REASONS.length),
      previous: z.string().max(50_000),
    })
    .optional(),
});

// The AI call has 280 s (deadline below); the rest is margin to answer.
export const maxDuration = 300;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = RequestBody.safeParse(body);
  if (!parsed.success) {
    return error("El pedido no es válido: revisá el tema, los ejercicios y los perfiles.", 400);
  }

  // On Netlify, the edge (where proxy.ts runs) cuts a response that hasn't started within 40 s, and a long worksheet
  // takes longer. So the 200 goes out right away, a space every few seconds keeps it alive (JSON allows leading
  // whitespace) and the result comes at the end. Errors come in the body as { error }.
  const signal = deadline(request, 280);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(" "));
      const keepAlive = setInterval(() => controller.enqueue(encoder.encode(" ")), 5_000);
      const result = await generateVersion(parsed.data, signal).catch((e: unknown) => ({ error: errorMessage(e, signal) }));
      clearInterval(keepAlive);
      controller.enqueue(encoder.encode(JSON.stringify(result)));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function errorMessage(e: unknown, signal: AbortSignal): string {
  const cut = cutShort(e, signal);
  if (cut) return cut.message;
  if (e instanceof AgentError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "Falta configurar la API key de la IA.";
  if (e instanceof Anthropic.RateLimitError) return "La IA está saturada. Esperá unos segundos y reintentá.";
  if (e instanceof Anthropic.NotFoundError) return "No encontramos el PDF del temario. Volvé a subirlo en Mi materia.";
  if (e instanceof Anthropic.APIError) return `La IA respondió con un error (${e.status}). Reintentá.`;
  console.error(e);
  return "No pudimos generar esta versión. Reintentá.";
}
