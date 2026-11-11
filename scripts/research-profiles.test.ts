// Pruebas sin IA del agente investigador: sitios permitidos, páginas leídas y borrador con contradicciones.
import { expect, it } from "vitest";
import { allowedDomains, fileName, isAllowed, readPages, readSites } from "./research-profiles.mjs";
import { DRAFTS, draftMarkdown, isGenerated, withTitles } from "./distill-profiles.mjs";

function throws(fn: () => unknown) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// Sitios permitidos
it("sitios: minúsculas y sin repetir", () => {
  expect(allowedDomains([{ dominio: "CAST.org" }, { dominio: " cast.org " }])).toEqual(["cast.org"]);
});
it("sitios: rechaza https://", () => {
  expect(throws(() => allowedDomains([{ dominio: "https://cast.org" }]))).toEqual(true);
});
it("sitios: rechaza una ruta", () => {
  expect(throws(() => allowedDomains([{ dominio: "cast.org/udl" }]))).toEqual(true);
});
it("sitios: rechaza una IP", () => {
  expect(throws(() => allowedDomains([{ dominio: "192.168.0.1" }]))).toEqual(true);
});
it("sitios: rechaza localhost", () => {
  expect(throws(() => allowedDomains([{ dominio: "localhost" }]))).toEqual(true);
});
it("sitios: rechaza la lista vacía", () => {
  expect(throws(() => allowedDomains([]))).toEqual(true);
});
it("sitios: rechaza más de 64", () => {
  expect(throws(() => allowedDomains(Array.from({ length: 65 }, (_, i) => ({ dominio: `sitio${i}.org` }))))).toEqual(true);
});
const committed = readSites();
it("sitios: la lista commiteada es válida", () => {
  expect(committed.domains.length > 0).toEqual(true);
});

const domains = ["cast.org", "anep.edu.uy"];
it("url: dominio exacto", () => {
  expect(isAllowed("https://cast.org/x", domains)).toEqual(true);
});
it("url: subdominio", () => {
  expect(isAllowed("https://udlguidelines.cast.org/x", domains)).toEqual(true);
});
it("url: otro dominio que termina igual", () => {
  expect(isAllowed("https://fakecast.org/x", domains)).toEqual(false);
});
it("url: otro sitio", () => {
  expect(isAllowed("https://example.com/cast.org", domains)).toEqual(false);
});
it("url: no es una URL", () => {
  expect(isAllowed("cast.org", domains)).toEqual(false);
});

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
it("páginas: una por URL", () => {
  expect(pages.map((p: { url: string }) => p.url)).toEqual([
  "https://udlguidelines.cast.org/representation",
  "https://anep.edu.uy/guia.pdf",
]);
});
it("páginas: sin título usa la URL", () => {
  expect(pages[1].title).toEqual("https://anep.edu.uy/guia.pdf");
});
it("páginas: errores de las herramientas", () => {
  expect(errors).toEqual(["lectura: url_not_accessible", "búsqueda: max_uses_exceeded"]);
});

// Nombres de archivo
it("archivo: texto", () => {
  expect(fileName("https://udlguidelines.cast.org/representation/", text)).toEqual("udlguidelines-cast-org-representation.txt");
});
it("archivo: pdf", () => {
  expect(fileName("https://anep.edu.uy/docs/Guía%20DUA.pdf", pdf)).toEqual("anep-edu-uy-docs-guia-dua.pdf");
});
it("archivo: largo recortado", () => {
  expect(fileName(`https://cast.org/${"a".repeat(200)}`, text).length <= 84).toEqual(true);
});

// Borrador
const adaptation = (text: string, contradicts: string | null, scope = "text", quote = "cita") => ({
  category: "Enunciado",
  scope,
  adaptation: text,
  page: null,
  quote,
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
it("borrador: sección de contradicciones arriba", () => {
  expect(draft.indexOf("## ⚠ Contradice lo aprobado") < draft.indexOf("## Adaptaciones")).toEqual(true);
});
it("borrador: dice qué está aprobado hoy", () => {
  expect(draft.includes('Sin límite de tiempo (Fuente: [F2]: "cita"). Aprobado hoy: "Dar 25 % más de tiempo"')).toEqual(true);
});
it("borrador: marca la adaptación en su categoría", () => {
  expect(draft.includes('- ⚠ Sin límite de tiempo (Fuente: [F2]: "cita")')).toEqual(true);
});
it("borrador: fuente web con su URL", () => {
  expect(draft.includes("- [F2] Pautas DUA (https://udlguidelines.cast.org/, leída por el agente investigador)")).toEqual(true);
});
it("borrador: fuente del equipo con su archivo", () => {
  expect(draft.includes("- [F1] Guía del equipo (archivo: guia.pdf)")).toEqual(true);
});
const clean = draftMarkdown("adhd", "TDAH", [{ file: "guia.pdf", title: "Guía", adaptations: [adaptation("Enunciados cortos", null)] }]);
it("borrador: sin contradicciones no hay sección", () => {
  expect(clean.includes("Contradice")).toEqual(false);
});
it("borrador: dice la materia", () => {
  expect(clean.includes("(Matemática)")).toEqual(true);
});
it("borrador: lo generó el destilado", () => {
  expect(clean.includes("generado por npm run profiles:distill")).toEqual(true);
});
it("borrador: se puede reemplazar", () => {
  expect(isGenerated(clean)).toEqual(true);
});

// Lo que no va en el texto de la consigna
const mixed = draftMarkdown(
  "adhd",
  "TDAH",
  [
    {
      file: "chadd-org-math.pdf",
      title: "Accommodations for Math Assignments",
      url: "https://chadd.org/math.pdf",
      adaptations: [
        adaptation("Verbo de la consigna en negrita", null),
        adaptation("Más tiempo", "Dar 25 % más de tiempo", "outside_text"),
        adaptation("Permitir calculadora", null, "changes_assessment", "use a calculator --> always"),
      ],
    },
  ],
  { script: "research" },
);
const reviewerNotes = mixed.slice(mixed.indexOf("<!--"), mixed.indexOf("-->") + 3);
const list = mixed.slice(mixed.indexOf("## Adaptaciones"));
it("alcance: lo del texto va en la lista", () => {
  expect(list.includes("- Verbo de la consigna en negrita")).toEqual(true);
});
it("alcance: fuera del texto, solo en las notas", () => {
  expect([reviewerNotes.includes("Más tiempo"), list.includes("Más tiempo")]).toEqual([true, false]);
});
it("alcance: lo que cambia lo evaluado, solo en las notas", () => {
  expect([reviewerNotes.includes("Descartadas porque cambian lo que se evalúa"), list.includes("calculadora")]).toEqual([true, false]);
});
it("alcance: las notas dicen qué contradicen", () => {
  expect(reviewerNotes.includes('Contradice lo aprobado: "Dar 25 % más de tiempo"')).toEqual(true);
});
it("alcance: una cita no cierra el comentario", () => {
  expect(reviewerNotes.includes('"use a calculator -- > always"')).toEqual(true);
});
it("alcance: no hay contradicciones fuera de la lista", () => {
  expect(mixed.includes("## ⚠ Contradice lo aprobado")).toEqual(false);
});
it("investigador: lo dice el encabezado", () => {
  expect(mixed.includes("generado por npm run profiles:research")).toEqual(true);
});
it("investigador: no se copia entero", () => {
  expect(mixed.includes("no copies el archivo entero")).toEqual(true);
});
it("investigador: su propio archivo", () => {
  expect(DRAFTS.research.file("adhd")).toEqual("adhd.web.draft.md");
});
it("investigador: el borrador del equipo", () => {
  expect(DRAFTS.distill.file("adhd")).toEqual("adhd.draft.md");
});

// Un borrador escrito a mano no se pisa
it("a mano: sin el encabezado del script", () => {
  expect(isGenerated("# ADHD\n\n<!--\nBORRADOR. El agente NO lo usa. Lo escribió una sesión…\n-->\n")).toEqual(false);
});

// fuentes.json se queda con el título del documento
it("títulos: el del destilado reemplaza la URL", () => {
  expect(withTitles(
    {
      "chadd-org-math.pdf": { url: "https://chadd.org/math.pdf", title: "https://chadd.org/math.pdf", leida: "2026-10-28" },
      "otro.txt": { url: "https://cast.org/", title: "CAST", leida: "2026-10-28" },
    },
    [{ file: "chadd-org-math.pdf", title: "Accommodations for Math Assignments", url: "https://chadd.org/math.pdf" }, { file: "guia.pdf", title: "Guía" }],
  )).toEqual({
    "chadd-org-math.pdf": { url: "https://chadd.org/math.pdf", title: "Accommodations for Math Assignments", leida: "2026-10-28" },
    "otro.txt": { url: "https://cast.org/", title: "CAST", leida: "2026-10-28" },
  });
});
