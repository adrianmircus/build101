# Dyslexia

<!--
BORRADOR. El agente NO lo usa. Lo escribió una sesión de Claude el 17/10/2026 a partir de la investigación del equipo
(side-session-notes: poblacion2-dislexia.md, transversales.md, revision-codex.md).
Revisalo contra las fuentes y aprobalo copiándolo a data/profiles/dyslexia.md (borrá este bloque de comentario al copiarlo).

PARA EL REVISOR (Producto)
- Qué es: 10 adaptaciones del TEXTO de un práctico o parcial escrito de matemática para un estudiante con dislexia.
  Todas son de acceso (cambian cómo se presenta la consigna), no modificaciones (no cambian qué se evalúa).
- Citas: un subagente abrió cada documento y copió las citas del texto. Ofqual es la versión final de 2022 (Ofqual Handbook,
  sección D), no el borrador de la consulta de 2021 que figuraba en la investigación.
- Evidencia, honesta: casi todo es consenso de guías (Ofqual, BDA) y normativa (Madrid, Argentina), no ensayos.
  No encontramos estudios que prueben que segmentar enunciados mejore el puntaje en matemática de estudiantes con dislexia.
  Lo empírico que sí existe (espaciado, tipografía, lectura en voz alta) es de formato o de canal: lo resuelve la plataforma.
- Lo que se ve en la demo: cada tarea en su oración, empezando por lo que hay que hacer; una oración por renglón;
  el contexto separado de la pregunta; negrita en lugar de MAYÚSCULAS o subrayado; palabras no matemáticas raras explicadas.
- Qué revisar en especial:
  1. "Empezá por el verbo": ninguna fuente lo dice textual. Es nuestra forma concreta de aplicar dos reglas de Ofqual
     (cada tarea en su propia oración; la oración más importante primero). Si preferís no tenerla, borrá esa línea.
  2. Separar contexto y pregunta: la revisión de Codex (punto 16) advierte que reordenar puede resolver parte del problema.
     Por eso solo se separa la pregunta en su propio renglón y los datos quedan en el orden original.
  3. Vocabulario: solo se explican palabras NO matemáticas. Explicar "despejar" o "proporcional" puede dar el procedimiento.
     No se resaltan "cada" o "el doble de": la negrita ahí funciona como pista (Codex, punto 17).
- Fuera del texto (no van acá; los resuelve la plataforma o el profe): tipografía sin serifa común y espaciado moderado
  (BDA 2023; WCAG 1.4.12; Zorzi et al. 2012), sin fuentes "para dislexia" (Kuster et al. 2018; Wery y Diliberto 2017),
  botón "Escuchar" (Ley 27.306 art. 6 a; efecto chico en matemática, +0,13 DE según Buzick y Stone 2014), más tiempo
  (Ley 27.306 art. 6 b; evidencia inconclusa según Lovett 2010) y no penalizar la ortografía al corregir (Madrid 2023).
- Descartado: fondos de color o superposiciones (Griffiths et al. 2016: sin respaldo); OpenDyslexic, aunque Madrid la
  recomienda (Kuster et al. 2018: sin ventaja); esquemas por tipo de problema (son ayuda de enseñanza, no de acceso).
-->

## Adaptaciones

### Regla general
- Solo cambia cómo se presenta la consigna. Mismos ejercicios, números, unidades, condiciones, vocabulario matemático y dificultad. Si leer un texto complejo es parte de lo que se evalúa, queda igual. (Fuente: [F1], "Validity – the overarching principle": "An assessment task should only measure what it is intended to measure.")

### Enunciado
- Partí cada enunciado largo en oraciones cortas, con una sola idea por oración. No saques ni cambies ningún dato, número, unidad, condición ni relación. (Fuente: [F3], p. 3: "Se recomienda que los enunciados sean cortos y si no es posible, segmentar el enunciado en varias partes."; [F1], "Sentence structures": "use just one clause or idea per sentence, with each task expressed in a separate sentence or question")
- Escribí cada tarea como una oración aparte que empiece por lo que hay que hacer, con el verbo en imperativo rioplatense: "Calculá…", "Resolvé…", "Hallá…". Usá el mismo verbo que el original (si dice "justificar", queda "Justificá"). (Fuente: [F1], "Sentence structures": "where sentences do not describe sequential actions, consider giving the most important sentence first"; [F2], "Writing Style", p. 3: "Give instructions clearly.")
- Escribí en voz activa y de forma directa. Sacá las dobles negaciones y las preguntas negativas. Si la negación es parte de la matemática ("un número que no es múltiplo de 3"), queda igual. (Fuente: [F2], "Writing Style", p. 3: "Use active rather than passive voice." y "Avoid double negatives."; [F3], p. 3: "evitar preguntas negativas, con doble dilema o ambiguas")
- Si aparece una palabra NO matemática poco común, cambiala por una común o explicala entre paréntesis la primera vez. Las abreviaturas van completas la primera vez. Las palabras matemáticas del curso ("ecuación", "denominador", "cada", "el doble de", "al menos") quedan tal cual y no se explican ni se resaltan. (Fuente: [F1], "Language": "use words that are commonly understood"; [F2], página web: "Avoid abbreviations where possible; always provide the expanded form when first used."; [F5], p. 49: "Avoid teaching key words that link specific words to operations.")

### Formato visual
- Para destacar usá **negrita**. No uses subrayado, ni itálica en el texto común, ni MAYÚSCULAS sostenidas. Las variables matemáticas quedan como en el original. (Fuente: [F2], "Readable fonts", p. 1: "Avoid underlining and italics as this can make the text appear to run together and cause crowding. Use bold for emphasis." y "Avoid using all capital letters and uppercase letters for continuous text.")
- Una oración por renglón y listas numeradas o con viñetas en lugar de párrafos largos. Una sola columna. (Fuente: [F2], "Writing Style", p. 3: "Consider using bullet points and numbering rather than continuous prose."; [F2], "Layout", p. 3: "Avoid multiple columns (as used in newspapers).")

### Estructura
- Separá el contexto de la pregunta: la información de la situación va en su propio párrafo y la pregunta va sola en su renglón. Los datos quedan en el mismo orden que en el original. (Fuente: [F1], "Sentence structures": "put any background information to the task or question in a separate sentence or paragraph")
- Numeración simple: 1, 2, 3 para ejercicios y a, b, c para incisos. Nada de "1(a). i". (Fuente: [F1], "Layout": "use of numbers, letters and roman numerals together, such as '1(a). i', can lead to translation errors in 'text to speech' software")
- Cada ejercicio en su propio bloque, con una línea en blanco antes del siguiente. No pidas copiar el enunciado. (Fuente: [F1], "Layout": "consider using white space between blocks of text and images"; [F4], art. 6 e: "Evitar copiados extensos y/o dictados")

### Instrucciones
- El encabezado y el título quedan iguales que en el original: no escribas en el práctico que es una versión para dislexia. (Fuente: [F3], p. 3: "Los miembros de los tribunales deberán preservar en todo momento el anonimato de estos estudiantes")

## Fuentes
- [F1] Ofqual (2022). Guidance for designing and developing accessible assessments. Ofqual Handbook, Section D – General requirements for regulated qualifications. https://www.gov.uk/guidance/ofqual-handbook/section-d-general-requirements-for-regulated-qualifications
- [F2] British Dyslexia Association (2023). Dyslexia Style Guide 2023. Leída vía Wayback Machine (páginas del PDF): https://web.archive.org/web/20250105092608/https://www.bdadyslexia.org.uk/advice/employers/creating-a-dyslexia-friendly-workplace/dyslexia-friendly-style-guide
- [F3] Comunidad de Madrid, Dirección General de Universidades y Enseñanzas Artísticas Superiores (2023). Resolución por la que se establecen medidas y adaptaciones para los alumnos con dislexia en las pruebas de evaluación para el acceso a la universidad, 27/04/2023 (páginas del PDF). https://www.uc3m.es/pruebasacceso/media/pruebasacceso/doc/archivo/doc_resolucion-dislexia/resolucion-dislexia---dgueas---adaptacion-2023---firmada---27-04-2023.pdf
- [F4] Argentina, Ley 27.306 (2016), Dificultades Específicas del Aprendizaje, art. 6. Boletín Oficial, 04/11/2016. https://www.boletinoficial.gob.ar/detalleAviso/primera/153296/20161104
- [F5] Fuchs, L. S., Newman-Gonchar, R., Schumacher, R., et al. (2021). Assisting Students Struggling with Mathematics: Intervention in the Elementary Grades (WWC 2021006). NCEE, IES, U.S. Department of Education. https://ies.ed.gov/ncee/WWC/Docs/PracticeGuide/WWC2021006-Math-PG.pdf
