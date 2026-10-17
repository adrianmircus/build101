"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { primaryButton, secondaryButton } from "@/components/ui/styles";
import { CALIBRATION_POINTS, centroid, classify, type Calibration, type CalibrationPoint, type Zone } from "./calibration";
import { useGaze } from "./useGaze";

// Wraps the student area for students who answer with eye gaze: turns the camera on right after login,
// calibrates, and tells the gaze targets which half of the screen the student is looking at.
// It's mounted in app/estudiante/layout.tsx, so the calibration survives moving between screens.

type GazeMode = "camera" | "pointer";

const GazeContext = createContext<{ mode: GazeMode; zone: Zone | null } | null>(null);

// Where the student is looking, for GazeTargets. null outside a session, which means practice mode (mouse and keys).
export function useGazeZone() {
  return useContext(GazeContext);
}

export function GazeSession({ children, autoStart = false }: { children: ReactNode; autoStart?: boolean }) {
  const gaze = useGaze();
  // With autoStart the camera turns on by itself: the student may not be able to press a button.
  const [phase, setPhase] = useState<"intro" | "calibrating" | "active">(autoStart ? "calibrating" : "intro");
  const [mode, setMode] = useState<GazeMode>("camera");
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [zone, setZone] = useState<Zone | null>(null);
  const { read, stop, start } = gaze;

  useEffect(() => {
    if (autoStart) void start();
  }, [autoStart, start]);

  // Once calibrated, every frame turns the eye features into a half of the screen.
  useEffect(() => {
    if (phase !== "active" || mode !== "camera" || !calibration) return;
    let frame = 0;
    const loop = () => {
      const features = read();
      const next = features ? classify(features, calibration) : null;
      setZone((z) => (z === next ? z : next));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [phase, mode, calibration, read]);

  const practice = () => {
    stop();
    setMode("pointer");
    setZone(null);
    setPhase("active");
  };

  if (phase === "intro") {
    return (
      <section
        aria-labelledby="gaze-intro"
        className="mx-auto mt-6 w-[calc(100%-2rem)] max-w-4xl rounded-2xl border-2 border-indigo-700 bg-white p-6 sm:p-8"
      >
        <h2 id="gaze-intro" className="text-3xl font-bold">
          Respondé con la mirada
        </h2>
        <ol className="mt-4 list-decimal space-y-2 pl-6 text-xl leading-relaxed">
          <li>Prendemos la cámara y te pedimos que mires tres puntos para conocer tus ojos.</li>
          <li>Siempre vas a ver dos opciones: una a la izquierda y otra a la derecha.</li>
          <li>Para elegir una, mirala y quedate mirándola hasta que se llene el círculo.</li>
        </ol>
        <p className="mt-4 text-lg text-slate-700">
          La cámara se usa solo en esta compu: el video no se guarda ni se envía a ningún lado.
        </p>
        {gaze.error && (
          <p role="alert" className="mt-4 rounded-lg border-2 border-red-700 bg-red-50 px-4 py-3 text-lg font-semibold text-red-900">
            {gaze.error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            className={primaryButton}
            disabled={gaze.status === "loading"}
            onClick={async () => {
              setMode("camera");
              await gaze.start();
              setPhase("calibrating");
            }}
          >
            {gaze.status === "loading" ? "Prendiendo la cámara…" : "Activar cámara"}
          </button>
          <button type="button" className={secondaryButton} onClick={practice}>
            Practicar sin cámara
          </button>
        </div>
      </section>
    );
  }

  if (phase === "calibrating") {
    if (gaze.status === "error") {
      // start() failed: back to the intro, which shows the error and the practice mode.
      return (
        <div
          role="alert"
          className="mx-auto mt-6 w-[calc(100%-2rem)] max-w-4xl rounded-2xl border-2 border-red-700 bg-red-50 p-6 text-lg"
        >
          <p className="font-semibold text-red-900">{gaze.error}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={primaryButton} onClick={() => setPhase("intro")}>
              Volver
            </button>
            <button type="button" className={secondaryButton} onClick={practice}>
              Practicar sin cámara
            </button>
          </div>
        </div>
      );
    }
    return (
      <Calibrate
        read={read}
        loading={gaze.status === "idle" || gaze.status === "loading"}
        noFace={gaze.status === "no-face"}
        onSkip={practice}
        onDone={(c) => {
          setCalibration(c);
          setPhase("active");
        }}
      />
    );
  }

  return (
    <GazeContext value={{ mode, zone }}>
      <div className="mx-auto mt-4 flex w-[calc(100%-2rem)] max-w-4xl flex-wrap items-center gap-4 rounded-xl border-2 border-slate-200 bg-white px-4 py-3">
        {mode === "camera" ? (
          <>
            <Preview stream={gaze.stream} />
            <p role="status" className="text-lg font-semibold">
              {gaze.status === "no-face" ? "No encontramos tu cara: acomodate frente a la cámara." : "Te estamos viendo."}
            </p>
            <div className="ml-auto flex flex-wrap gap-3">
              <button type="button" className={secondaryButton} onClick={() => setPhase("calibrating")}>
                Recalibrar
              </button>
              <button type="button" className={secondaryButton} onClick={practice}>
                Seguir sin cámara
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-lg">
              <span className="font-semibold">Modo práctica:</span> pasá el mouse sobre una opción o mantené apretada la
              flecha ← o →.
            </p>
            <button type="button" className={`${secondaryButton} ml-auto`} onClick={() => setPhase("intro")}>
              Usar la cámara
            </button>
          </>
        )}
      </div>
      {children}
    </GazeContext>
  );
}

function Preview({ stream }: { stream: MediaStream | null }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);
  // Mirrored, like a mirror: it's only so the student can see they're in frame.
  return (
    <video
      ref={video}
      autoPlay
      muted
      playsInline
      aria-hidden="true"
      className="h-16 w-24 -scale-x-100 rounded-lg bg-slate-200 object-cover"
    />
  );
}

const SETTLE_MS = 1000;
const SAMPLE_MS = 1500;
const MIN_SAMPLES = 10;

const POINT_POSITION: Record<CalibrationPoint, string> = {
  left: "top-1/2 left-8 -translate-y-1/2",
  right: "top-1/2 right-8 -translate-y-1/2",
  center: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
};

// Three points: the middle of the left edge, of the right edge, and the center of the screen. On each one it waits for the eyes to arrive and then
// averages what the camera sees.
function Calibrate({
  read,
  loading,
  noFace,
  onSkip,
  onDone,
}: {
  read: () => number[] | null;
  loading: boolean;
  noFace: boolean;
  onSkip: () => void;
  onDone: (calibration: Calibration) => void;
}) {
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const results = useRef<Partial<Calibration>>({});
  const done = useRef(onDone);

  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    const point = CALIBRATION_POINTS[step];
    let samples: number[][] = [];
    let start = performance.now();
    let frame = 0;
    const loop = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= SETTLE_MS) {
        const features = read();
        if (features) samples.push(features);
      }
      setProgress(Math.max(0, Math.min(1, (elapsed - SETTLE_MS) / SAMPLE_MS)));
      if (elapsed >= SETTLE_MS + SAMPLE_MS) {
        if (samples.length < MIN_SAMPLES) {
          // It didn't see the face long enough: this point starts again.
          samples = [];
          start = now;
        } else {
          results.current[point] = centroid(samples);
          if (step + 1 < CALIBRATION_POINTS.length) setStep(step + 1);
          else done.current(results.current as Calibration);
          return;
        }
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [step, read]);

  const point = CALIBRATION_POINTS[step];
  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-white">
      <p role="status" className="absolute inset-x-0 top-1/3 px-8 text-center text-2xl font-semibold">
        {loading
          ? "Prendiendo la cámara…"
          : noFace
            ? "No encontramos tu cara: acomodate frente a la cámara."
            : `Mirá el punto y quedate mirándolo (${step + 1} de ${CALIBRATION_POINTS.length})`}
      </p>
      <span
        aria-hidden="true"
        className={`absolute grid size-20 place-items-center rounded-full ${POINT_POSITION[point]}`}
        style={{ background: `conic-gradient(var(--color-amber-400) ${progress * 360}deg, var(--color-slate-700) 0)` }}
      >
        <span className="size-8 rounded-full bg-white motion-safe:animate-pulse" />
      </span>
      {/* For whoever is helping the student, if the camera can't see the face. */}
      <button
        type="button"
        onClick={onSkip}
        className="absolute bottom-8 left-1/2 min-h-11 -translate-x-1/2 rounded-lg border-2 border-slate-500 px-5 py-2 text-lg font-semibold text-slate-200 hover:bg-slate-800"
      >
        Seguir sin cámara
      </button>
    </div>
  );
}
