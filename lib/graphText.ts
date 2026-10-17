import type { GraphSpec } from "@/lib/contract";

// A graph in words: for screen readers and for the text version the teacher reads. No drawing code, so it runs anywhere.

export const formatNumber = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2)).replace("-", "−");

export function describeGraph(spec: GraphSpec): string {
  const fns = spec.functions.map((f) => `y = ${f.expr}`).join(" y ");
  const pts = spec.points
    .map((p) => `${p.label ? `${p.label} ` : ""}(${formatNumber(p.x)}, ${formatNumber(p.y)})`)
    .join(", ");
  return ["Gráfica", fns && `de ${fns}`, pts && `con los puntos ${pts}`].filter(Boolean).join(" ");
}
