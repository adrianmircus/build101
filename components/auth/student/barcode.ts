// BarcodeDetector is not in TypeScript's DOM types yet, and no library reads the QR: only the browser's own detector.

export type Detector = { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

export function barcodeDetectorConstructor(): DetectorConstructor | null {
  const ctor: unknown = Reflect.get(globalThis, "BarcodeDetector");
  return typeof ctor === "function" ? (ctor as DetectorConstructor) : null;
}

/** The camera can be opened and the browser can read a QR. false means: say that the phone's camera app does it. */
export function canScan(): boolean {
  return barcodeDetectorConstructor() !== null && typeof navigator.mediaDevices?.getUserMedia === "function";
}

export function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
}
