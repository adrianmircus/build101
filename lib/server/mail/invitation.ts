import "server-only";
import type { InvitedRole } from "@/lib/domain/identity/entities";
import type { InvitationMailInput, MailMessage } from "./types";

// The mail of an invitation (docs/contratos/fase-2.md, «Correos de invitación»), in Rioplatense Spanish. The only thing in it
// that grants anything is the link, and its token is in the fragment. Names are text, never markup.

const ROLE_TEXT: Record<InvitedRole, string> = {
  admin: "administración de la institución",
  teacher: "docente",
  inclusion: "equipo de inclusión",
};

/** A name or a text for a header or a line: no line breaks (a header with one is an injection) and no stray spaces. */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function dayOf(expiresAt: string): string {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "dentro de unos días";
  return `el ${date.toLocaleDateString("es-UY", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Montevideo" })}`;
}

function sentence(input: InvitationMailInput): string {
  const institution = oneLine(input.institutionName);
  const who = input.inviterName === null ? "Te invitaron" : `${oneLine(input.inviterName)} te invitó`;
  return `${who} a sumarte a ${institution} en Tiza, como ${ROLE_TEXT[input.role]}.`;
}

export function invitationMail(input: InvitationMailInput): MailMessage {
  const lead = sentence(input);
  const day = dayOf(input.expiresAt);
  const text = [
    "Hola,",
    "",
    lead,
    "",
    "Para aceptar la invitación, abrí este enlace:",
    input.link,
    "",
    `La invitación vence ${day}. Si no la esperabas, ignorá este correo: no pasa nada si no la aceptás.`,
  ].join("\n");
  const html = [
    "<p>Hola,</p>",
    `<p>${escapeHtml(lead)}</p>`,
    `<p><a href="${escapeHtml(input.link)}">Aceptar la invitación</a></p>`,
    `<p>Si el botón no abre, copiá este enlace en el navegador:<br>${escapeHtml(input.link)}</p>`,
    `<p>La invitación vence ${escapeHtml(day)}. Si no la esperabas, ignorá este correo: no pasa nada si no la aceptás.</p>`,
  ].join("\n");
  return { to: input.to, subject: `Te invitaron a ${oneLine(input.institutionName)} en Tiza`, text, html };
}
