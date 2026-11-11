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

// Fast model for long, bounded tasks (adapting an already-read worksheet): it writes several times faster than Opus
// at half the cost. What matters (the math not changing) is checked by the verifier. Api.fastModel, same provider.
const OPENROUTER_FAST_MODEL = process.env.OPENROUTER_FAST_MODEL || "anthropic/claude-sonnet-5.5";
const ANTHROPIC_FAST_MODEL = "claude-sonnet-5-5";

// Server-side refusal fallback: it only exists on Anthropic's API. OpenRouter rejects the `fallbacks` field with a 400.
const DIRECT_EXTRA = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

let anthropic: Anthropic | null = null;
let openRouter: Anthropic | null = null;

function getAnthropic(): Anthropic {
  return (anthropic ??= new Anthropic());
}

function getOpenRouter(): Anthropic | null {
  if (!OPENROUTER_KEY) return null;
  return (openRouter ??= new Anthropic({ baseURL: "https://openrouter.ai/api", authToken: OPENROUTER_KEY, apiKey: null }));
}

// The main provider, for calls that don't go through withFallback (the Files API upload).
// Created on the first request, so the build doesn't need any key.
export function getClient(): Anthropic {
  return ONLY_OPENROUTER ? getOpenRouter()! : getAnthropic();
}

export type Api = {
  client: Anthropic;
  model: string;
  // The fast model on this same provider.
  fastModel: string;
  // Only for Anthropic's API: OpenRouter rejects the refusal-fallback beta.
  extra: { betas?: string[]; fallbacks?: "default" };
  // false through OpenRouter: files uploaded to Anthropic's Files API (file_id) aren't visible there.
  files: boolean;
  // Goes in each call's request options: it cuts the call, and the SDK's own retries, when it fires.
  signal?: AbortSignal;
};

export type CallOptions = {
  // Which route spent the tokens, in the usage log.
  route: string;
  // From deadline(): the user left or the route ran out of time.
  signal?: AbortSignal;
  // false when the call needs Anthropic's Files API, which OpenRouter can't see.
  fallback?: boolean;
};

// What every call returns (a message): enough for the usage log.
type Result = {
  stop_reason?: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
};

// Calls the AI through Anthropic's API and, if that fails in a way the other provider can fix, retries once through
// OpenRouter. Every attempt leaves one line in the log with its tokens, never its content.
export async function withFallback<T extends Result>(
  call: (api: Api) => Promise<T>,
  { route, signal, fallback = true }: CallOptions,
): Promise<T> {
  const openRouter = getOpenRouter();
  const viaOpenRouter: Api | null = openRouter && {
    client: openRouter,
    model: OPENROUTER_MODEL,
    fastModel: OPENROUTER_FAST_MODEL,
    extra: {},
    files: false,
    signal,
  };
  if (ONLY_OPENROUTER) return logged(route, "openrouter", () => call(viaOpenRouter!));
  try {
    const direct: Api = {
      client: getAnthropic(),
      model: ANTHROPIC_MODEL,
      fastModel: ANTHROPIC_FAST_MODEL,
      extra: DIRECT_EXTRA,
      files: true,
      signal,
    };
    return await logged(route, "anthropic", () => call(direct));
  } catch (e) {
    if (!fallback || !viaOpenRouter || !otherProviderMayWork(e, signal)) throw e;
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    console.warn(`Anthropic falló (${status ?? "sin conexión"}); reintento por OpenRouter.`);
    return logged(route, "openrouter", () => call(viaOpenRouter));
  }
}

// Auth, billing, rate limits (once the SDK used up its own retries), server errors and lost connections can work
// through the other provider. A malformed request (400, 404, 413, 422) would fail there too, and a cut call stays cut.
function otherProviderMayWork(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || e instanceof Anthropic.APIUserAbortError) return false;
  if (e instanceof Anthropic.APIConnectionError) return true;
  if (!(e instanceof Anthropic.APIError) || e.status === undefined) return false;
  return [401, 402, 403, 429].includes(e.status) || e.status >= 500;
}

async function logged<T extends Result>(route: string, provider: string, call: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await call();
    const u = result.usage;
    console.info(
      JSON.stringify({
        ai: route,
        provider,
        ms: Date.now() - start,
        stop: result.stop_reason ?? null,
        in: u?.input_tokens ?? null,
        out: u?.output_tokens ?? null,
        cacheWrite: u?.cache_creation_input_tokens ?? 0,
        cacheRead: u?.cache_read_input_tokens ?? 0,
      }),
    );
    return result;
  } catch (e) {
    const error = e instanceof Anthropic.APIUserAbortError ? "aborted" : e instanceof Anthropic.APIError ? (e.status ?? "connection") : "other";
    console.info(JSON.stringify({ ai: route, provider, ms: Date.now() - start, error }));
    throw e;
  }
}

// The signal a route gives the AI: it fires when the user closes the page or after `seconds`, whichever comes first.
// Keep `seconds` under the route's maxDuration so the platform never kills a call halfway through a paid retry.
export function deadline(request: Request, seconds: number): AbortSignal {
  return AbortSignal.any([request.signal, AbortSignal.timeout(seconds * 1000)]);
}

// For a call that deadline() cut: the message for the route to answer, or null if it was another error.
export function cutShort(e: unknown, signal: AbortSignal): { message: string; status: number } | null {
  if (!(e instanceof Anthropic.APIUserAbortError) && !signal.aborted) return null;
  return signal.reason instanceof DOMException && signal.reason.name === "TimeoutError"
    ? { message: "La IA tardó demasiado en responder. Probá de nuevo.", status: 504 }
    : { message: "Se canceló el pedido.", status: 499 };
}
