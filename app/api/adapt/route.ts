// POST con FormData: files (PDF o fotos, hasta 4 y 4 MB entre todos) o text (práctico pegado).
// Opcional: ajustes (preguntas_guia, recordatorio, ejemplo_resuelto, numeros_simples, menos_items), items (con menos_items),
// razonamiento_en (versiones con los apoyos de razonamiento disminuido; "razonamiento" es la versión propia) e intereses.
// Responde NDJSON: un evento por etapa y por formato, para que la pantalla muestre cada versión apenas está lista.
// Solo con sesión de profe: proxy.ts ya corta sin sesión, este es el control real en el servidor.
import { adaptPractico, PipelineError, type InputFile } from "@/lib/adapter/adapt-pipeline";
import { ADJUSTMENTS, cleanInterests, FORMATS, isReasoning, type Adjustment, type Format } from "@/lib/adapter/adapt-schemas";
import { uploadIssue } from "@/lib/adapter/upload";
import { readSession } from "@/lib/auth/session";

export const maxDuration = 120; // ajustar al máximo del plan de Vercel

export async function POST(req: Request) {
  if ((await readSession())?.role !== "teacher") {
    return Response.json({ error: "Tu sesión venció. Volvé a ingresar como profe." }, { status: 401 });
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: object) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        const form = await req.formData();
        const text = (form.get("text") as string | null)?.trim() || null;
        const uploads = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
        if (!text && uploads.length === 0) throw new PipelineError("Subí un PDF o una foto del práctico, o pegá el texto.");
        const invalid = uploadIssue(uploads);
        if (invalid) throw new PipelineError(invalid);

        const files: InputFile[] = [];
        for (const f of uploads) {
          files.push({ data: Buffer.from(await f.arrayBuffer()).toString("base64"), mediaType: f.type as InputFile["mediaType"] });
        }
        // Ajustes de dificultad: los marca el profe para un estudiante. Sin ajustes, la dificultad no cambia.
        const ajustes = form
          .getAll("ajustes")
          .flatMap((v) => String(v).split(","))
          .map((v) => v.trim())
          .filter((v): v is Adjustment => (ADJUSTMENTS as readonly string[]).includes(v));
        const keep_items = form
          .getAll("items")
          .flatMap((v) => String(v).split(","))
          .map((v) => v.trim())
          .filter(Boolean);
        if (ajustes.includes("menos_items") && keep_items.length === 0) throw new PipelineError("Elegí qué ejercicios quedan, por ejemplo: 1, 3, 4b.");
        const list = (name: string) =>
          form
            .getAll(name)
            .flatMap((v) => String(v).split(","))
            .map((v) => v.trim())
            .filter(Boolean);
        // Sin destino, los apoyos de razonamiento disminuido van en su versión propia.
        const targets = list("razonamiento_en").filter((v): v is Format => (FORMATS as readonly string[]).includes(v));
        const razonamiento_en: Format[] = targets.length > 0 ? [...new Set(targets)] : ajustes.some(isReasoning) ? ["razonamiento"] : [];
        const intereses = cleanInterests(form.getAll("intereses").map(String));
        await adaptPractico(files, text, send, { ajustes: [...new Set(ajustes)], keep_items, razonamiento_en, intereses });
      } catch (err) {
        console.error(err);
        const message = err instanceof PipelineError ? err.message : "Algo falló del lado del servidor. Probá de nuevo.";
        send({ stage: "error", message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
