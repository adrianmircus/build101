@AGENTS.md

# Tiza.ai

Prácticos y parciales de ciencias exactas de bachillerato adaptados a cada estudiante. Hoy cubre Matemática; Física y Química son las próximas. El profe sube el práctico que ya tiene y la IA arma una versión por cada combinación de perfiles del grupo: TDAH, dislexia, TEA, motriz (responde con la mirada) y disgrafía (responde dictando). El profe revisa y aprueba cada versión, el estudiante la resuelve en la plataforma y el profe corrige.

## Dónde estamos
Tiza.ai nació en build 101, el hackathon de IA de FIUM/LATU de octubre de 2026, donde salió **tercero**. Desde entonces nos contactan inversores e instituciones para seguir adelante. El objetivo ahora es ampliar el producto y construir las mejoras necesarias para ofrecerlo a **colegios e instituciones educativas**.

El código todavía arrastra decisiones de hackathon: los datos viven en el `localStorage` del navegador, el login es simulado y las cuentas de demo están en el código. Se van reemplazando por versiones de producción en pasos chicos, sin romper lo que ya anda.

**Plan a marzo de 2027** (detalle en `docs/ROADMAP.md`): la plataforma se centra solo en ciencias exactas y llega al piloto con un motor que aprende de cada estudiante. Las piezas son:
- **Motor que aprende:** un perfil de preferencias por estudiante, guardado como datos (no un modelo entrenado por estudiante). Aprende del feedback del profe, del estudiante y del uso, y elige qué adaptaciones aplicar entre opciones validadas.
- **Una versión por estudiante:** la prueba deja de armarse por combinación de perfiles y pasa a armarse por estudiante.
- **Gamificación:** estrellas y refuerzo positivo para el estudiante.
- **Práctica periódica:** prácticas cortas generadas por el sistema para reforzar los temas flojos de cada estudiante.
- **Agente investigador:** busca evidencia en internet y propone cambios a los perfiles, que aprueba un especialista.
- **Evolución del estudiante:** una vista para el profe con los avances de cada estudiante y cada decisión de la IA, con su porqué.

Qué cambia al escribir código:
- Pensar en varias instituciones, varios profes y muchos grupos, no en un solo navegador.
- Los datos son de menores y los perfiles son datos de salud (datos sensibles según la Ley 18.331 de Uruguay). Pedir y guardar lo mínimo, autorizar en el servidor, no dejar nada sensible en logs ni en el navegador del estudiante, y nunca mandarle nombres a la IA.
- La IA cuesta plata y puede fallar. Cada llamada tiene un plazo, se puede cancelar y registra los tokens que usó (`lib/agent/client.ts`). Lo que no es urgente (práctica periódica, investigación) va en lote y fuera de hora.
- El feedback es la materia prima del motor: no se pierde. Hay que guardar lo que generó la IA junto con lo que cambió el profe, la aprobación o el rechazo con motivo, el feedback del estudiante y las señales de uso. Todo pseudonimizado.
- Lo aprendido de cada estudiante (preferencias, dominio por tema) es un dato personal: se puede auditar, explicar al profe y borrar si se pide.
- La materia es un parámetro (programa, prompt, notación, errores, verificador de números). No se escribe "matemática" fijo en el código nuevo.
- La demo guiada («Probar la demo», `/demo`) es la vidriera para colegios e inversores: no se rompe.

## Principios del producto
- La IA hace el trabajo y el profe aprueba todo lo que llega al estudiante. Toda acción con efecto real (publicar, enviar, calificar) lleva aprobación humana visible.
- No inventar pedagogía. Las adaptaciones salen solo de `data/profiles/<id>.md`, que el equipo valida con especialistas. Si un perfil no tiene datos, no se adapta y se avisa. El motor elige entre esas opciones, nunca crea nuevas. Cambia la presentación y el apoyo, no lo que se evalúa.
- La IA no busca en internet mientras genera algo para un estudiante. La búsqueda la hace el agente investigador aparte: solo en sitios permitidos, sin ningún dato de estudiantes, y lo que encuentra es un borrador hasta que lo aprueba un especialista.
- El estudiante nunca ve su perfil, ni nada que permita deducirlo (la gamificación y el feedback se ven igual para todos).
- Gamificación con refuerzo positivo:
  - se premia el esfuerzo y el progreso, no solo el acierto
  - un error muestra un estado neutro y alentador, no una cara triste
  - no hay rankings entre compañeros
  - las estrellas no cuentan para la nota
- La práctica periódica se corrige sola y no lleva nota. El profe aprueba el plan semanal de cada grupo, y las variantes nuevas que genera la IA las revisa antes de que lleguen al estudiante.
- La plataforma es accesible: WCAG 2.2 AA como piso (teclado, lector de pantalla, contraste, baja carga cognitiva).
- La UI y los textos van en español rioplatense.

## Stack
- Next.js 16 (App Router, Cache Components, Turbopack), React 19, TypeScript y Tailwind 4. Esta versión de Next.js trae cambios: ante la duda, revisar `node_modules/next/dist/docs/`.
- IA: API de Claude con `@anthropic-ai/sdk` y el modelo `claude-opus-5-5`. Usa salida estructurada con zod y respaldo por OpenRouter (`lib/agent/client.ts`). Ante cualquier duda de la API, usar la skill `claude-api`; no adivinar parámetros.
- Voz: Web Speech API para dictar y ElevenLabs para leer en voz alta. Mirada: MediaPipe, 100 % en el navegador.

## Estructura y dueños
| Área | Carpetas |
|---|---|
| Front | `app/` (páginas), `components/` |
| IA y backend | `app/api/`, `lib/agent/`, `data/` |
| Contrato front↔IA | `lib/contract.ts`: es **compartido**. Los cambios son aditivos y se avisan al otro lado. |
| Producto | `docs/` |

El plan actual es `docs/ROADMAP.md`. `docs/PLAN.md` y `docs/IDEAS.md` son del hackathon: sirven como historia, no como plan actual.

## Reglas
- Antes de pushear: `npm run check` (tipos con las reglas estrictas del código nuevo, lint, pruebas, build y Playwright).
- No romper los flujos principales (el profe sube y adapta, aprueba, el estudiante resuelve, el profe corrige) ni la demo guiada. Se puede refactorizar, en pasos chicos y verificados.
- Ningún secreto en el código: las claves van en variables de entorno.
