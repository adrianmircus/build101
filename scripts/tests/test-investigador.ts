// Pruebas sin IA del agente investigador: sitios permitidos, páginas leídas y borrador con contradicciones.
// Correr con: npx tsx scripts/tests/test-investigador.ts
import { allowedDomains, fileName, isAllowed, readPages, readSites } from "../research-profiles.mjs";
import { draftMarkdown } from "../distill-profiles.mjs";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed++;
  console.log(`${pass ? "OK  " : "FALLA"} ${name}${pass ? "" : `\n      esperado ${JSON.stringify(want)}\n      obtenido ${JSON.stringify(got)}`}`);
}
function throws(fn: () => unknown) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// Sitios permitidos
check("sitios: minúsculas y sin repetir", allowedDomains([{ dominio: "CAST.org" }, { dominio: " cast.org " }]), ["cast.org"]);
check("sitios: rechaza https://", throws(() => allowedDomains([{ dominio: "https://cast.org" }])), true);
check("sitios: rechaza una ruta", throws(() => allowedDomains([{ dominio: "cast.org/udl" }])), true);
check("sitios: rechaza una IP", throws(() => allowedDomains([{ dominio: "192.168.0.1" }])), true);
check("sitios: rechaza localhost", throws(() => allowedDomains([{ dominio: "localhost" }])), true);
check("sitios: rechaza la lista vacía", throws(() => allowedDomains([])), true);
check(
  "sitios: rechaza más de 64",
  throws(() => allowedDomains(Array.from({ length: 65 }, (_, i) => ({ dominio: `sitio${i}.org` })))),
  true,
);
const committed = readSites();
check("sitios: la lista commiteada es válida", committed.domains.length > 0, true);

const domains = ["cast.org", "anep.edu.uy"];
check("url: dominio exacto", isAllowed("https://cast.org/x", domains), true);
check("url: subdominio", isAllowed("https://udlguidelines.cast.org/x", domains), true);
check("url: otro dominio que termina igual", isAllowed("https://fakecast.org/x", domains), false);
check("url: otro sitio", isAllowed("https://example.com/cast.org", domains), false);
check("url: no es una URL", isAllowed("cast.org", domains), false);

// Páginas leídas
const text = { type: "text", media_type: "text/plain", data: "Pauta 1" };
const pdf = { type: "base64", media_type: "application/pdf", data: "JVBERi0=" };
const fetched = (url: string, source: object, title: string | null = "Guía") => ({
  type: "web_fetch_tool_result",
  tool_use_id: "t",
  content: { type: "web_fetch_result", url, retrieved_at: "2026-10-28T10:00:00Z", content: { type: "document", title, source } },
});
const { pages, errors } = readPages([
  { type: "text", text: "Busco…" },
  { type: "server_tool_use", id: "t", name: "web_fetch", input: {} },
  fetched("https://udlguidelines.cast.org/representation", text),
  fetched("https://udlguidelines.cast.org/representation", text),
  fetched("https://anep.edu.uy/guia.pdf", pdf, null),
  { type: "web_fetch_tool_result", tool_use_id: "u", content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } },
  { type: "web_search_tool_result", tool_use_id: "v", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
  { type: "web_search_tool_result", tool_use_id: "w", content: [] },
]);
check("páginas: una por URL", pages.map((p: { url: string }) => p.url), [
  "https://udlguidelines.cast.org/representation",
  "https://anep.edu.uy/guia.pdf",
]);
check("páginas: sin título usa la URL", pages[1].title, "https://anep.edu.uy/guia.pdf");
check("páginas: errores de las herramientas", errors, ["lectura: url_not_accessible", "búsqueda: max_uses_exceeded"]);

// Nombres de archivo
check("archivo: texto", fileName("https://udlguidelines.cast.org/representation/", text), "udlguidelines-cast-org-representation.txt");
check("archivo: pdf", fileName("https://anep.edu.uy/docs/Guía%20DUA.pdf", pdf), "anep-edu-uy-docs-guia-dua.pdf");
check("archivo: largo recortado", fileName(`https://cast.org/${"a".repeat(200)}`, text).length <= 84, true);

// Borrador
const adaptation = (text: string, contradicts: string | null) => ({
  category: "Enunciado",
  adaptation: text,
  page: null,
  quote: "cita",
  contradicts,
});
const draft = draftMarkdown("adhd", "TDAH", [
  { file: "guia.pdf", title: "Guía del equipo", adaptations: [adaptation("Enunciados cortos", null)] },
  {
    file: "udlguidelines-cast-org.txt",
    title: "Pautas DUA",
    url: "https://udlguidelines.cast.org/",
    adaptations: [adaptation("Sin límite de tiempo", "Dar 25 % más de tiempo")],
  },
]);
check("borrador: sección de contradicciones arriba", draft.indexOf("## ⚠ Contradice lo aprobado") < draft.indexOf("## Adaptaciones"), true);
check("borrador: dice qué está aprobado hoy", draft.includes('Sin límite de tiempo (Fuente: [F2]: "cita"). Aprobado hoy: "Dar 25 % más de tiempo"'), true);
check("borrador: marca la adaptación en su categoría", draft.includes('- ⚠ Sin límite de tiempo (Fuente: [F2]: "cita")'), true);
check("borrador: fuente web con su URL", draft.includes("- [F2] Pautas DUA (https://udlguidelines.cast.org/, leída por el agente investigador)"), true);
check("borrador: fuente del equipo con su archivo", draft.includes("- [F1] Guía del equipo (archivo: guia.pdf)"), true);
const clean = draftMarkdown("adhd", "TDAH", [{ file: "guia.pdf", title: "Guía", adaptations: [adaptation("Enunciados cortos", null)] }]);
check("borrador: sin contradicciones no hay sección", clean.includes("Contradice"), false);
check("borrador: dice la materia", clean.includes("(Matemática)"), true);

console.log(failed === 0 ? "\nTodo OK" : `\n${failed} pruebas fallaron`);
process.exit(failed === 0 ? 0 : 1);
