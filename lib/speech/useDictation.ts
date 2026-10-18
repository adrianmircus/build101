import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { normalize } from "@/lib/voice/commands";
import { speakAloud } from "./voice";

// The browser's Web Speech API. TypeScript's DOM types don't include SpeechRecognition: only what we use.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};

// Chrome runs one recognition at a time: starting one (a voice command, or dictating an answer) cancels the other.
let active: { recognition: Recognition; cancel: () => void } | null = null;

const ERRORS: Record<string, string> = {
  "not-allowed": "No tenemos permiso para usar el micrófono. Habilitalo en el candado de la barra de direcciones.",
  "service-not-allowed": "No tenemos permiso para usar el micrófono. Habilitalo en el candado de la barra de direcciones.",
  "audio-capture": "No encontramos un micrófono. Revisá que esté conectado.",
  network: "Se cortó la conexión. El dictado necesita internet: probá de nuevo.",
  "no-speech": "No escuchamos nada. Probá de nuevo, más cerca del micrófono.",
};

// Dictation in Rioplatense Spanish: works in Chrome and Edge. Elsewhere supported is false and the student types.
// Starting again keeps adding to the same transcript; reset clears it. onEnd gets the full transcript when it stops.
// continuous false hears a single phrase and stops by itself (voice commands).
export function useDictation({
  lang = "es-UY",
  continuous = true,
  onEnd,
}: { lang?: string; continuous?: boolean; onEnd?: (transcript: string) => void } = {}) {
  // On the server and before hydration it's false, so the first render matches.
  const supported = useSyncExternalStore(noop, () => recognitionConstructor() !== null, () => false);
  const recognition = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  // The handlers outlive the render that created them: they read the latest values from here.
  const transcriptRef = useRef("");
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(() => {
    const Constructor = recognitionConstructor();
    if (!Constructor || recognition.current) return;
    active?.cancel();
    const r = new Constructor();
    r.lang = lang;
    r.continuous = continuous;
    r.interimResults = true;
    // Final results are added up; the interim one is replaced on each event.
    r.onresult = (event) => {
      let final = "";
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += text;
        else pending += text;
      }
      if (final) {
        transcriptRef.current = `${transcriptRef.current} ${final}`.replace(/\s+/g, " ").trim();
        setTranscript(transcriptRef.current);
      }
      setInterim(pending);
    };
    r.onerror = (event) => {
      if (event.error !== "aborted") setError(ERRORS[event.error] ?? "El dictado falló. Probá de nuevo.");
    };
    r.onend = () => {
      if (active?.recognition === r) active = null;
      recognition.current = null;
      setListening(false);
      setInterim("");
      onEndRef.current?.(transcriptRef.current);
    };
    recognition.current = r;
    // Cancelled by another recognition: it ends without calling onEnd, like reset.
    active = {
      recognition: r,
      cancel: () => {
        r.onresult = null;
        r.onend = null;
        r.abort();
        if (recognition.current === r) recognition.current = null;
        setListening(false);
        setInterim("");
      },
    };
    setError(null);
    setListening(true);
    r.start();
  }, [lang, continuous]);

  const stop = useCallback(() => recognition.current?.stop(), []);

  // Discards what was heard. The aborted recognition doesn't call onEnd, so it can start again right away.
  const reset = useCallback(() => {
    const r = recognition.current;
    if (r) {
      r.onresult = null;
      r.onend = null;
      r.abort();
      if (active?.recognition === r) active = null;
      recognition.current = null;
      setListening(false);
    }
    transcriptRef.current = "";
    setTranscript("");
    setInterim("");
    setError(null);
  }, []);

  // Leaving the screen turns off the microphone.
  useEffect(() => () => recognition.current?.abort(), []);

  return { supported, listening, transcript, interim, error, start, stop, reset };
}

// Errors after which listening again won't help: without a microphone or permission it stays off.
const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture"]);
// If the browser doesn't know Uruguayan Spanish, the closest ones.
const FALLBACK_LANGS = ["es-UY", "es-419", "es-ES"];

// Hands-free: keeps listening in the background and calls onFinal with each phrase heard, normalized (lowercase,
// no accents, numbers as digits). For students who can't press a button (eye gaze). Chrome stops a recognition after
// a while or a silence: it starts again by itself. It yields to any other recognition (a voice command, dictating) and
// comes back after. listening is true only once the browser confirms the microphone is on, not while it waits for
// permission; heard is the last phrase, so the screen can show what it understood.
// paused: while the page is reading aloud, the microphone hears the speakers. What it hears then is ignored.
export function useHandsFreeListening({ onFinal, paused = false }: { onFinal: (heard: string) => void; paused?: boolean }) {
  const supported = useSyncExternalStore(noop, () => recognitionConstructor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState("");
  const onFinalRef = useRef(onFinal);
  const pausedRef = useRef(paused);
  useEffect(() => {
    onFinalRef.current = onFinal;
    pausedRef.current = paused;
  });

  useEffect(() => {
    const Constructor = recognitionConstructor();
    if (!Constructor) return;
    let disposed = false;
    let fatal = false;
    let lang = 0;
    let current: Recognition | null = null;
    let timer = 0;

    const later = (ms: number) => {
      window.clearTimeout(timer);
      if (!disposed && !fatal) timer = window.setTimeout(listen, ms);
    };
    const release = (r: Recognition) => {
      if (active?.recognition === r) active = null;
      if (current === r) current = null;
      setListening(false);
    };

    function listen() {
      // Someone else is listening (a voice command or a dictation): wait for them to finish.
      if (active) return later(1000);
      const r = new Constructor!();
      r.lang = FALLBACK_LANGS[lang];
      r.continuous = true;
      r.interimResults = false;
      // The microphone is really on: until then the browser may be waiting for permission.
      r.onstart = () => {
        setError(null);
        setListening(true);
      };
      r.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (!event.results[i].isFinal || pausedRef.current) continue;
          const text = normalize(event.results[i][0].transcript);
          if (!text) continue;
          setHeard(text);
          onFinalRef.current(text);
        }
      };
      r.onerror = (event) => {
        if (event.error === "language-not-supported" && lang < FALLBACK_LANGS.length - 1) {
          lang++;
          return;
        }
        if (!FATAL.has(event.error)) return;
        fatal = true;
        setError(ERRORS[event.error]);
      };
      r.onend = () => {
        release(r);
        later(400);
      };
      current = r;
      active = {
        recognition: r,
        cancel: () => {
          r.onresult = null;
          r.onend = null;
          r.abort();
          release(r);
          later(1000);
        },
      };
      try {
        r.start();
      } catch {
        release(r);
        later(1000);
      }
    }

    later(0);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      const r = current;
      if (r) {
        r.onresult = null;
        r.onend = null;
        r.abort();
        if (active?.recognition === r) active = null;
      }
    };
  }, []);

  return { supported, listening, error, heard };
}

// Reads a text aloud with the Rioplatense ElevenLabs voice, falling back to the browser's voice.
// Returns false if there is no browser to play it in.
export function speak(text: string): boolean {
  if (typeof window === "undefined") return false;
  speakAloud(text);
  return true;
}
