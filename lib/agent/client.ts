import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

let client: Anthropic | null = null;

// Created on the first request, so the build doesn't need ANTHROPIC_API_KEY.
export function getClient(): Anthropic {
  return (client ??= new Anthropic());
}
