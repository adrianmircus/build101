import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Change, GenerationRequest, GenerationResponse } from "@/lib/contract";
import { profileLabel, sortProfiles } from "@/lib/profiles";
import { getClient, MODEL } from "./client";
import { loadProfile, type ProfileData } from "./profiles";
import { buildMessage, SYSTEM } from "./prompt";

const Output = z.object({
  content: z.string(),
  changes: z.array(z.object({ what: z.string(), why: z.string() })),
});

// Error with a message that can be shown as-is in the UI.
export class AgentError extends Error {}

export async function generateVersion(request: GenerationRequest): Promise<GenerationResponse> {
  const profiles = sortProfiles(request.profiles);
  const loaded = await Promise.all(profiles.map(loadProfile));
  const withData = loaded.filter((p): p is ProfileData => p?.hasData === true);

  // Profiles without data are not adapted: the code decides it, not the model, so we don't invent pedagogy.
  const notices: Change[] = profiles
    .filter((id) => !withData.some((p) => p.id === id))
    .map((id) => ({
      what: `Sin adaptaciones para ${profileLabel(id)}`,
      why: `Todavía no hay datos cargados para ${profileLabel(id)}, así que no se aplicaron adaptaciones para ese perfil.`,
    }));

  if (withData.length === 0) {
    return { profiles, content: request.original, changes: notices };
  }

  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
    system: SYSTEM,
    messages: [{ role: "user", content: buildMessage(request, withData) }],
  });

  if (response.stop_reason === "refusal") {
    throw new AgentError("La IA no pudo adaptar este práctico. Probá reformular el enunciado o generalo de nuevo.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AgentError("La respuesta de la IA llegó incompleta. Probá generar de nuevo.");
  }

  const { content, changes } = response.parsed_output;
  return { profiles, content, changes: [...changes, ...notices] };
}
