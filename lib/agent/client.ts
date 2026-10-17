import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Con OPENROUTER_API_KEY en .env.local, todo pasa por el endpoint de OpenRouter compatible con la API de Anthropic.
// Usamos variables propias para que no las pisen ANTHROPIC_* heredadas del entorno.
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

export const MODEL = OPENROUTER_KEY
  ? process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5.5"
  : "claude-opus-5-5";

let client: Anthropic | null = null;

// Created on the first request, so the build doesn't need ANTHROPIC_API_KEY.
export function getClient(): Anthropic {
  return (client ??= OPENROUTER_KEY
    ? new Anthropic({ baseURL: "https://openrouter.ai/api", authToken: OPENROUTER_KEY, apiKey: null })
    : new Anthropic());
}
