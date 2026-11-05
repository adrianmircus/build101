import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/landing/LegalPage";

export const metadata: Metadata = { title: "Términos" };

// Draft for Producto to review (docs/LANDING.md). Plain terms for a product in its trial stage.
const SECTIONS: LegalSection[] = [
  {
    title: "Qué es Tiza.ai",
    paragraphs: [
      "Tiza.ai ayuda a docentes a armar versiones de sus prácticos y parciales de matemática para estudiantes con distintos perfiles. Está en etapa de prueba: puede cambiar, tener errores o dejar de estar disponible.",
    ],
  },
  {
    title: "La última palabra es del docente",
    paragraphs: [
      "Las versiones las arma una IA, que puede equivocarse. Cada versión tiene que revisarla y aprobarla el docente antes de que llegue a un estudiante. Tiza.ai no reemplaza el criterio del docente ni la indicación de un profesional de la salud o de la educación.",
    ],
  },
  {
    title: "Tu contenido",
    paragraphs: [
      "Los prácticos y los datos que cargás siguen siendo tuyos. Cargá solo contenido que tengas derecho a usar, y evitá datos personales en los archivos que subís.",
    ],
  },
  {
    title: "Uso aceptable",
    paragraphs: [
      "No uses Tiza.ai para fines distintos de la enseñanza, ni intentes acceder a datos de otras personas o afectar el funcionamiento del servicio.",
    ],
  },
  {
    title: "Cambios y contacto",
    paragraphs: [
      "Si cambiamos estos términos, lo avisamos en esta página. Para cualquier consulta, escribinos a hola@usetiza.app. Se rigen por las leyes de la República Oriental del Uruguay.",
    ],
  },
];

export default function Terms() {
  return <LegalPage title="Términos" updated="Actualizados el 4 de noviembre de 2026" sections={SECTIONS} />;
}
