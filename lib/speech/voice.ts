// Lectura en voz alta en el navegador: primero la voz rioplatense de ElevenLabs (por /api/tts); si no está
// configurada, falla o el navegador no deja reproducir, la voz del sistema en español. Una sola voz a la vez,
// siempre desde un clic (nada de autoplay), con pausa y stop.

export type Playback = { pause(): void; resume(): void; stop(): void };

let current: Playback | null = null;
// Después de un 503 (ElevenLabs sin configurar o caído) no se vuelve a pedir en esta carga de la página.
let serverVoice = true;

// onEnd avisa cuando termina o se corta, para que el botón vuelva a "Escuchar".
export function speakAloud(text: string, onEnd?: () => void): Playback {
  current?.stop();
  let stopped = false;
  let ended = false;
  let inner: Playback | null = null;
  const finish = () => {
    if (ended) return;
    ended = true;
    onEnd?.();
  };
  const self: Playback = {
    pause: () => inner?.pause(),
    resume: () => inner?.resume(),
    stop: () => {
      stopped = true;
      inner?.stop();
      if (current === self) current = null;
      finish();
    },
  };
  current = self;

  void (async () => {
    const audio = serverVoice ? await serverAudio(text) : null;
    if (stopped) {
      audio?.release();
      return;
    }
    if (audio) {
      const el = audio.element;
      const done = () => {
        audio.release();
        finish();
      };
      el.onended = done;
      try {
        await el.play();
        if (stopped) return audio.release();
        el.onerror = done; // se cortó a mitad de la lectura
        inner = { pause: () => el.pause(), resume: () => void el.play(), stop: audio.release };
        return;
      } catch {
        audio.release(); // el navegador no dejó reproducir: sigue con la voz del sistema
      }
    }
    if (!stopped) inner = browserSpeak(text, finish);
  })();
  return self;
}

export function stopSpeaking() {
  current?.stop();
}

async function serverAudio(text: string): Promise<{ element: HTMLAudioElement; release: () => void } | null> {
  try {
    const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    if (res.status === 503) serverVoice = false;
    if (!res.ok) return null;
    const url = URL.createObjectURL(await res.blob());
    const element = new Audio(url);
    return {
      element,
      release: () => {
        element.onended = null;
        element.onerror = null;
        element.pause();
        URL.revokeObjectURL(url);
      },
    };
  } catch {
    return null;
  }
}

// Voz del sistema: la de Uruguay si existe, si no la latinoamericana, si no cualquier español.
export function browserSpeak(text: string, onEnd?: () => void, rate = 1): Playback {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!synth) {
    onEnd?.();
    return { pause() {}, resume() {}, stop() {} };
  }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  const voices = synth.getVoices();
  const voice =
    voices.find((v) => v.lang === "es-UY") ?? voices.find((v) => v.lang === "es-419" || v.lang === "es-US") ?? voices.find((v) => v.lang.startsWith("es"));
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? "es-UY";
  u.rate = rate;
  synth.speak(u);
  return { pause: () => synth.pause(), resume: () => synth.resume(), stop: () => synth.cancel() };
}
