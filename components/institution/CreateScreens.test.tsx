import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GroupSummary } from "@/lib/domain/groups/rpc";
import { CreateDone } from "./CreateDone";
import { CreatePaste } from "./CreatePaste";
import { CreateReview } from "./CreateReview";
import { NEW_GROUP } from "./createFlowState";
import { draftRows } from "./usernameReview";

const noop = () => undefined;
const GROUP: GroupSummary = { id: "g1", name: "4.º B", subjectId: "math", schoolYear: 2026, archivedAt: null, revision: 1, myRole: null, studentCount: 10 };
const FIELDS = { groupChoice: "g1", groupName: "", subjectId: "math", schoolYear: "2026", names: "Lucía Fernández\nMateo Silva" };
const PASTE = {
  institutionHref: "/institucion/i1",
  institutionName: "Colegio San José",
  institutionCode: "sanjose",
  groups: [GROUP],
  subjects: [{ id: "math" }],
  fields: FIELDS,
  problems: null,
  notice: null,
  pending: false,
  focus: false,
  onField: noop,
  onReview: noop,
};

describe("CreatePaste", () => {
  it("con un grupo elegido: grupo y nombres con etiqueta visible, y el código del colegio en la bajada", () => {
    const html = renderToStaticMarkup(<CreatePaste {...PASTE} />);
    expect(html).toContain("Crear cuentas de estudiantes");
    expect(html).toContain("<strong>sanjose</strong>");
    expect(html).toContain('for="cr-grupo"');
    expect(html).toContain("4.º B · Matemática 2026");
    expect(html).toContain("Crear un grupo nuevo");
    expect(html).toContain('for="cr-nombres"');
    expect(html).toContain("Uno por línea. Podés pegarlos desde una planilla.");
    expect(html).not.toContain("cr-grupo-nombre");
  });

  it("con «crear un grupo nuevo»: nombre, materia del catálogo y año lectivo", () => {
    const html = renderToStaticMarkup(<CreatePaste {...PASTE} fields={{ ...FIELDS, groupChoice: NEW_GROUP, schoolYear: "2026" }} />);
    expect(html).toContain('for="cr-grupo-nombre"');
    expect(html).toContain('for="cr-grupo-materia"');
    expect(html).toContain(">Matemática<");
    expect(html).toContain('for="cr-grupo-anio"');
    expect(html).toContain('value="2026"');
  });

  it("sin grupos todavía: va directo a los datos del grupo, sin selector", () => {
    const html = renderToStaticMarkup(<CreatePaste {...PASTE} groups={[]} fields={{ ...FIELDS, groupChoice: NEW_GROUP }} />);
    expect(html).toContain("Todavía no hay grupos en el colegio");
    expect(html).not.toContain('for="cr-grupo"');
    expect(html).toContain('for="cr-grupo-nombre"');
  });

  it("los datos que faltan: resumen con enlaces, y cada mensaje al lado de su campo", () => {
    const list = [
      { field: "cr-grupo-nombre", message: "Escribí el nombre del grupo, por ejemplo 4.º B." },
      { field: "cr-nombres", message: "Pegá al menos un nombre." },
    ];
    const html = renderToStaticMarkup(<CreatePaste {...PASTE} fields={{ ...FIELDS, groupChoice: NEW_GROUP, names: "" }} problems={{ list, attempt: 1 }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Faltan completar 2 datos");
    expect(html).toContain('href="#cr-nombres"');
    expect(html).toContain('id="cr-nombres-error"');
    expect(html).toContain('id="cr-grupo-nombre-error"');
  });

  it("mientras revisa, el botón lo dice y está desactivado", () => {
    expect(renderToStaticMarkup(<CreatePaste {...PASTE} pending />)).toMatch(/<button[^>]*disabled[^>]*>Armando los usuarios/);
  });
});

describe("CreateReview", () => {
  const rows = draftRows([
    { displayName: "Lucía Fernández", username: "luciaf" },
    { displayName: "Lucía Fagúndez", username: "luciaf2" },
    { displayName: "Mateo Silva", username: "mateos" },
  ]);
  const props = { groupName: "4.º B", institutionName: "Colegio San José", homeHref: "/institucion/i1", rows, flags: {}, someCreated: false, pending: false, summary: null, notice: null, onBack: noop, onEdit: noop, onConfirm: noop };

  it("cada estudiante con su usuario editable, y el número que se sumó explicado", () => {
    const html = renderToStaticMarkup(<CreateReview {...props} />);
    expect(html).toContain("Revisá los usuarios");
    expect(html).toContain("Así van a entrar en 4.º B");
    expect(html).toContain('value="luciaf2"');
    expect(html).toContain("Usuario de Lucía Fagúndez");
    expect(html).toContain("Ya había alguien con ese usuario, por eso lleva un número.");
    expect(html).toContain("Crear 3 cuentas");
    expect(html).toContain("Volver a los nombres");
  });

  it("los repetidos se marcan con texto, aria-invalid y el mensaje enlazado al campo", () => {
    const repeated = rows.map((row, index) => (index === 1 ? { ...row, username: "luciaf" } : row));
    const html = renderToStaticMarkup(<CreateReview {...props} rows={repeated} />);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
    expect(html).toContain("Está repetido en esta lista");
    expect(html).toContain('aria-describedby="usr-fila-1-error"');
    expect(html).toContain('id="usr-fila-1-error"');
  });

  it("lo que no se pudo crear queda marcado, y el resumen avisa y enlaza al usuario", () => {
    const summary = { list: [{ field: "usr-fila-2", message: "Justo alguien tomó este usuario. Elegí otro.", summary: "Mateo Silva: Justo alguien tomó este usuario. Elegí otro." }], attempt: 1 };
    const html = renderToStaticMarkup(<CreateReview {...props} flags={{ "fila-2": "taken" }} summary={summary} notice={{ text: "Se crearon 2 cuentas. Queda 1 por revisar: miralo abajo.", attempt: 1 }} />);
    expect(html).toContain("Hay 1 usuario para corregir");
    expect(html).toContain('href="#usr-fila-2"');
    expect(html).toContain("Se crearon 2 cuentas.");
    expect(html).toContain("Justo alguien tomó este usuario");
  });

  it("si ya se crearon algunas, no se puede volver a los nombres (se duplicarían)", () => {
    const html = renderToStaticMarkup(<CreateReview {...props} someCreated />);
    expect(html).not.toContain("Volver a los nombres");
    expect(html).toContain("Colegio San José");
  });
});

describe("CreateDone", () => {
  it("anuncia el resultado y lleva a imprimir las tarjetas, avisando que se muestran una sola vez", () => {
    const html = renderToStaticMarkup(<CreateDone count={3} cardsHref="/institucion/i1/grupos/g1/tarjetas" homeHref="/institucion/i1" />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Listas las 3 cuentas");
    expect(html).toContain('href="/institucion/i1/grupos/g1/tarjetas"');
    expect(html).toContain("una sola vez");
    expect(html).toContain("Lo hago después");
    expect(html).toContain("nadie entró todavía");
  });

  it("una sola cuenta, en singular", () => {
    expect(renderToStaticMarkup(<CreateDone count={1} cardsHref="/t" homeHref="/h" />)).toContain("Lista la cuenta");
  });
});
