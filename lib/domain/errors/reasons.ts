import type { ErrorCode } from "@/lib/errors";

// The user-facing text of every error an RPC can raise. SQL raises a code and a reason key
// (app.raise_error); the Spanish text lives only here. A reason that is not listed falls back to
// its code's default, so a new reason in SQL never shows raw text, and SQL never builds a message.

export const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  NOT_FOUND: "No encontramos lo que buscabas. Puede que lo hayan archivado o que no tengas acceso.",
  FORBIDDEN: "No tenés permiso para hacer esto.",
  INVALID: "Revisá los datos marcados.",
  CONFLICT: "Alguien cambió esto mientras lo editabas. Recargá para ver lo último.",
  RATE_LIMITED: "Hiciste muchos intentos seguidos. Esperá un rato y probá de nuevo.",
  UNAVAILABLE: "Esto todavía no está disponible. Probá de nuevo más tarde.",
};

export const REASON_MESSAGES: Record<string, string> = {
  not_implemented: "Esto todavía no está disponible.",
  no_session: "Tu sesión terminó. Volvé a entrar.",
  not_found: DEFAULT_MESSAGES.NOT_FOUND,
  revision_required: "Recargá la página y volvé a intentar.",
  revision_mismatch: DEFAULT_MESSAGES.CONFLICT,
  archived: "Está archivado. Restauralo para cambiarlo.",
  sandbox_restricted: "En la demo no se puede hacer esto.",
  username_taken: "Ese usuario ya existe en la institución. Elegí otro.",
  already_enrolled: "Ya está en el grupo.",
  not_enrolled: "No está en el grupo.",
  not_a_member: "Esa persona no es parte de la institución.",
  role_conflict: "Una persona no puede ser estudiante y docente de la misma institución.",
  invalid_name: "Escribí un nombre.",
  invalid_username: "El usuario no es válido. Usá de 2 a 40 letras minúsculas, números, puntos, guiones o guiones bajos.",
  invalid_op_key: "Falta el identificador de la acción. Recargá la página y probá de nuevo.",
  invalid_page: "La página que pediste no es válida. Recargá la lista.",
  unknown_profile: "Ese perfil no está validado todavía.",
  unknown_support: "Ese apoyo no está validado todavía.",
  op_key_reused: "Esta acción ya se usó para otra cosa. Recargá y probá de nuevo.",
  not_approved: "Primero hay que aprobar esta versión.",
  stale_answer_key: "La clave quedó desactualizada. Regenerala o confirmala antes de publicar.",
  missing_questions: "Faltan las preguntas para responder con la mirada.",
  missing_consent: "Falta el consentimiento de algún estudiante.",
  not_published: "Esta tarea todavía no está disponible.",
  attempt_closed: "Esta tarea ya no se puede cambiar.",
  attempt_not_started: "Empezá la tarea antes de guardar.",
  already_submitted: "Ya entregaste esta tarea.",
  draft_outdated: "Hay una versión más nueva de tus respuestas. Revisala antes de entregar.",
  unknown_exercise: "Hay respuestas que no corresponden a esta tarea.",
  not_submitted: "Todavía no hay una entrega para corregir.",
  content_incomplete: "Faltan ejercicios por completar en esta versión.",
  unknown_option: "La respuesta correcta tiene que ser una de las opciones.",
  correct_option_removed: "No se puede sacar la opción correcta. Cambiá primero la respuesta correcta.",
  options_repeated: "Hay opciones repetidas.",
};

export function messageFor(code: ErrorCode, reason: string | undefined): string {
  if (reason !== undefined && Object.hasOwn(REASON_MESSAGES, reason)) {
    return REASON_MESSAGES[reason] ?? DEFAULT_MESSAGES[code];
  }
  return DEFAULT_MESSAGES[code];
}
