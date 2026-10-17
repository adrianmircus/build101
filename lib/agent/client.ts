import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Con OPENROUTER_API_KEY en .env.local, todo pasa por el endpoint de OpenRouter compatible con la API de Anthropic.
// Usamos variables propias para que no las pisen ANTHROPIC_* heredadas del entorno.
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

export const MODEL = OPENROUTER_KEY
  ? process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5.5"
  : "claude-opus-5-5";

// Modelo rápido para las tareas largas y acotadas (adaptar un práctico ya leído, plantear un problema): escribe varias
// veces más rápido que Opus y cuesta la mitad. Lo que importa (que la matemática no cambie) lo controla el verificador.
export const FAST_MODEL = OPENROUTER_KEY
  ? process.env.OPENROUTER_FAST_MODEL || "anthropic/claude-sonnet-5.5"
  : "claude-sonnet-5-5";

// Respaldo de modelo del lado del servidor: solo existe en la API de Anthropic. OpenRouter rechaza el campo
// `fallbacks` con un 400, así que por OpenRouter no se manda.
export const FALLBACK = OPENROUTER_KEY
  ? {}
  : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

let client: Anthropic | null = null;

// Created on the first request, so the build doesn't need ANTHROPIC_API_KEY.
export function getClient(): Anthropic {
  return (client ??= OPENROUTER_KEY
    ? new Anthropic({ baseURL: "https://openrouter.ai/api", authToken: OPENROUTER_KEY, apiKey: null })
    : new Anthropic());
}
