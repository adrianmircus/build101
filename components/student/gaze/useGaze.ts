"use client";

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";

// Eye tracking with MediaPipe Face Landmarker, 100% in the browser: the video never leaves the computer.
// The library and the model are loaded only when start() is called, that is, only for students who answer with eye gaze.

export type GazeStatus = "idle" | "loading" | "ready" | "no-face" | "error";

// The model's eye blendshapes (0 to 1). Together they say where the eyes point.
const EYE_LOOK = [
  "eyeLookInLeft",
  "eyeLookOutLeft",
  "eyeLookUpLeft",
  "eyeLookDownLeft",
  "eyeLookInRight",
  "eyeLookOutRight",
  "eyeLookUpRight",
  "eyeLookDownRight",
];
const BLINK = ["eyeBlinkLeft", "eyeBlinkRight"];
// Exponential smoothing: higher follows the eyes faster, lower jitters less.
const SMOOTHING = 0.3;

const ERRORS: Record<string, string> = {
  NotAllowedError: "No tenemos permiso para usar la cámara. Habilitala en el candado de la barra de direcciones.",
  NotFoundError: "No encontramos una cámara conectada a esta compu.",
  NotReadableError: "La cámara la está usando otro programa. Cerralo y probá de nuevo.",
};

async function createLandmarker(): Promise<FaceLandmarker> {
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: "/mediapipe/face_landmarker.task", delegate },
    runningMode: "VIDEO" as const,
    numFaces: 1,
    outputFaceBlendshapes: true,
  });
  try {
    return await FaceLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    // Without WebGL the CPU is slower but works.
    return FaceLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

export function useGaze() {
  const [status, setStatus] = useState<GazeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const features = useRef<number[] | null>(null);
  const running = useRef<{ stop: () => void } | null>(null);

  const stop = useCallback(() => {
    running.current?.stop();
    running.current = null;
    features.current = null;
    setStream(null);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (running.current) return;
    setStatus("loading");
    setError(null);
    let cancelled = false;
    let media: MediaStream | null = null;
    let landmarker: FaceLandmarker | null = null;
    let frame = 0;
    running.current = {
      stop: () => {
        cancelled = true;
        cancelAnimationFrame(frame);
        media?.getTracks().forEach((t) => t.stop());
        landmarker?.close();
      },
    };

    try {
      media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      landmarker = await createLandmarker();
      if (cancelled) {
        running.current?.stop();
        return;
      }
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = media;
      await video.play();
      setStream(media);

      let lastTime = -1;
      let lastStatus: GazeStatus = "loading";
      const report = (next: GazeStatus) => {
        if (next !== lastStatus) setStatus((lastStatus = next));
      };
      const loop = () => {
        if (cancelled || !landmarker) return;
        if (video.readyState >= 2 && video.currentTime !== lastTime) {
          lastTime = video.currentTime;
          const categories = landmarker.detectForVideo(video, performance.now()).faceBlendshapes[0]?.categories;
          if (!categories) {
            features.current = null;
            report("no-face");
          } else {
            const score = (name: string) => categories.find((c) => c.categoryName === name)?.score ?? 0;
            // A blink isn't a look: the frame is skipped so the selection doesn't move.
            if (BLINK.every((name) => score(name) < 0.5)) {
              const next = EYE_LOOK.map(score);
              const previous = features.current;
              features.current = previous
                ? previous.map((value, i) => value + SMOOTHING * (next[i] - value))
                : next;
            }
            report("ready");
          }
        }
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    } catch (e) {
      running.current?.stop();
      running.current = null;
      const name = e instanceof DOMException ? e.name : "";
      setError(ERRORS[name] ?? "No pudimos prender el seguimiento de la mirada. Probá de nuevo o usá el modo sin cámara.");
      setStatus("error");
    }
  }, []);

  // Leaving the page turns the camera off.
  useEffect(() => () => running.current?.stop(), []);

  // The latest smoothed eye features, or null without a face. Read it inside a frame loop, not while rendering.
  const read = useCallback(() => features.current, []);

  return { status, error, stream, start, stop, read };
}
