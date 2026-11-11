import "server-only";
import type { z } from "zod";

// Spanish messages for zod's default issues. zod resolves a message as: the schema's own message
// first, then the error map passed to parse, then the locale. Passing this map to safeParse therefore
// only ever replaces the English defaults, and a message written in a schema is never touched.
// Messages never echo the input: it can be personal data.

type RawIssue = Parameters<z.core.$ZodErrorMap>[0];

const UNIT: Record<string, string> = { string: "caracteres", array: "elementos", set: "elementos" };

function size(issue: RawIssue): string | undefined {
  if (issue.code !== "too_small" && issue.code !== "too_big") return undefined;
  const small = issue.code === "too_small";
  const limit = small ? issue.minimum : issue.maximum;
  const unit = UNIT[issue.origin];
  if (unit === undefined) return `El valor tiene que ser ${small ? "mayor" : "menor"}${issue.inclusive === false ? "" : " o igual"} a ${limit}.`;
  if (issue.exact === true) return `Tiene que tener exactamente ${limit} ${unit}.`;
  return `Tiene que tener ${small ? "al menos" : "como máximo"} ${limit} ${unit}.`;
}

const FIXED: Partial<Record<RawIssue["code"], string>> = {
  invalid_format: "El formato no es válido.",
  invalid_value: "Elegí una de las opciones disponibles.",
  not_multiple_of: "El número no es válido.",
  unrecognized_keys: "Hay datos que no esperábamos.",
  invalid_union: "El dato no es válido.",
  invalid_key: "El dato no es válido.",
  invalid_element: "El dato no es válido.",
  custom: "El dato no es válido.",
};

export function spanishIssueMessage(issue: RawIssue): string | undefined {
  if (issue.code === "too_small" || issue.code === "too_big") return size(issue);
  if (issue.code === "invalid_type") return issue.input === undefined ? "Este dato es obligatorio." : "Este dato no tiene el formato esperado.";
  return FIXED[issue.code];
}
