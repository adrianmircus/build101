// Archivos que acepta /api/adapt. Vercel corta con 413 los pedidos de más de 4,5 MB antes de que lleguen a la ruta:
// con 4 MB de archivos queda margen para el resto del formulario. Sin dependencias: sirve también en el navegador.
export const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedType = (typeof ACCEPTED)[number];

export const MAX_FILES = 4;
export const MAX_BYTES = 4 * 1024 * 1024;

// null si los archivos se pueden mandar; si no, el mensaje para el profe.
export function uploadIssue(files: { type: string; size: number }[]): string | null {
  if (files.length > MAX_FILES) return `Podés subir hasta ${MAX_FILES} archivos.`;
  if (files.some((f) => !(ACCEPTED as readonly string[]).includes(f.type))) return "Aceptamos PDF, JPG, PNG o WebP.";
  if (files.reduce((total, f) => total + f.size, 0) > MAX_BYTES) {
    return "Los archivos pesan más de 4 MB entre todos. Probá con menos páginas o con fotos más livianas.";
  }
  return null;
}
