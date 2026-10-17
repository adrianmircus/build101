import "server-only";
import { AnthropicError, APIError } from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Change, GenerationRequest, GenerationResponse, Question } from "@/lib/contract";
import { GAZE_PROFILE, profileLabel, sortProfiles, usesGaze, usesVoice, VOICE_PROFILE } from "@/lib/profiles";
import { type Api, withFallback } from "./client";
import { describeGraph } from "@/lib/graphText";
import { GraphSchema, toGraph } from "./graph";
import { loadProfile, type ProfileData } from "./profiles";
import { buildMessage, GAZE_QUESTIONS, SYSTEM } from "./prompt";

const Output = z.object({
  content: z.string(),
  changes: z.array(z.object({ what: z.string(), why: z.string() })),
});

// The API doesn't support min/max on arrays: the SDK removes them from the schema and checks them on parse.
// Without "content": the platform writes it from the questions, so the model doesn't write everything twice.
const GazeOutput = z.object({
  changes: Output.shape.changes,
  questions: z.array(
    z.object({
      exercise: z.number().int(),
      stem: z.string(),
      options: z
        .array(z.object({ id: z.enum(["A", "B"]), text: z.string(), graph: GraphSchema.nullable() }))
        .min(2)
        .max(2),
      answer: z.enum(["A", "B"]),
    }),
  ),
});

// Two different options per question and the key among them: the student picks the left or the right half.
function validQuestions(questions: Question[]): boolean {
  return (
    questions.length > 0 &&
    questions.every((q) => {
      const ids = q.options.map((o) => o.id);
      return ids.length === 2 && new Set(ids).size === 2 && ids.includes(q.answer);
    })
  );
}

// The multiple choice version as text, for the teacher to read: each question with its options, graphs in words.
function questionsText(questions: Question[]): string {
  return questions
    .map((q, i) => {
      const options = q.options
        .map((o) => `- **${o.id})** ${o.text}${o.graph ? ` (${describeGraph(o.graph)})` : ""}`)
        .join("\n");
      return `**Pregunta ${i + 1}** (ejercicio ${q.exercise})\n\n${q.stem}\n\n${options}`;
    })
    .join("\n\n");
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
  // Same for answering by voice: whatever asks to draw has to be said instead.
  const voice = usesVoice(profiles);

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
  if (withData.length === 0 && !request.interests?.length && !gaze && !voice) {
    return { profiles, content: request.original, changes: notices };
  }

  const blocks = buildMessage(request, withData, { gaze, voice });
  const params = (api: Api) => ({
    model: api.model,
    ...api.extra,
    max_tokens: 16000,
    system: SYSTEM,
    // Without the Files API (through OpenRouter) the syllabus PDF can't go; its units still go as text.
    messages: [
      {
        role: "user" as const,
        content: api.files ? blocks : blocks.filter((b) => !(b.type === "document" && b.source.type === "file")),
      },
    ],
  });

  if (gaze) {
    // Streaming: rewriting a whole assessment as multiple choice can go past what the SDK allows without it.
    const response = await parseOrFail(() =>
      withFallback((api) =>
        api.client.beta.messages
          .stream({
            ...params(api),
            max_tokens: 64000,
            output_config: { effort: "medium", format: betaZodOutputFormat(GazeOutput) },
          })
          .finalMessage(),
      ),
    );
    checkStop(response.stop_reason);
    if (!response.parsed_output) throw new AgentError(INCOMPLETE);
    const { changes } = response.parsed_output;
    // If it wrote more than asked, the first ones stay: failing would mean generating again, slower.
    const questions: Question[] = response.parsed_output.questions.slice(0, GAZE_QUESTIONS).map((q) => ({
      ...q,
      options: q.options.map(({ graph, ...o }) => ({ ...o, ...(toGraph(graph) ? { graph: toGraph(graph) } : {}) })),
    }));
    if (!validQuestions(questions)) {
      throw new AgentError("La IA armó mal las opciones. Probá generar de nuevo.");
    }
    return { profiles, content: questionsText(questions), changes: [...changes, ...notices], questions };
  }

  const response = await parseOrFail(() =>
    withFallback((api) =>
      api.client.beta.messages.parse({
        ...params(api),
        output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
      }),
    ),
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
