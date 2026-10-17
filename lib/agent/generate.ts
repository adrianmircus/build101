import "server-only";
import { AnthropicError, APIError } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Change, GenerationRequest, GenerationResponse, Question } from "@/lib/contract";
import { GAZE_PROFILE, profileLabel, sortProfiles, usesGaze, VOICE_PROFILE } from "@/lib/profiles";
import { getClient, MODEL } from "./client";
import { loadProfile, type ProfileData } from "./profiles";
import { buildMessage, SYSTEM } from "./prompt";

const Output = z.object({
  content: z.string(),
  changes: z.array(z.object({ what: z.string(), why: z.string() })),
});

// The API doesn't support min/max on arrays: the SDK removes them from the schema and checks them on parse.
const GazeOutput = Output.extend({
  questions: z.array(
    z.object({
      exercise: z.number().int(),
      stem: z.string(),
      options: z.array(z.object({ id: z.enum(["A", "B", "C", "D"]), text: z.string() })).min(2).max(4),
      answer: z.enum(["A", "B", "C", "D"]),
    }),
  ),
});

// One key per question and options that don't repeat: the student picks by quadrant.
function validQuestions(questions: Question[]): boolean {
  return (
    questions.length > 0 &&
    questions.every((q) => {
      const ids = q.options.map((o) => o.id);
      return new Set(ids).size === ids.length && ids.includes(q.answer);
    })
  );
}

// Error with a message that can be shown as-is in the UI.
export class AgentError extends Error {}

export async function generateVersion(request: GenerationRequest): Promise<GenerationResponse> {
  const profiles = sortProfiles(request.profiles);
  const loaded = await Promise.all(profiles.map(loadProfile));
  const withData = loaded.filter((p): p is ProfileData => p?.hasData === true);
  // Multiple choice is a requirement of the channel (the student can't write), not a pedagogical
  // adaptation: the code decides it, even if the profile has no data.
  const gaze = usesGaze(profiles);

  // Profiles without data are not adapted: the code decides it, not the model, so we don't invent pedagogy.
  const notices: Change[] = profiles
    .filter((id) => !withData.some((p) => p.id === id))
    .map((id) =>
      id === GAZE_PROFILE
        ? {
            what: `Sin adaptaciones extra para ${profileLabel(id)}`,
            why: "Se pasó a opción múltiple para responder con la mirada, pero todavía no hay datos cargados para otras adaptaciones de ese perfil.",
          }
        : id === VOICE_PROFILE
          ? {
              what: `Sin adaptaciones extra para ${profileLabel(id)}`,
              why: "El estudiante responde dictando en la plataforma, pero todavía no hay datos cargados para otras adaptaciones de ese perfil.",
            }
          : {
              what: `Sin adaptaciones para ${profileLabel(id)}`,
              why: `Todavía no hay datos cargados para ${profileLabel(id)}, así que no se aplicaron adaptaciones para ese perfil.`,
            },
    );

  // Nothing to adapt and no interests to theme around: the original goes back as-is, without an AI call.
  if (withData.length === 0 && !request.interests?.length && !gaze) {
    return { profiles, content: request.original, changes: notices };
  }

  const params = {
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    system: SYSTEM,
    messages: [{ role: "user" as const, content: buildMessage(request, withData, gaze) }],
  };

  if (gaze) {
    // High effort: it has to solve each exercise to write the key and the wrong options.
    const response = await parseOrFail(() =>
      getClient().beta.messages.parse({
        ...params,
        output_config: { effort: "high", format: betaZodOutputFormat(GazeOutput) },
      }),
    );
    checkStop(response.stop_reason);
    if (!response.parsed_output) throw new AgentError(INCOMPLETE);
    const { content, changes, questions } = response.parsed_output;
    if (!validQuestions(questions)) {
      throw new AgentError("La IA armó mal las opciones. Probá generar de nuevo.");
    }
    return { profiles, content, changes: [...changes, ...notices], questions };
  }

  const response = await parseOrFail(() =>
    getClient().beta.messages.parse({
      ...params,
      output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
    }),
  );

  checkStop(response.stop_reason);
  if (!response.parsed_output) throw new AgentError(INCOMPLETE);

  const { content, changes } = response.parsed_output;
  return { profiles, content, changes: [...changes, ...notices] };
}

const INCOMPLETE = "La respuesta de la IA llegó incompleta. Probá generar de nuevo.";

function checkStop(stopReason: string | null) {
  if (stopReason === "refusal") {
    throw new AgentError("La IA no pudo adaptar este práctico. Probá reformular el enunciado o generalo de nuevo.");
  }
  if (stopReason === "max_tokens") throw new AgentError(INCOMPLETE);
}

// An output that doesn't match the schema (for example, 5 options) is thrown by the SDK as AnthropicError,
// and a cut-off JSON as SyntaxError. API errors (APIError) go up as they are so the route answers with the right status.
async function parseOrFail<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof SyntaxError || (e instanceof AnthropicError && !(e instanceof APIError))) {
      throw new AgentError(INCOMPLETE);
    }
    throw e;
  }
}
