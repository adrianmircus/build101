import type { OptionId } from "@/lib/contract";

// Where the student can look: the four screen quadrants (A top left, B top right,
// C bottom left, D bottom right) or the center, which means "not choosing".
export type Zone = OptionId;
export type CalibrationPoint = Zone | "center";

export const ZONES: Zone[] = ["A", "B", "C", "D"];
export const CALIBRATION_POINTS: CalibrationPoint[] = ["A", "B", "C", "D", "center"];

// The average eye features while looking at each point. It absorbs the mirroring, the camera
// position and each face, so nothing needs training.
export type Calibration = Record<CalibrationPoint, number[]>;

export function centroid(samples: number[][]): number[] {
  const sum = samples[0].map(() => 0);
  for (const s of samples) s.forEach((value, i) => (sum[i] += value));
  return sum.map((value) => value / samples.length);
}

function distance(a: number[], b: number[]): number {
  return Math.hypot(...a.map((value, i) => value - b[i]));
}

// The nearest calibrated point. null when it's the center or it's too close to call between two points.
export function classify(features: number[], calibration: Calibration): Zone | null {
  const ranked = CALIBRATION_POINTS.map((point) => ({ point, d: distance(features, calibration[point]) })).sort(
    (a, b) => a.d - b.d,
  );
  const [first, second] = ranked;
  if (first.point === "center" || first.d > second.d * 0.8) return null;
  return first.point;
}

// Which target a zone points at when there are n targets. With 2 they split the screen in left and right halves;
// with 3 or 4, one per quadrant.
export function targetOf(zone: Zone | null, n: number): number | null {
  if (zone === null) return null;
  if (n <= 2) return zone === "A" || zone === "C" ? 0 : 1;
  const i = ZONES.indexOf(zone);
  return i < n ? i : null;
}

// The zone that stands for target i, for the keyboard (keys 1–4) in practice mode.
export function zoneOf(target: number, n: number): Zone {
  return n <= 2 ? (target === 0 ? "A" : "B") : ZONES[target];
}
