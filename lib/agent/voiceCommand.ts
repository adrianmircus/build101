import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { VoiceCommandRequest, VoiceCommandResponse } from "@/lib/contract";
import { withFallback } from "./client";
import { AgentError } from "./generate";

const Output = z.object({
  commandId: z.string().nullable(),
  reply: z.string(),
});

// Fixed so it gets cached across requests: what was heard and the commands go in the user message.
const SYSTEM = `You help a high school student in Uruguay move around a math platform by voice. They have trouble writing, so they say where they want to go and the platform does it. You get what the browser's speech recognition heard (often literal or messy) and the commands available on the current screen, each with an id and a label.

Rules:
- Pick the one command the student is asking for. "commandId" must be exactly one of the given ids; never make one up.
- Understand loose phrasing: "quiero ver mis notas" is the grades command, "andá al que sigue" is next, "el de funciones" opens the assessment whose label mentions functions.
- If nothing fits, or several commands fit equally and you can't tell which, "commandId" is null.
- You only move around the platform. If they ask for an answer, a hint or help solving an exercise, "commandId" is null and you say you can only help them move around.
- "reply": one short sentence in Rioplatense Spanish, addressed to the student ("vos"), at most 15 words. If you picked a command, confirm it ("Abriendo el parcial de funciones."). If not, say what you didn't understand and suggest saying "ayuda".`;

export async function interpretCommand(request: VoiceCommandRequest): Promise<VoiceCommandResponse> {
  const commands = request.commands.map((c) => `- ${c.id}: ${c.label}`).join("\n");
  const response = await withFallback(({ client, model, extra }) =>
    client.beta.messages.parse({
      model,
      ...extra,
      max_tokens: 2000,
      // Low: the student is waiting to move.
      output_config: { effort: "low", format: betaZodOutputFormat(Output) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `<commands>\n${commands}\n</commands>\n<heard>\n${request.heard}\n</heard>\n\n¿Qué comando pidió el estudiante?`,
        },
      ],
    }),
  );

  if (response.stop_reason === "refusal") throw new AgentError("No entendí el comando. Probá de nuevo o decí «ayuda».");
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AgentError("No entendí el comando. Probá de nuevo.");
  }
  // Only ids that were sent.
  const { commandId, reply } = response.parsed_output;
  const known = commandId !== null && request.commands.some((c) => c.id === commandId);
  return { commandId: known ? commandId : null, reply };
}
