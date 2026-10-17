// Lotes de ejercicios para adaptar en paralelo. Sin dependencias: lo usan el pipeline y los tests.

// Ejercicios por llamada al modelo. Una versión con apoyos de 10 ejercicios son unos 9.000 tokens de salida: en una sola
// llamada pasa del minuto y medio. En lotes en paralelo, el tiempo es el del lote más largo.
export const BATCH_SIZE = 4;

// Lotes parejos de ejercicios consecutivos: 10 ejercicios van en 4, 3 y 3.
export function splitEven<T>(items: T[], size = BATCH_SIZE): T[][] {
  const count = Math.max(1, Math.ceil(items.length / size));
  const out: T[][] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const n = Math.floor(items.length / count) + (i < items.length % count ? 1 : 0);
    out.push(items.slice(start, start + n));
    start += n;
  }
  return out.filter((b) => b.length > 0);
}
