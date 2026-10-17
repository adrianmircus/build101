import type { VoiceCommandResponse } from "@/lib/contract";
import { matchCommand, type VoiceCommand } from "./commands";

// Same switch as lib/solve/transcribe.ts: with the mock, only the fixed phrases work.
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

// The fixed phrases first, instantly; if none matches, the AI picks among the commands on screen.
// reply is what to show the student when there's no command (or the AI's confirmation).
export async function interpret(heard: string, commands: VoiceCommand[]): Promise<{ command: VoiceCommand | null; reply?: string }> {
  const local = matchCommand(heard, commands);
  if (local || USE_MOCK) return { command: local };
  try {
    const response = await fetch("/api/voice/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heard, commands: commands.map(({ id, label }) => ({ id, label })) }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) return { command: null, reply: body?.error };
    const { commandId, reply } = body as VoiceCommandResponse;
    // Only a command that's on screen right now.
    return { command: commands.find((c) => c.id === commandId) ?? null, reply };
  } catch {
    return { command: null, reply: "Se cortó la conexión. Probá de nuevo." };
  }
}
