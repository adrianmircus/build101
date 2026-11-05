# Revisión de Codex · spec de la landing · ronda 1

Fecha: 04/11/2026. Revisó `docs/LANDING.md` v1 contra el código. **Veredicto: requiere otra ronda.**

Los hallazgos altos se verificaron en el código antes de aplicarlos. Todos se resolvieron en la v2 del spec (ver la columna *Arreglo en v2*).

| # | Sev. | Hallazgo | Evidencia | Arreglo en v2 |
|---|---|---|---|---|
| 1 | Alta | "Nunca los nombres" no está garantizado: los PDF, las fotos y el dictado llegan completos al modelo | `app/api/assessments/read-pdf/route.ts:21`, `lib/agent/exercises.ts:49`, `lib/agent/transcribe.ts:43` | FAQ 3 dice lo que se cumple hoy. La anonimización de archivos queda como promesa [P] |
| 2 | Alta | "Mismos ejercicios y números" contradice al agente: la mirada y el dictado se quedan con algunos ejercicios, y los apoyos pueden simplificar números | `lib/agent/prompt.ts:34,41,51,59` | Frase que se ilumina y FAQ 2 reescritas |
| 3 | Alta | El control de números excluye la mirada, el dictado y `numeros_simples`, y compara conjuntos de números | `lib/groups/numberCheck.ts:11,17,25` | FAQ 1 acotada |
| 4 | Alta | "Cada una con su fuente": Motriz y Disgrafía no tienen fuentes, y la tematización por gustos no cita ninguna | `data/profiles/motor.md:10`, `dysgraphia.md:10`, `lib/agent/prompt.ts:30` | Las fuentes valen solo para TDAH, dislexia y TEA, en todos los textos |
| 5 | Media | Imprimir o exportar a PDF solo se puede con las versiones escritas | `components/assessments/AssessmentDetail.tsx:77,479,498` | FAQ 7 corregida |
| 6 | Media | No se conserva el encabezado original. Solo la interfaz garantiza que no se muestre la etiqueta | `lib/agent/exercises.ts:19`, `components/student/MyAssignments.tsx:28` | FAQ 6 y *Sin etiquetas* hablan de la interfaz. La regla general en el prompt queda como [P] |
| 7 | Media | Las preguntas guía no corresponden a perfiles solos (TDAH y TEA prohíben pistas) | `data/profiles/adhd.md:12`, `asd.md:12`, `lib/agent/prompt.ts:47` | El ejemplo no muestra preguntas guía. Se definió qué debería verse en cada perfil |
| 8 | Media | El generador tiene destino fijo y sobrescribe el dato de la demo | `scripts/demo-fixture.ts:13,16,30` | Dos modos, con verificación de que la demo no cambia |
| 9 | Alta | El 30% inicial de la frase que se ilumina da cerca de 2,65:1 sobre `indigo-950` | `app/globals.css:232` (borrador) | Arranca en 40% (cerca de 3,6:1), con medición |
| 10 | Media | Las secciones quedan invisibles si falla el JS o con movimiento reducido; `(scripting: enabled)` no alcanza | `components/landing/Reveal.tsx:10` | Visibles por defecto: solo el componente las oculta, ya montado. Con movimiento reducido no se ocultan |
| 11 | Media | El contrato accesible del probador está incompleto | spec v1 | Contrato detallado y pruebas propias |
| 12 | Media | `MathBackdrop` anima sin parar con curvas `linear` y `ease-in-out` | `components/auth/MathBackdrop.tsx:38,56`, `app/globals.css:190,197` | Variante quieta para la landing |
| 13 | Media | El audio no tiene controles definidos y el dictado depende del navegador | `components/solve/DictationAnswer.tsx:115` | `<audio controls>` con transcripción. La FAQ aclara el navegador |
| 14 | Media | Diferencias con `docs/DEMO.md` y una prueba de regresión incompleta | `docs/DEMO.md:22,167` | Se aclara qué parte de DEMO reemplaza y se suman sus pruebas |
| 15 | Media | Faltan el origen público (`metadataBase`, WhatsApp) y el alcance de la medición | `generate-metadata.md:393` | Nueva pregunta abierta. La v1 mide solo el clic |
| 16 | Media | Faltan pruebas de publicación: build, metadata, imagen OG con Lexend, 404 | `opengraph-image.md:139` | Sumadas a *Cómo se verifica* |
| 17 | Baja | Con raíz de 18 px, la escala de espaciado no mide los píxeles de la skill. Faltan altos de pantalla y zoom | `node_modules/tailwindcss/theme.css:325` | Se adoptan los pasos relativos. Pruebas a 390 × 844, zoom al 200% y con lector de pantalla |

## Ronda 2 (incompleta)
Codex se cortó antes de terminar: *Unable to verify model access right now*. Antes de cortarse marcó dos puntos, que Claude verificó en `lib/groups/numberCheck.ts:17-26` y `lib/agent/prompt.ts:34-47` y corrigió en la v2:
- **FAQ 1** decía "te avisa si alguno cambió". El control solo detecta números que faltan (o que sobran, si no hay apoyos), y no revisa la matemática.
- **FAQ 2 y la frase que se ilumina** decían que lo que se evalúa no cambia. Con la mirada o el dictado se evalúa una parte del práctico, y los apoyos hacen la versión más guiada.

## Ronda 2 (completa)
Fecha: 04/11/2026. **Veredicto: aprobado con cambios.** Hay 16 de 17 hallazgos resueltos. Los cambios que pidió se aplicaron:

| # | Sev. | Hallazgo | Arreglo |
|---|---|---|---|
| R1-3 | Alta | FAQ 1 todavía generalizaba el control de números a todas las versiones escritas (`lib/groups/numberCheck.ts:11,17,25`) | Acotada a las versiones escritas que mantienen los datos, por ejercicio |
| N1 | Media | *Con respaldo*: "el agente solo aplica lo que dicen esas fuentes" era demasiado absoluto (`lib/agent/prompt.ts:30,47,53`) | "Se basa en esas guías", con gustos y apoyos como cambios aparte |
| N2 | Baja | Los apoyos también separan versiones (`lib/groups/versions.ts:17`) | "Una versión por cada combinación de perfiles y apoyos" |
| N3 | Media | Sin JS, el probador invitaba a la demo, que necesita JS y no tiene Dislexia ni TEA | Se quitó la invitación |
| N4 | Baja | `metadataBase` no aparece en el HTML: aparecen las URLs que arma | La prueba revisa `og:image` y las URLs absolutas |

## Respaldado en la ronda 1
Respaldado sin hallazgos: lectura en voz alta con fórmulas, subida de PDF y fotos, E1 y E2 en el análisis, resolver en pantalla, dictado, gustos que tematizan problemas con contexto, `/demo` como `<a>` común y cookies `session` y `tiza-demo`. La calibración y el modo práctica con el mouse los verificó Claude en `components/student/gaze/GazeSession.tsx:16,24`.
