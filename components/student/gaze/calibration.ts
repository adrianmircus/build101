// Where the student can look: the left or right half of the screen, or the center, which means "not choosing".
// Every choice is between two big targets, one per half: fewer zones are faster and harder to confuse.
export type Zone = "left" | "right";
export type CalibrationPoint = Zone | "center";

export const CALIBRATION_POINTS: CalibrationPoint[] = ["left", "right", "center"];

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

// Target 0 is the left half, target 1 the right half.
export function targetOf(zone: Zone | null): number | null {
  return zone === null ? null : zone === "left" ? 0 : 1;
}

export function zoneOf(target: number): Zone {
  return target === 0 ? "left" : "right";
}
