import "server-only";
import { z } from "zod";
import type { GraphSpec } from "@/lib/contract";

// GraphSpec (lib/contract.ts) as the AI fills it. Nullable instead of optional so the model always says it.
export const GraphSchema = z.object({
  functions: z.array(z.object({ expr: z.string(), label: z.string().nullable() })),
  points: z.array(z.object({ x: z.number(), y: z.number(), label: z.string().nullable() })),
  window: z.object({ xMin: z.number(), xMax: z.number(), yMin: z.number(), yMax: z.number() }).nullable(),
});

// How the AI must write a graph so the code can draw it.
export const GRAPH_FORMAT = `A graph has "functions" (each "expr" is a function of x in plain math syntax with explicit "*", "^" for powers and functions like sqrt, abs, exp, log: for example "x^2 - 2*x", "-(x - 1)^2 + 1", "2*x + 1"; no LaTeX, no "y =" or "f(x) ="), "points" to mark (roots, vertex, intercepts, with a short Spanish "label" like "Vértice"), and a "window" that shows them all (or null to compute it).`;

export function toGraph(g: z.infer<typeof GraphSchema> | null): GraphSpec | undefined {
  if (!g || (g.functions.length === 0 && g.points.length === 0)) return undefined;
  return {
    functions: g.functions.map((f) => ({ expr: f.expr, ...(f.label ? { label: f.label } : {}) })),
    points: g.points.map((p) => ({ x: p.x, y: p.y, ...(p.label ? { label: p.label } : {}) })),
    ...(g.window ? { window: g.window } : {}),
  };
}
