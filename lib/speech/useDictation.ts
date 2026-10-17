import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { speakAloud } from "./voice";

// The browser's Web Speech API. TypeScript's DOM types don't include SpeechRecognition: only what we use.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
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

const ERRORS: Record<string, string> = {
  "not-allowed": "No tenemos permiso para usar el micrófono. Habilitalo en el candado de la barra de direcciones.",
  "service-not-allowed": "No tenemos permiso para usar el micrófono. Habilitalo en el candado de la barra de direcciones.",
  "audio-capture": "No encontramos un micrófono. Revisá que esté conectado.",
  network: "Se cortó la conexión. El dictado necesita internet: probá de nuevo.",
  "no-speech": "No escuchamos nada. Probá de nuevo, más cerca del micrófono.",
};

// Dictation in Rioplatense Spanish: works in Chrome and Edge. Elsewhere supported is false and the student types.
// Starting again keeps adding to the same transcript; reset clears it. onEnd gets the full transcript when it stops.
export function useDictation({ lang = "es-UY", onEnd }: { lang?: string; onEnd?: (transcript: string) => void } = {}) {
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
    const r = new Constructor();
    r.lang = lang;
    r.continuous = true;
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
      recognition.current = null;
      setListening(false);
      setInterim("");
      onEndRef.current?.(transcriptRef.current);
    };
    recognition.current = r;
    setError(null);
    setListening(true);
    r.start();
  }, [lang]);

  const stop = useCallback(() => recognition.current?.stop(), []);

  // Discards what was heard. The aborted recognition doesn't call onEnd, so it can start again right away.
  const reset = useCallback(() => {
    const r = recognition.current;
    if (r) {
      r.onresult = null;
      r.onend = null;
      r.abort();
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

// Reads a text aloud with the Rioplatense ElevenLabs voice, falling back to the browser's voice.
// Returns false if there is no browser to play it in.
export function speak(text: string): boolean {
  if (typeof window === "undefined") return false;
  speakAloud(text);
  return true;
}
