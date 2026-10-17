import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Two ways to reach the model, both with Anthropic's Messages format:
// - Anthropic's API, with ANTHROPIC_API_KEY.
// - OpenRouter, with OPENROUTER_API_KEY (or OPEN_ROUTER_ANTHROPIC_KEY, the older name). OPENROUTER_MODEL picks the model.
// With both keys Anthropic goes first and OpenRouter is the backup (withFallback). With only OpenRouter's, everything
// goes through it. Our own variable names, so ANTHROPIC_* inherited from the environment don't override them.
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_ANTHROPIC_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5.5";
const ANTHROPIC_MODEL = "claude-opus-5-5";
const HAS_ANTHROPIC = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const ONLY_OPENROUTER = Boolean(OPENROUTER_KEY) && !HAS_ANTHROPIC;

export const MODEL = ONLY_OPENROUTER ? OPENROUTER_MODEL : ANTHROPIC_MODEL;

// Server-side refusal fallback: it only exists on Anthropic's API. OpenRouter rejects the `fallbacks` field with a 400.
const DIRECT_EXTRA = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
export const FALLBACK: { betas?: string[]; fallbacks?: "default" } = ONLY_OPENROUTER ? {} : DIRECT_EXTRA;

let anthropic: Anthropic | null = null;
let openRouter: Anthropic | null = null;

function getAnthropic(): Anthropic {
  return (anthropic ??= new Anthropic());
}

function getOpenRouter(): Anthropic | null {
  if (!OPENROUTER_KEY) return null;
  return (openRouter ??= new Anthropic({ baseURL: "https://openrouter.ai/api", authToken: OPENROUTER_KEY, apiKey: null }));
}

// The main provider, for calls that don't need the backup. Created on the first request, so the build doesn't
// need any key.
export function getClient(): Anthropic {
  return ONLY_OPENROUTER ? getOpenRouter()! : getAnthropic();
}

export type Api = {
  client: Anthropic;
  model: string;
  // Only for Anthropic's API: OpenRouter rejects the refusal-fallback beta.
  extra: { betas?: string[]; fallbacks?: "default" };
  // false through OpenRouter: files uploaded to Anthropic's Files API (file_id) aren't visible there.
  files: boolean;
};

// Calls the AI through Anthropic's API and, if that fails, retries once through OpenRouter.
// A 404 isn't retried: it's a missing file, and changing provider doesn't fix it.
export async function withFallback<T>(call: (api: Api) => Promise<T>): Promise<T> {
  const backup = getOpenRouter();
  const viaOpenRouter: Api | null = backup && { client: backup, model: OPENROUTER_MODEL, extra: {}, files: false };
  if (ONLY_OPENROUTER) return call(viaOpenRouter!);
  try {
    return await call({ client: getAnthropic(), model: ANTHROPIC_MODEL, extra: DIRECT_EXTRA, files: true });
  } catch (e) {
    const retryable =
      (e instanceof Anthropic.APIError && !(e instanceof Anthropic.NotFoundError)) || e instanceof Anthropic.APIConnectionError;
    if (!viaOpenRouter || !retryable) throw e;
    console.warn(`Anthropic falló (${e.status ?? "sin conexión"}: ${e.message.slice(0, 120)}); reintento por OpenRouter.`);
    return call(viaOpenRouter);
  }
}
