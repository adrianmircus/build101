// Contratos JSON de las llamadas a Claude (structured outputs).
// La matemática nunca viaja como texto libre: se extrae una vez y se referencia con marcadores {{m1}}.
import { z } from "zod";

export const FORMATS = ["lectura_facil", "dislexia", "lector_pantalla"] as const;
export type Format = (typeof FORMATS)[number];

export const FORMAT_LABELS: Record<Format, string> = {
  lectura_facil: "Lectura fácil",
  dislexia: "Dislexia",
  lector_pantalla: "Lector de pantalla y baja visión",
};

export const MathObjectSchema = z.object({
  id: z.string(), // m1, m2… únicos en todo el práctico
  mathjs: z.string(),
  latex: z.string(),
  role: z.enum(["equation", "expression", "value"]),
});

export const ItemSchema = z.object({
  id: z.string(), // la numeración del original: 1, 2a, 2b…
  kind: z.enum(["ecuacion", "expresion", "calculo", "problema", "otro"]),
  text: z.string(), // consigna con marcadores {{m1}} en lugar de la matemática
  math: z.array(MathObjectSchema),
  figure: z.string(), // descripción completa de la figura o tabla; "" si no hay
  unsure: z.boolean(),
});

export const ExtractionSchema = z.object({
  legible: z.boolean(),
  in_scope: z.boolean(),
  reason: z.string(),
  title: z.string(),
  general_instructions: z.string(),
  items: z.array(ItemSchema),
});

export const AdaptedItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  steps: z.array(z.string()),
  glossary: z.array(z.object({ term: z.string(), meaning: z.string() })),
  figure: z.string(),
});

export const AdaptationSchema = z.object({
  title: z.string(),
  general_instructions: z.string(),
  items: z.array(AdaptedItemSchema),
  notes_for_teacher: z.string(),
});

// Ajustes de dificultad: por defecto la adaptación no cambia la dificultad. El profe los habilita para un estudiante
// cuando su adecuación lo pide (ejemplos modelo, guías paso a paso, menos ítems). La versión queda marcada como
// "dificultad modificada".
export const ADJUSTMENTS = ["preguntas_guia", "recordatorio", "ejemplo_resuelto", "numeros_simples", "menos_items"] as const;
export type Adjustment = (typeof ADJUSTMENTS)[number];

export const ADJUSTMENT_LABELS: Record<Adjustment, string> = {
  preguntas_guia: "Preguntas guía paso a paso",
  recordatorio: "Recordatorio del procedimiento",
  ejemplo_resuelto: "Ejemplo resuelto con otros números",
  numeros_simples: "Números más simples en los problemas",
  menos_items: "Menos ítems (elegidos por el profe)",
};

export interface AdaptOptions {
  ajustes: Adjustment[];
  keep_items: string[]; // con menos_items: ids o números de ejercicio que quedan ("2" deja 2a y 2b)
}

export const NO_ADJUSTMENTS: AdaptOptions = { ajustes: [], keep_items: [] };

// Apoyos de un ejercicio. Van aparte de la consigna: la consigna sigue pasando por los mismos controles.
export const SupportSchema = z.object({
  guide: z.array(z.string()), // preguntas guía, en orden
  reminder: z.string(), // procedimiento general, sin los datos del ejercicio
  example: z.object({
    statement: z.string(), // consigna del ejemplo, con otros números
    steps: z.array(z.string()), // resolución en mathjs, una ecuación por paso: "x + (x + 2) = 10" … "x = 4"
  }),
});

export const AdaptationWithSupportSchema = AdaptationSchema.extend({
  items: z.array(AdaptedItemSchema.extend({ support: SupportSchema })),
});

// Planteo de un problema con texto, para verificar que la adaptación no cambió la respuesta.
export const MathModelSchema = z.object({
  solvable: z.boolean(),
  unknown: z.string(),
  equation: z.string(), // mathjs, una ecuación con una incógnita
  asks_for: z.string(),
});

export type MathObject = z.infer<typeof MathObjectSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;
export type Support = z.infer<typeof SupportSchema>;
export type AdaptedItem = z.infer<typeof AdaptedItemSchema> & { support?: Support };
export type Adaptation = Omit<z.infer<typeof AdaptationSchema>, "items"> & { items: AdaptedItem[] };
export type MathModel = z.infer<typeof MathModelSchema>;
