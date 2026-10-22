import type { Role } from "@/lib/auth/signing";
import type { Assessment, Data } from "@/lib/groups/types";
import { GAZE_PROFILE } from "@/lib/profiles";
import { DEMO_GROUP_ID } from "./example";

// The demo's tour, as data. Each step highlights an element marked with data-tour="<anchor>" and moves on when
// the visitor does the real thing (done) or, on info steps, taps the button.

export const STAGES = ["Tu grupo", "El práctico", "Tu revisión", "Lo que ve Paula"] as const;

export type TourContext = { pathname: string; data: Data | null };

export type Step = {
  id: string;
  stage: number;
  // Where the step happens. Anywhere else, the tour offers to go back.
  route: RegExp;
  // Where "Volver al recorrido" goes, and as whom.
  back: (data: Data | null) => { role: Role; href: string };
  anchor?: string;
  // action: only the highlighted element responds. info: nothing is blocked. center: no element, the bubble in the middle.
  kind: "action" | "info" | "center";
  title: string;
  // *text* is the exact name of what to tap; it's shown in italics.
  body: string;
  // The bubble's button. Without it the step waits for done (or a click on the anchor, with doneOnClick).
  next?: string;
  done?: (context: TourContext) => boolean;
  doneOnClick?: boolean;
  // Instead of moving on, the button switches to Paula's side.
  viewAsStudent?: boolean;
};

const BASE = `/grupos/${DEMO_GROUP_ID}`;
const NEW = `${BASE}/evaluaciones/nueva`;
const DETAIL = new RegExp(`^${BASE}/evaluaciones/(?!nueva$)[^/]+$`);

// The demo's latest worksheet: the one the tour just created.
export function latestDemoAssessment(data: Data | null): Assessment | undefined {
  return data?.assessments
    .filter((a) => a.groupId === DEMO_GROUP_ID)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

const teacher = (href: string) => () => ({ role: "teacher" as const, href });
const toDetail = (data: Data | null) => {
  const latest = latestDemoAssessment(data);
  return { role: "teacher" as const, href: latest ? `${BASE}/evaluaciones/${latest.id}` : NEW };
};

export const STEPS: Step[] = [
  {
    id: "welcome",
    stage: 0,
    route: /^\/grupos$/,
    back: teacher("/grupos"),
    kind: "center",
    title: "Sos profe de matemática de 6.º",
    body: "En tu grupo está Lucas, que tiene TDAH; Paula, que no puede escribir y responde con la mirada, y Tomás, que tiene disgrafía. Vas a darles el mismo práctico, a cada uno a su medida.",
    next: "Empezar",
  },
  {
    id: "group",
    stage: 0,
    route: /^\/grupos$/,
    back: teacher("/grupos"),
    anchor: "group-demo",
    kind: "action",
    title: "Entrá a tu grupo",
    body: "Tocá *Grupo demo*.",
    done: ({ pathname }) => pathname === BASE,
  },
  {
    id: "profiles",
    stage: 0,
    route: new RegExp(`^${BASE}$`),
    back: teacher(BASE),
    anchor: "group-profiles",
    kind: "info",
    title: "Cada estudiante, su perfil",
    body: "Los perfiles los marcás vos una sola vez, junto con los gustos de cada uno. Tiza.ai los usa en cada práctico.",
    next: "Seguir",
  },
  {
    id: "new",
    stage: 1,
    route: new RegExp(`^${BASE}$`),
    back: teacher(BASE),
    anchor: "new-assessment",
    kind: "action",
    title: "Cargá un práctico",
    body: "Tocá *Nuevo práctico o parcial*.",
    done: ({ pathname }) => pathname === NEW,
  },
  {
    id: "original",
    stage: 1,
    route: new RegExp(`^${NEW}$`),
    back: teacher(NEW),
    anchor: "original",
    kind: "info",
    title: "El práctico de siempre",
    body: "Lo subís en PDF o en fotos, o lo escribís. Para la demo ya cargamos uno de límites.",
    next: "Seguir",
  },
  {
    id: "plan",
    stage: 1,
    route: new RegExp(`^${NEW}$`),
    back: teacher(NEW),
    anchor: "versions-plan",
    kind: "info",
    title: "Tres versiones, no una por alumno",
    body: "Tiza.ai arma una versión por cada perfil del grupo. A la IA le llegan los ejercicios, los perfiles y los gustos; nunca los nombres.",
    next: "Seguir",
  },
  {
    id: "generate",
    stage: 1,
    route: new RegExp(`^${NEW}$`),
    back: teacher(NEW),
    anchor: "generate",
    kind: "action",
    title: "Generá las versiones",
    body: "Tocá *Generar 3 versiones*.",
    done: ({ pathname }) => DETAIL.test(pathname),
  },
  {
    id: "generation",
    stage: 2,
    route: DETAIL,
    back: toDetail,
    anchor: "generation",
    kind: "info",
    title: "Un agente por perfil",
    body: "Cada agente reescribe el práctico según lo que dicen las fuentes de su perfil. Los números y lo que se evalúa no cambian.",
    done: ({ data }) =>
      latestDemoAssessment(data)?.versions.every((v) => v.status !== "pending" && v.status !== "generating") ?? false,
  },
  {
    id: "changes",
    stage: 2,
    route: DETAIL,
    back: toDetail,
    anchor: "changes",
    kind: "info",
    title: "Cada cambio, con su porqué",
    body: "Esta es la versión de Lucas. Cada cambio dice por qué se hizo y la fuente que lo respalda. Si algo no te convence, lo editás.",
    next: "Seguir",
  },
  {
    id: "motor",
    stage: 2,
    route: DETAIL,
    back: toDetail,
    anchor: "version-motor",
    kind: "action",
    title: "Ahora, la versión de Paula",
    body: "Tocá *Motriz*.",
    doneOnClick: true,
  },
  {
    id: "questions",
    stage: 2,
    route: DETAIL,
    back: toDetail,
    anchor: "gaze-questions",
    kind: "info",
    title: "Para responder con la mirada",
    body: "Paula no puede escribir: cada ejercicio pasó a dos opciones, una a cada lado de la pantalla. Ves la correcta para revisarla.",
    next: "Seguir",
  },
  {
    id: "approve",
    stage: 2,
    route: DETAIL,
    back: toDetail,
    anchor: "approve",
    kind: "action",
    title: "Sin tu aprobación, no llega",
    body: "Nada le llega a un estudiante si no lo aprobás vos. Tocá *Aprobar y publicar*.",
    done: ({ data }) =>
      latestDemoAssessment(data)?.versions.some((v) => v.profiles.includes(GAZE_PROFILE) && v.approved) ?? false,
  },
  {
    id: "switch",
    stage: 3,
    route: DETAIL,
    back: toDetail,
    kind: "center",
    title: "Ahora, del lado de Paula",
    body: "Vas a entrar como Paula, que ya tiene el práctico que aprobaste. Ella no ve su perfil ni que su versión es distinta.",
    next: "Ver como Paula",
    viewAsStudent: true,
    done: ({ pathname }) => pathname.startsWith("/estudiante"),
  },
  {
    id: "gaze",
    stage: 3,
    route: /^\/estudiante(\/|$)/,
    back: () => ({ role: "student", href: "/estudiante" }),
    anchor: "gaze-intro",
    kind: "info",
    title: "Responder con la mirada",
    body: "La cámara detecta hacia qué mitad de la pantalla mira Paula. Si no querés prenderla, tocá *Practicar sin cámara* y elegí con el mouse.",
    next: "Terminar",
  },
];
