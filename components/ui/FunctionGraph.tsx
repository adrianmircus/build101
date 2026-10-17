"use client";

import { compile } from "mathjs";
import { useMemo } from "react";
import type { GraphSpec } from "@/lib/contract";

// Draws a graph the AI described (functions of x and marked points), for students who can't draw it:
// options to choose with eye gaze and the graph of what a student dictated. Expressions are evaluated with
// mathjs, never eval. A function that doesn't parse just isn't drawn.

const COLORS = ["#4338ca", "#b45309", "#047857", "#be123c"]; // indigo-700, amber-700, emerald-700, rose-700
const SAMPLES = 240;
const VIEW = 400; // square viewBox; the SVG scales to its container
const PAD = 28;

type Window = NonNullable<GraphSpec["window"]>;

function autoWindow(spec: GraphSpec): Window {
  const xs = spec.points.map((p) => p.x);
  const ys = spec.points.map((p) => p.y);
  const xMin = Math.min(-5, ...xs) - 1;
  const xMax = Math.max(5, ...xs) + 1;
  const yMin = Math.min(-5, ...ys) - 1;
  const yMax = Math.max(5, ...ys) + 1;
  return { xMin, xMax, yMin, yMax };
}

// One path per function, cut where it leaves the window or isn't a real number.
function curve(expr: string, w: Window, sx: (x: number) => number, sy: (y: number) => number): string | null {
  let f: { evaluate: (scope: { x: number }) => unknown };
  try {
    f = compile(expr);
  } catch {
    return null;
  }
  let d = "";
  let drawing = false;
  const margin = (w.yMax - w.yMin) * 0.5;
  for (let i = 0; i <= SAMPLES; i++) {
    const x = w.xMin + ((w.xMax - w.xMin) * i) / SAMPLES;
    let y: unknown;
    try {
      y = f.evaluate({ x });
    } catch {
      y = NaN;
    }
    if (typeof y !== "number" || !Number.isFinite(y) || y < w.yMin - margin || y > w.yMax + margin) {
      drawing = false;
      continue;
    }
    d += `${drawing ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
    drawing = true;
  }
  return d || null;
}

function ticks(min: number, max: number): number[] {
  const step = Math.max(1, Math.ceil((max - min) / 12));
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) if (t !== 0) out.push(t);
  return out;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2)).replace("-", "−");

export function describeGraph(spec: GraphSpec): string {
  const fns = spec.functions.map((f) => `y = ${f.expr}`).join(" y ");
  const pts = spec.points.map((p) => `${p.label ? `${p.label} ` : ""}(${fmt(p.x)}, ${fmt(p.y)})`).join(", ");
  return ["Gráfica", fns && `de ${fns}`, pts && `con los puntos ${pts}`].filter(Boolean).join(" ");
}

export function FunctionGraph({ spec, size = "lg" }: { spec: GraphSpec; size?: "sm" | "lg" }) {
  const w = spec.window ?? autoWindow(spec);
  const sx = (x: number) => PAD + ((x - w.xMin) / (w.xMax - w.xMin)) * (VIEW - 2 * PAD);
  const sy = (y: number) => VIEW - PAD - ((y - w.yMin) / (w.yMax - w.yMin)) * (VIEW - 2 * PAD);
  const paths = useMemo(
    () => spec.functions.map((f) => curve(f.expr, w, sx, sy)),
    // sx and sy only depend on the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec.functions, w.xMin, w.xMax, w.yMin, w.yMax],
  );
  const x0 = sx(Math.min(Math.max(0, w.xMin), w.xMax));
  const y0 = sy(Math.min(Math.max(0, w.yMin), w.yMax));
  const label = size === "lg" ? 15 : 13;

  return (
    <figure className={size === "lg" ? "w-full max-w-md" : "w-full max-w-56"}>
      <svg viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label={describeGraph(spec)} className="h-auto w-full rounded-lg bg-white">
        {ticks(w.xMin, w.xMax).map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD} y2={VIEW - PAD} className="stroke-slate-200" />
            <text x={sx(t)} y={y0 + 16} textAnchor="middle" fontSize={label} className="fill-slate-600">
              {fmt(t)}
            </text>
          </g>
        ))}
        {ticks(w.yMin, w.yMax).map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD} x2={VIEW - PAD} y1={sy(t)} y2={sy(t)} className="stroke-slate-200" />
            <text x={x0 - 6} y={sy(t) + 5} textAnchor="end" fontSize={label} className="fill-slate-600">
              {fmt(t)}
            </text>
          </g>
        ))}
        <line x1={PAD} x2={VIEW - PAD} y1={y0} y2={y0} className="stroke-slate-800" strokeWidth={2} />
        <line x1={x0} x2={x0} y1={PAD} y2={VIEW - PAD} className="stroke-slate-800" strokeWidth={2} />
        {paths.map((d, i) =>
          d ? <path key={i} d={d} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={size === "lg" ? 4 : 3} /> : null,
        )}
        {spec.points.map((p, i) => (
          <g key={i}>
            <circle cx={sx(p.x)} cy={sy(p.y)} r={size === "lg" ? 7 : 5} className="fill-slate-900" />
            {size === "lg" && (
              <text x={sx(p.x) + 10} y={sy(p.y) - 10} fontSize={15} fontWeight={600} className="fill-slate-900">
                {p.label ? `${p.label} ` : ""}({fmt(p.x)}, {fmt(p.y)})
              </text>
            )}
          </g>
        ))}
      </svg>
      {spec.functions.some((f) => f.label) && (
        <figcaption className="mt-1 flex flex-wrap gap-x-4 text-base">
          {spec.functions.map((f, i) =>
            f.label ? (
              <span key={i} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-1 w-5 rounded" style={{ background: COLORS[i % COLORS.length] }} />
                {f.label}
              </span>
            ) : null,
          )}
        </figcaption>
      )}
    </figure>
  );
}
