import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/landing/LegalPage";

export const metadata: Metadata = { title: "Privacidad" };

// Draft written from what the code does (docs/LANDING.md). Producto reviews it, ideally with someone who knows
// Uruguay's Ley 18.331. If the app's data handling changes, this text changes with it.
const SECTIONS: LegalSection[] = [
  {
    title: "Dónde quedan tus datos",
    paragraphs: [
      "Los grupos, los estudiantes (con sus perfiles y gustos), los prácticos y las correcciones que cargás se guardan en el navegador de tu dispositivo. No los guardamos en nuestros servidores: si borrás los datos del navegador, se borran.",
      "Tiza.ai está en etapa de prueba y el ingreso usa cuentas de demostración.",
    ],
  },
  {
    title: "Qué le llega a la IA",
    paragraphs: [
      "Para armar las versiones, le mandamos a la IA los ejercicios (o el PDF o las fotos que subís), los perfiles y los gustos. Los nombres de la lista del grupo no le llegan nunca. Si subís un PDF o fotos, la IA los lee completos: conviene que no tengan datos personales.",
      "Para el análisis de resultados le llegan solo las correcciones, con cada estudiante como E1, E2 y así. Si cargás el programa de tu materia, el PDF también se manda a la IA.",
      "Cuando un estudiante responde dictando, el texto de lo que dijo se manda a la IA para escribirlo en notación matemática.",
      "La IA es Claude, de Anthropic, a la que accedemos directamente o a través de OpenRouter.",
    ],
  },
  {
    title: "Voz y cámara",
    paragraphs: [
      "La lectura en voz alta manda el texto del ejercicio a ElevenLabs. Si no está disponible, lo lee la voz de tu navegador, sin salir de tu dispositivo.",
      "El dictado usa el reconocimiento de voz del navegador. En Chrome y Edge, el audio lo procesa el proveedor del navegador.",
      "Para responder con la mirada, la imagen de la cámara se procesa en la computadora del estudiante. El video no se manda a ningún lado.",
    ],
  },
  {
    title: "Cookies",
    paragraphs: [
      "Usamos dos cookies funcionales: una para mantener la sesión y otra que marca cuando estás en la demo. No usamos cookies de analítica ni de publicidad.",
    ],
  },
  {
    title: "Tus derechos",
    paragraphs: [
      "Podés pedirnos acceder a tus datos, corregirlos o borrarlos escribiendo a hola@usetiza.app. Como la mayoría de los datos quedan en tu navegador, también podés borrarlos vos desde ahí.",
    ],
  },
];

export default function Privacy() {
  return <LegalPage title="Privacidad" updated="Actualizada el 4 de noviembre de 2026" sections={SECTIONS} />;
}
