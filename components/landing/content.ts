// The landing's copy (docs/LANDING.md, "Textos"). Producto reviews it there; keep both in sync.
// [P] in the spec marks promises (features not built yet): here they read as the rest of the page.

export const STEPS = [
  {
    title: "Marcás los perfiles de tu grupo",
    body: "TDAH, dislexia, TEA, motriz o disgrafía, y se pueden combinar. Si sumás sus gustos, los problemas con contexto hablan de lo que les interesa.",
  },
  {
    title: "Cargás el práctico como siempre",
    body: "Lo escribís o subís el PDF o unas fotos. Sale una versión por cada combinación de perfiles y apoyos del grupo, no una por alumno.",
  },
  {
    title: "Revisás y aprobás",
    body: "Ves cada cambio con su porqué y editás lo que no te convenza. Sin tu aprobación no llega a nadie.",
  },
];

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://usetiza.app";
const WHATSAPP_TEXT = `Mirá Tiza.ai, arma los prácticos de matemática para cada estudiante: ${SITE_URL}`;
const PILOT_SUBJECT = "Quiero sumar mi colegio al piloto de Tiza.ai";

export type Audience = {
  id: string;
  title: string;
  items: { benefit: string; detail: string }[];
  action?: { text: string; href: string };
};

export const AUDIENCES: Audience[] = [
  {
    id: "profes",
    title: "Para profes",
    items: [
      { benefit: "Un práctico, todas las versiones.", detail: "Lo cargás una vez y salen las versiones que tu grupo necesita." },
      { benefit: "La última palabra es tuya.", detail: "Cada cambio viene explicado y aprobás versión por versión." },
      { benefit: "Ves dónde se trabó cada uno.", detail: "Cargás la corrección por ejercicio y el análisis te marca qué repasar." },
    ],
  },
  {
    id: "colegios",
    title: "Para colegios",
    items: [
      {
        benefit: "Un perfil, todos sus profes.",
        detail: "El equipo de inclusión carga el perfil del estudiante una vez y lo usan todos sus profesores.",
      },
      {
        benefit: "Todo el colegio a la vista.",
        detail: "La coordinación ve qué prácticos se adaptaron en cada grupo y quién los aprobó.",
      },
      {
        benefit: "Adaptaciones con respaldo.",
        detail:
          "Las de TDAH, dislexia y TEA salen de guías publicadas, entre ellas el protocolo de educación inclusiva del MEC (Decreto 350/022).",
      },
    ],
    action: {
      text: "Sumar mi colegio al piloto",
      href: `mailto:hola@usetiza.app?subject=${encodeURIComponent(PILOT_SUBJECT)}`,
    },
  },
  {
    id: "familias",
    title: "Para familias",
    items: [
      { benefit: "Lo puede escuchar.", detail: "Con un botón, el práctico se lee en voz alta, fórmulas incluidas." },
      { benefit: "Responde como mejor puede.", detail: "Escribiendo, dictando o con la mirada si tiene una dificultad motriz." },
      { benefit: "Sin etiquetas.", detail: "En su pantalla no aparece el nombre de su perfil." },
      {
        benefit: "Sabés qué tiene para hacer.",
        detail: "Ves los prácticos pendientes de tu hijo o hija y cómo le fue, sin ver los de nadie más.",
      },
    ],
    action: {
      text: "Pasáselo al colegio por WhatsApp",
      href: `https://wa.me/?text=${encodeURIComponent(WHATSAPP_TEXT)}`,
    },
  },
];

// The exact URLs cited in data/profiles/*.md.
export const SOURCES = [
  {
    text: "MEC Uruguay (2022). Protocolo de educación inclusiva, Decreto 350/022",
    href: "https://www.gub.uy/ministerio-educacion-cultura/book/17040/download",
  },
  { text: "CAST (2024). Pautas de Diseño Universal para el Aprendizaje 3.0", href: "https://udlguidelines.cast.org/" },
  {
    text: "Ofqual (2022). Guía para diseñar evaluaciones accesibles",
    href: "https://www.gov.uk/guidance/ofqual-handbook/section-d-general-requirements-for-regulated-qualifications",
  },
  {
    text: "British Dyslexia Association (2023). Dyslexia Style Guide",
    href: "https://web.archive.org/web/20250105092608/https://www.bdadyslexia.org.uk/advice/employers/creating-a-dyslexia-friendly-workplace/dyslexia-friendly-style-guide",
  },
  {
    text: "IFLA (2010). Pautas para materiales de lectura fácil",
    href: "https://repository.ifla.org/rest/api/core/bitstreams/9e8bc5f6-3873-4200-a482-885cfb239722/content",
  },
  {
    text: "Lovett y Nelson (2021). Revisión sistemática de adecuaciones para estudiantes con TDAH",
    href: "https://doi.org/10.1016/j.jaac.2020.07.891",
  },
];

export const FAQ = [
  {
    q: "¿Y si la IA se equivoca?",
    a: "Por eso nada sale sin tu aprobación. Ves cada cambio con su porqué y lo editás si no te convence. En las versiones escritas que mantienen los datos del original, además, un control automático sin IA te avisa si en algún ejercicio falta un número del original. No revisa si la matemática está bien: eso lo revisás vos.",
  },
  {
    q: "¿La versión adaptada es más fácil?",
    a: "Sin apoyos, el nivel es el mismo: cambia la presentación (enunciados más cortos, el verbo resaltado, un bloque por ejercicio). Si el estudiante responde con la mirada o dictando, cambia cómo responde y tiene menos ejercicios, así que se evalúa una parte del práctico. Si vos habilitás apoyos para un estudiante que los necesita, la versión sí es más guiada. Todo eso aparece en la lista de cambios para que lo revises.",
  },
  {
    q: "¿A la IA le llegan datos de mis estudiantes?",
    a: "Los nombres de la lista del grupo no le llegan nunca, y en el análisis de resultados cada estudiante figura como E1, E2 y así. Si subís un PDF o fotos, la IA los lee completos, así que conviene que no tengan datos personales. Pronto los vamos a borrar automáticamente antes de que lleguen a la IA.",
  },
  {
    q: "¿Qué perfiles cubre?",
    a: "TDAH, dislexia, TEA, dificultad motriz (responde con la mirada) y disgrafía (responde dictando). Un estudiante puede tener más de uno.",
  },
  {
    q: "¿Para qué materias y años sirve?",
    a: "Arrancamos con matemática de 6.º de bachillerato, con el programa de Uruguay. Después vienen el resto de los años y otras materias.",
  },
  {
    q: "¿El estudiante ve su diagnóstico?",
    a: "En su pantalla no aparece el nombre de su perfil. Y el texto de su versión tampoco lo menciona.",
  },
  {
    q: "¿Se puede imprimir?",
    a: "Las versiones escritas aprobadas se imprimen o se guardan en PDF desde el navegador. Las de mirada y dictado se resuelven en pantalla, desde la cuenta del estudiante.",
  },
  {
    q: "¿Qué hace falta para responder con la mirada o dictando?",
    a: "Para la mirada, una computadora con cámara: antes de empezar se calibra mirando unos puntos en la pantalla, y hay un modo práctica con el mouse. Para dictar, un navegador con dictado, como Chrome o Edge. Si no lo tiene, puede escribir la respuesta.",
  },
  {
    q: "¿Cómo lo pruebo?",
    a: "Con la demo, sin cuenta y en unos 3 minutos: armás las versiones de un grupo de ejemplo, aprobás una y ves el práctico como lo ve la estudiante. Las versiones de la demo las generó antes el agente de Tiza.ai con ese mismo práctico.",
  },
];
