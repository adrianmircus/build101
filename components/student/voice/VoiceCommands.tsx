"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, startTransition, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { primaryButton, secondaryButton } from "@/components/ui/styles";
import { logout } from "@/lib/auth/actions";
import { useDictation } from "@/lib/speech/useDictation";
import type { VoiceCommand } from "@/lib/voice/commands";
import { interpret } from "@/lib/voice/interpret";

type Registry = { set: (key: symbol, commands: VoiceCommand[]) => void; remove: (key: symbol) => void };

const VoiceContext = createContext<Registry | null>(null);

// Each screen adds the commands that make sense on it while it's mounted. Outside the voice area it does nothing.
export function useVoiceCommands(commands: VoiceCommand[]) {
  const registry = useContext(VoiceContext);
  const key = useRef<symbol | null>(null);
  // The commands' run closures change on every render: the latest ones are always the registered ones.
  useEffect(() => {
    key.current ??= Symbol();
    registry?.set(key.current, commands);
  });
  useEffect(() => {
    const k = (key.current ??= Symbol());
    return () => registry?.remove(k);
  }, [registry]);
}

type Status = { heard?: string; reply: string; tone: "info" | "ok" | "error" };

// The student taps the button, says where to go and the platform takes them there. Only for students who
// navigate by voice; the commands live in a registry, not in state, so registering never re-renders.
export function VoiceCommands({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const screens = useRef(new Map<symbol, VoiceCommand[]>());
  const [registry] = useState<Registry>(() => ({
    set: (key, commands) => screens.current.set(key, commands),
    remove: (key) => screens.current.delete(key),
  }));
  const [status, setStatus] = useState<Status | null>(null);
  const [help, setHelp] = useState<VoiceCommand[] | null>(null);

  const goToGrades = () => {
    if (pathname === "/estudiante") {
      const heading = document.getElementById("calificaciones");
      heading?.scrollIntoView({ behavior: "smooth", block: "start" });
      heading?.focus({ preventScroll: true });
    } else {
      router.push("/estudiante#calificaciones");
    }
  };

  const global: VoiceCommand[] = [
    { id: "home", label: "Inicio: tus prácticos", phrases: ["inicio", "mis practicos", "mis parciales", "volver al inicio", "volver a mis practicos"], run: () => router.push("/estudiante") },
    { id: "grades", label: "Calificaciones", phrases: ["calificaciones", "mis notas", "notas", "mis calificaciones"], run: goToGrades },
    { id: "help", label: "Ayuda: qué puedo decir", phrases: ["ayuda", "que puedo decir", "comandos"], run: () => setHelp(all()) },
    { id: "logout", label: "Salir", phrases: ["salir", "cerrar sesion"], run: () => startTransition(() => void logout()) },
  ];

  function all(): VoiceCommand[] {
    return [...[...screens.current.values()].flat(), ...global];
  }

  async function handle(heard: string) {
    if (!heard.trim()) return setStatus({ reply: "No escuché nada. Tocá el botón y decí a dónde querés ir.", tone: "error" });
    setStatus({ heard, reply: "Buscando…", tone: "info" });
    const commands = all();
    const { command, reply } = await interpret(heard, commands);
    if (!command) {
      return setStatus({ heard, reply: reply ?? "No entendí. Decí «ayuda» para ver qué podés decir.", tone: "error" });
    }
    setStatus({ heard, reply: reply ?? `${command.label}.`, tone: "ok" });
    if (command.id !== "help") setHelp(null);
    command.run();
  }

  const listener = useDictation({ continuous: false, onEnd: (heard) => void handle(heard) });

  return (
    <VoiceContext.Provider value={registry}>
      {children}
      {listener.supported && (
        <>
          {/* Room at the end of the page so the bar never covers content. */}
          <div aria-hidden="true" className="h-40" />
          <section
            aria-label="Comandos de voz"
            className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-slate-200 bg-white/95 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur"
          >
            <div className="mx-auto w-full max-w-4xl px-4 py-3">
              {help && (
                <div className="mb-3 max-h-64 overflow-y-auto rounded-2xl border-2 border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-lg font-bold">Podés decir</h2>
                    <button type="button" className={`${secondaryButton} min-h-11 py-1`} onClick={() => setHelp(null)}>
                      Cerrar
                    </button>
                  </div>
                  <ul className="mt-2 grid gap-x-6 gap-y-1 text-lg sm:grid-cols-2">
                    {help.map((c) => (
                      <li key={c.id}>«{c.label}»</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={
                    listener.listening
                      ? "inline-flex min-h-14 items-center justify-center gap-3 rounded-xl bg-red-700 px-6 py-3 text-xl font-bold text-white hover:bg-red-800"
                      : `${primaryButton} min-h-14 px-6 text-xl`
                  }
                  onClick={listener.listening ? listener.stop : listener.start}
                >
                  {listener.listening ? (
                    <>
                      <span aria-hidden="true" className="size-3 rounded-full bg-white motion-safe:animate-pulse" />
                      Te escucho…
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">🎤</span>
                      Decí a dónde ir
                    </>
                  )}
                </button>
                <p
                  aria-live="polite"
                  className={`min-w-0 flex-1 text-lg ${
                    status?.tone === "error" ? "text-red-800" : status?.tone === "ok" ? "text-emerald-800" : "text-slate-700"
                  }`}
                >
                  {listener.error ? (
                    <span className="font-semibold text-red-800">{listener.error}</span>
                  ) : status ? (
                    <>
                      {status.heard && <span className="block text-base text-slate-600">Escuché: «{status.heard}»</span>}
                      <span className="font-semibold">{status.reply}</span>
                    </>
                  ) : (
                    "Por ejemplo: «calificaciones», «abrir funciones», «ejercicio 2», «siguiente»."
                  )}
                </p>
                <button
                  type="button"
                  aria-expanded={help !== null}
                  className={`${secondaryButton} min-h-11`}
                  onClick={() => setHelp(help ? null : all())}
                >
                  ¿Qué puedo decir?
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </VoiceContext.Provider>
  );
}
