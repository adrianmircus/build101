import { barcodeDetectorConstructor, openCamera, type Detector } from "./barcode";

export type ScanCallbacks = { onReady: () => void; onCode: (raw: string) => void; onProblem: () => void };

const EVERY_MS = 300;

/** One look at the current frame. A frame that cannot be read is not a problem: the next one is tried. */
async function lookOnce(detector: Detector, element: HTMLVideoElement): Promise<string | null> {
  if (element.readyState < 2) return null;
  try {
    const found = await detector.detect(element);
    return found[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

/** Opens the camera into `element` and looks for a QR a few times a second. Returns the function that stops it all. */
export function startScan(element: HTMLVideoElement, callbacks: ScanCallbacks): () => void {
  let cancelled = false;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stopTracks = () => stream?.getTracks().forEach((track) => track.stop());

  async function run(Detector: NonNullable<ReturnType<typeof barcodeDetectorConstructor>>) {
    try {
      stream = await openCamera();
      if (cancelled) return stopTracks();
      element.srcObject = stream;
      await element.play();
      callbacks.onReady();
      const detector = new Detector({ formats: ["qr_code"] });
      let looking = false;
      timer = setInterval(async () => {
        if (looking || cancelled) return;
        looking = true;
        const raw = await lookOnce(detector, element);
        looking = false;
        if (raw && !cancelled) callbacks.onCode(raw);
      }, EVERY_MS);
    } catch {
      stopTracks();
      if (!cancelled) callbacks.onProblem();
    }
  }

  const Detector = barcodeDetectorConstructor();
  if (Detector) void run(Detector);
  else queueMicrotask(callbacks.onProblem);
  return () => {
    cancelled = true;
    clearInterval(timer);
    stopTracks();
  };
}
