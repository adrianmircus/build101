import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

// Backup while Anthropic's API isn't available (for example, out of credit): the same model through OpenRouter,
// which accepts Anthropic's Messages format. Only used if OPEN_ROUTER_ANTHROPIC_KEY is set.
const OPEN_ROUTER_MODEL = "anthropic/claude-opus-5.5";

let client: Anthropic | null = null;
let openRouter: Anthropic | null = null;

// Created on the first request, so the build doesn't need ANTHROPIC_API_KEY.
export function getClient(): Anthropic {
  return (client ??= new Anthropic());
}

function getOpenRouter(): Anthropic | null {
  const key = process.env.OPEN_ROUTER_ANTHROPIC_KEY;
  if (!key) return null;
  return (openRouter ??= new Anthropic({ baseURL: "https://openrouter.ai/api", apiKey: null, authToken: key }));
}

export type Api = {
  client: Anthropic;
  model: string;
  // Only for Anthropic's API: OpenRouter rejects the refusal-fallback beta.
  extra: { betas?: string[]; fallbacks?: "default" };
  // false through OpenRouter: files uploaded to Anthropic's Files API (file_id) aren't visible there.
  files: boolean;
};

const DIRECT_EXTRA: Api["extra"] = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

// Calls the AI through Anthropic's API and, if that fails, retries once through OpenRouter.
// A 404 isn't retried: it's a missing file, and changing provider doesn't fix it.
export async function withFallback<T>(call: (api: Api) => Promise<T>): Promise<T> {
  const backup = getOpenRouter();
  // No Anthropic key at all: the SDK would fail with a plain Error on the request, so go straight to OpenRouter.
  if (backup && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return call({ client: backup, model: OPEN_ROUTER_MODEL, extra: {}, files: false });
  }
  try {
    return await call({ client: getClient(), model: MODEL, extra: DIRECT_EXTRA, files: true });
  } catch (e) {
    const retryable =
      (e instanceof Anthropic.APIError && !(e instanceof Anthropic.NotFoundError)) || e instanceof Anthropic.APIConnectionError;
    if (!backup || !retryable) throw e;
    console.warn(`Anthropic falló (${e.status ?? "sin conexión"}: ${e.message.slice(0, 120)}); reintento por OpenRouter.`);
    return call({ client: backup, model: OPEN_ROUTER_MODEL, extra: {}, files: false });
  }
}
