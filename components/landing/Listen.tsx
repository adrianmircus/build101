"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { browserSpeak, type Playback } from "@/lib/speech/voice";

const noop = () => () => {};

// "Así suena un práctico". With the recorded audio (scripts/landing-audio.ts) it's the browser's own player.
// Without it, the system's Spanish voice reads the same words, as the app does when ElevenLabs isn't set up.
// Never plays by itself. The words read are always shown next to it.
export function Listen({ text, src }: { text: string; src?: string }) {
  const speechSupported = useSyncExternalStore(noop, () => "speechSynthesis" in window, () => false);
  const [playing, setPlaying] = useState(false);
  const playback = useRef<Playback | null>(null);
  useEffect(() => () => playback.current?.stop(), []);

  return (
    <div>
      {src ? (
        // The transcript right below stands in for captions.
        <audio controls preload="none" src={src} className="w-full max-w-md" />
      ) : (
        speechSupported && (
          <button
            type="button"
            aria-pressed={playing}
            onClick={() => {
              if (playing) {
                playback.current?.stop();
                setPlaying(false);
                return;
              }
              setPlaying(true);
              playback.current = browserSpeak(text, () => setPlaying(false));
            }}
            className="focus-on-dark inline-flex min-h-11 items-center gap-3 rounded-xl bg-amber-300 px-6 py-3 text-lg font-semibold text-indigo-950 transition-colors duration-300 ease-soft hover:bg-amber-200 active:translate-y-px"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-indigo-950">
              {playing ? <rect x="6" y="6" width="12" height="12" rx="2" /> : <path d="M8 5.5v13l11-6.5z" />}
            </svg>
            {playing ? "Parar" : "Escuchá el práctico"}
          </button>
        )
      )}
      <p className="mt-8 max-w-3xl text-lg text-indigo-100">{text}</p>
    </div>
  );
}
