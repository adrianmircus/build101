# Evolución del estudiante: qué se guarda y qué se calcula

Diseño para la épica M (la vista de evolución para el profe) y para lo que necesita la épica H (el motor que aprende). Es una propuesta: no hay código todavía. El plan general está en `docs/ROADMAP.md`.

## En una página
- Todo lo que pasa con un estudiante queda en un **registro de eventos inmutable**, en el servidor y pseudonimizado. Los eventos no se editan: si el profe corrige una marca, se agrega un evento nuevo.
- Lo demás **se deriva de los eventos** con funciones puras y versionadas: dominio por tema, errores que se repiten, progreso, preferencias del motor e hitos. Nada se carga a mano. Si cambia el algoritmo, se recalcula todo de nuevo.
- Cada hito de la línea de tiempo guarda los ids de los eventos que lo causaron. Su explicación se arma con plantillas sobre esos datos, no la redacta la IA.
- Los eventos nuevos (tiempos, apoyos) **no se guardan en `localStorage`**: esperan al endpoint del servidor (épicas A y D). Mientras tanto, lo que ya existe se lee como eventos con un adaptador, y la demo usa un registro fijo.
- La materia, el tema del programa y el catálogo de errores son datos del evento. Nada dice «matemática».

## 1. Qué se registra

| Qué | De dónde sale hoy | Qué falta para capturarlo |
|---|---|---|
| **Respuesta por ejercicio** | `Submission.answers` y `choices` (`lib/groups/store.ts`): se pisan en cada cambio y quedan fijas al entregar. | Un evento `assessment_submitted` al entregar. El texto de la respuesta se queda en la entrega y el evento lo referencia, sin copiarlo. No se registra cada tecla. |
| **Corrección por ejercicio y error del catálogo** | `exerciseResults` con `status` y `errors` de `ERROR_TAGS` (`lib/results/catalog.ts`). `setExerciseResult` **pisa** la marca anterior. | Un evento `exercise_marked` cada vez que el profe marca. Si corrige, va otro evento y vale el último. Falta el tema del programa de cada ejercicio (tarea de B, todavía pendiente). |
| **Nota** | `grades` (`setGrade`), también se pisa. | Un evento `grade_set`. |
| **Tiempo por ejercicio** | No se mide. `SolveAssessment.tsx` sabe en qué ejercicio está (`current`), pero no lo guarda. | Un evento `exercise_left` al salir de cada ejercicio, con el tiempo activo (sin contar pestaña oculta ni inactividad larga). Es tarea de D. |
| **Abandonos** | No se registran. Tampoco hay fecha de cierre en `Assessment`. | Abandono de ejercicio: `exercise_left` con `answered: false` y sin volver antes de entregar. Abandono de prueba: se **deriva** (abierta, sin entregar al cierre). Hace falta una fecha de cierre opcional (ver preguntas). |
| **Uso de apoyos** | Nada. Están en el código: «Escuchar» (`components/solve/Listen.tsx`, ElevenLabs o voz del navegador), dictado (`DictationAnswer.tsx`), mirada (`components/student/gaze/`), comandos de voz (`VoiceCommands.tsx`). | Contadores por ejercicio dentro de `exercise_left` (cuántas veces escuchó, dictó o reintentó el dictado). El audio nunca se guarda: el navegador ya entrega solo texto. |
| **Feedback del estudiante** | No existe. Lo hace otra sesión en `feat/feedback-estudiante` (épica D), todavía sin mergear. | Un evento `student_feedback` con id de pregunta y respuesta cerrada. **Forma provisoria:** cuando se mergee D, este documento se alinea con el evento que haya definido. |
| **Feedback del profe sobre la versión** | `Version.history` (`lib/groups/history.ts`): `generated`, `edited`, `approved`, `unapproved`, `rejected` con motivo de `lib/feedback/reasons.ts`. | Ya está la forma. Falta pasarlo al servidor (A). Sigue siendo por versión: ver «Choques con el roadmap». |
| **«¿Le sirvió la adaptación?»** | No existe. | Un evento `adaptation_rated` al corregir (tarea de D), con respuesta cerrada. |
| **Práctica periódica** | No existe (épica J). | `practice_attempt` por intento, con el resultado del verificador. |
| **Decisiones del motor** | No existe (épica H). | `knobs_chosen` en cada generación y `preference_changed` cuando cambia lo aprendido, con la evidencia. |
| **Acciones del profe sobre el motor** | No existe (épica M). | `knob_pinned`, `decision_reverted`, `preference_note_reviewed`. |

Lo que **no** se registra:
- teclas, movimientos del mouse ni del ojo;
- audio o video;
- la posición de la mirada (MediaPipe corre en el navegador y de ahí no sale nada);
- texto libre del profe sobre el estudiante dentro del registro: los motivos son de listas cerradas, como `REJECT_REASONS`.

## 2. La forma de los datos

Un solo tipo de evento, inmutable, con campos fijos para filtrar y autorizar y un `data` que depende del tipo. Es solo un ejemplo:

```ts
type EvolutionEvent = {
  id: string;              // UUID v7: ordena por tiempo
  type: EventType;
  schema: 1;               // versión de la forma de `data` para este tipo
  institutionId: string;   // para autorizar y particionar
  studentKey: string;      // seudónimo al azar, no derivado del nombre ni del id
  actor: "student" | "teacher" | "engine" | "system";
  subject: SubjectId;      // materia: "math" | "physics" | "chemistry"
  source: "assessment" | "practice";
  assessmentId?: string;
  versionId?: string;
  exercise?: { id: string; number: number }; // id estable, no el índice en el texto
  unitId?: string;         // tema del programa (SyllabusUnit) del ejercicio
  data: Record<string, unknown>;              // validado con zod según el tipo
  at: string;              // cuándo pasó (reloj del cliente)
  recordedAt: string;      // cuándo llegó (reloj del servidor)
};
```

Ejemplos:

```json
{ "type": "exercise_left", "actor": "student", "subject": "physics", "source": "assessment",
  "assessmentId": "a_81", "versionId": "v_81_2", "exercise": { "id": "ex_7f3", "number": 3 },
  "unitId": "u_cinematica", "at": "2027-03-10T14:02:11Z",
  "data": { "activeMs": 214000, "answered": false, "mode": "voice",
            "supports": { "listen": 2, "dictation": 1, "dictationRetries": 1 } } }
```

```json
{ "type": "exercise_marked", "actor": "teacher", "subject": "physics", "source": "assessment",
  "assessmentId": "a_81", "exercise": { "id": "ex_7f3", "number": 3 }, "unitId": "u_cinematica",
  "at": "2027-03-12T20:15:00Z",
  "data": { "status": "partial", "errors": ["interpretation"], "catalog": "physics@1",
            "reasoningSupports": ["preguntas_guia"] } }
```

```json
{ "type": "preference_changed", "actor": "engine", "subject": "math", "source": "assessment",
  "at": "2027-03-14T09:00:00Z",
  "data": { "knob": "worked_example", "from": "on", "to": "off", "confidence": 0.82,
            "prior": "profile:adhd@3", "evidence": ["evt_0190a…", "evt_0190b…", "evt_0190c…"],
            "algorithm": "bandit-v1" } }
```

Reglas:
- **Inmutable.** No hay `UPDATE`. Una marca corregida es otro `exercise_marked`, y vale el último por ejercicio. La única forma de borrar es el borrado a pedido de la familia (sección 6).
- **Ids estables de ejercicio.** Hoy un ejercicio es su posición en el texto (`exercisesOf`). Si el profe cambia `exerciseCount` o el original, los índices se corren y la historia apunta al ejercicio equivocado. El servidor asigna un id a cada ejercicio al crear la prueba.
- **Ids estables de tema.** Hoy `setPdf` borra las unidades del programa y `setGeneratedUnits` les da ids nuevos (`lib/syllabus/store.ts`). Con eso se pierde el dominio de cada tema. Las unidades necesitan ids estables, con un mapeo cuando el programa cambia.
- **Los eventos de versión siguen por versión.** `VersionEvent` no lleva estudiante, y está bien: la versión ya dice para quién es. La línea de tiempo los cruza con `studentIds`. No se copian por estudiante.
- **Sin nombres ni texto libre en `data`.** Solo ids, números y valores de listas cerradas.

## 3. Qué se calcula y cómo se recalcula

Todo sale de funciones puras `derive(events, config)` que se pueden testear y que llevan versión (`mastery-v1`, `errors-v1`). El resultado se guarda como caché (snapshot) con el último evento que leyó y la versión del algoritmo. Nada se edita a mano.

| Cálculo | Entrada | Cómo |
|---|---|---|
| **Dominio por tema** | `exercise_marked` y `practice_attempt` con `unitId` | Para cada estudiante, materia y tema, una Beta: bien = 1, parcial = ½, mal = 0, y los ejercicios recientes pesan más (vida media de unos 60 días). Niveles: *sin datos* (menos de 3 ejercicios), *flojo*, *en camino*, *dominado*. Hay histéresis para que no salte de nivel por un solo ejercicio. |
| **Errores que se repiten** | `exercise_marked.errors` | Una etiqueta se repite si aparece 3 veces o más en al menos 2 pruebas distintas en los últimos 60 días. Deja de repetirse cuando no aparece en los últimos N ejercicios del mismo tema. |
| **Progreso académico** | Dominio a lo largo del tiempo | Su primer estimado por tema (el punto de partida) contra el actual. **Solo contra su propia historia**, nunca contra otros. |
| **Separación del punto de partida del perfil** | Preferencias del motor (épica H) | Cuánto se alejó lo aprendido del prior de su perfil, perilla por perilla. Es sobre **cómo se le presenta**, no sobre cuánto sabe. |
| **Tiempo y abandono** | `exercise_left`, entregas | Mediana del tiempo activo por tema y abandonos por prueba. Al profe se le muestran medianas, no un minuto a minuto. |

Cuándo se recalcula:
- **Con cada evento nuevo** del estudiante, solo lo suyo. Son cientos de eventos por año, así que recalcular de cero es barato y evita errores incrementales.
- **Todo de nuevo** cuando cambia la versión de un algoritmo, cuando se remapean temas del programa y después de un borrado (el prior de cada perfil se recalcula sin ese estudiante en la próxima corrida en lote).

Los números concretos (umbrales, vida media, mínimo de 3 ejercicios) son un punto de arranque para calibrar con los profes del piloto. Qué significa «dominado» en cada materia lo deciden ellos, no este documento.

## 4. Hitos de la línea de tiempo (épica M)

Un hito es un **cambio de estado** derivado, no cada evento. Cada uno guarda `evidence` (los eventos que lo causaron) y `after` (lo que pasó después en el mismo tema o la misma perilla). Las dos listas se calculan a partir del registro.

| Hito | Carril | Evidencia que lo causó | Lo que pasó después |
|---|---|---|---|
| Un tema cambia de nivel (sube o baja) | Rendimiento | Los ejercicios corregidos que cruzaron el umbral | Los siguientes ejercicios del mismo tema |
| Aparece o deja de aparecer un error repetido | Rendimiento | Las marcas con esa etiqueta | Las marcas siguientes del mismo tema |
| El motor cambia una preferencia | Decisiones de la IA | Los ids en `preference_changed.evidence` | El rendimiento y el feedback con la perilla nueva |
| El profe aprueba o rechaza una nota de preferencia | Decisiones de la IA | Las ediciones que resumió la nota | Las versiones generadas con la nota |
| El profe fija una perilla o revierte una decisión | Feedback | La acción del profe y la decisión revertida | Lo mismo que un cambio de preferencia |
| Lo aprendido se separa del punto de partida del perfil | Decisiones de la IA | Los cambios de preferencia acumulados | — |
| Primer dato en una materia o en un tema | Rendimiento | El primer ejercicio corregido | — |

No son hitos: cada respuesta, cada estrella, cada versión aprobada y **cada elección de perillas del motor**. El motor elige por muestreo y a veces explora, así que una perilla puede cambiar de una prueba a otra sin que haya cambiado lo aprendido (ver «Choques con el roadmap»).

La explicación sale de una plantilla con los datos del hito, por ejemplo:

> **Cinemática pasó de «en camino» a «dominado».** Se basó en 4 ejercicios corregidos entre el 3 y el 20 de marzo: 3 bien y 1 parcial. Uno se hizo con preguntas guía.

> **Dejamos de incluir el ejemplo resuelto** (confianza alta). En las últimas 3 pruebas no lo abrió y el rendimiento en esos temas no bajó. [Ver las 3 pruebas] [Revertir] [Fijar]

El endpoint de la línea de tiempo devuelve nodos (`milestones`) y conexiones (`evidence`, `after`). La vista en carriles y la lista accesible salen de los mismos datos.

## 5. Dónde viven los datos y cómo se migra

**Hoy:** todo vive en el `localStorage` del navegador, y el estudiante resuelve con `useData()`, que carga **todos** los datos: grupos, perfiles de todos y versiones con sus perfiles. Para la demo está bien, pero choca con «nada sensible en el navegador del estudiante». Lo resuelve la épica A, no este diseño. Lo dejamos dicho para que no se arrastre.

**En producción:** una tabla `evolution_events` (solo inserción) en Aurora PostgreSQL (`sa-east-1`, ver README), tablas de caché para los derivados y la tabla de preferencias de H. El estudiante solo **escribe** eventos por `POST /api/events`, nunca los lee.

Pasos chicos, cada uno sin romper `/demo`:

| Paso | Qué | Depende de | La demo |
|---|---|---|---|
| 0 | Tipos de evento en `lib/contract.ts` (aditivo) y funciones `derive` en `lib/evolution/`, con tests sobre un registro de ejemplo. No se guarda nada nuevo. | — | No cambia |
| 1 | Un adaptador que **lee los datos actuales como eventos**: `history`, `exerciseResults`, `grades` y `submissions`. Con eso, el dominio y los errores repetidos ya andan sobre `localStorage`, sin guardar nada más ahí. | 0 | No cambia |
| 2 | La demo recibe un registro de eventos **fijo** de un estudiante ficticio (como `lib/groups/seed.ts`) y lo pasa por las mismas funciones. La vista M se puede probar sin servidor. | 1 | Gana la vista, con datos fijos |
| 3 | Tabla de eventos y `POST /api/events` con zod. El servidor pone `studentKey` e `institutionId` desde la sesión, nunca desde el cliente. Arrancan `exercise_left`, `student_feedback` y `adaptation_rated`. | A | Sigue con datos fijos; la demo no escribe al servidor |
| 4 | Store y corrección escriben eventos en el servidor; los derivados se calculan ahí. Endpoint de la línea de tiempo. | 3 | Sigue con datos fijos |
| 5 | Se apaga el adaptador del paso 1 fuera de la demo. | 4 | El adaptador queda solo para la demo |

Dos decisiones dentro de la migración:
- **Las señales nuevas (tiempos, apoyos) no se guardan en `localStorage`**, ni de forma provisoria. Serían datos de uso de menores en un navegador que puede ser compartido. Esperan al paso 3.
- **Los datos de la época del hackathon no se migran.** No hay consentimiento de las familias para el aprendizaje. El registro arranca limpio con el piloto.

## 6. Privacidad y derechos (Ley 18.331)

- **Consentimiento antes que aprendizaje.** Sin consentimiento registrado de la familia (con la versión del texto que firmó), el estudiante usa la plataforma igual, pero no se escriben eventos de aprendizaje y el motor usa solo el perfil base. El consentimiento vive en su propia tabla, no en el registro.
- **Pseudonimización.** `studentKey` es un UUID al azar. La tabla que lo une con el estudiante está en otro esquema, con otro rol de base y menos accesos. El registro no tiene nombres.
- **Autorización en el servidor.** La línea de tiempo y los derivados solo los ve un profe del grupo del estudiante, de la misma institución. Se chequea en cada consulta, no en la UI. Las rutas del estudiante no devuelven nada de esto.
- **Nada sensible en el navegador del estudiante.** El navegador manda eventos y no guarda ni recibe perfiles, perillas, dominio ni hitos. El uso de mirada o dictado deja ver el perfil, así que esos eventos se tratan como datos de salud aunque no lo nombren.
- **Nunca nombres a la IA.** Si una llamada necesita historia del estudiante (por ejemplo, las notas de preferencia de H), viaja con referencias de un solo uso, como hoy `E1`, `E2` en `lib/results/analyze.ts`, ni siquiera con el `studentKey`.
- **Nada sensible en logs.** Los logs llevan ids y tipos de evento, nunca `data`.
- **Auditar.** Cada lectura de la evolución de un estudiante, cada exportación y cada borrado queda en un log de accesos: quién, cuándo y qué.
- **Explicar.** Cada hito tiene su evidencia, y cada decisión del motor, sus eventos (sección 4).
- **Exportar.** A pedido de la familia, un archivo con sus eventos, sus derivados y las decisiones del motor con su explicación, en JSON y en una versión legible.
- **Borrar.** A pedido de la familia, se borran sus eventos, cachés, preferencias, notas y la fila que une el seudónimo con el estudiante. Los eventos de versión quedan, porque no lo nombran, pero sin el vínculo. El prior de su perfil se recalcula sin él en la próxima corrida. Las copias de respaldo vencen en su plazo, y eso se le dice a la familia.

**Cuánto se guarda** (propuesta; los plazos los fija la revisión legal de la épica C):

| Qué | Plazo propuesto |
|---|---|
| Eventos crudos de uso (tiempos, apoyos) | El año lectivo en curso más 1 año |
| Correcciones, notas y feedback | Mientras el estudiante siga en la institución, más 1 año |
| Derivados (dominio, preferencias, hitos) | Igual que su fuente; se recalculan, no se conservan aparte |
| Log de accesos y de borrados | 5 años, sin contenido del estudiante |
| Copias de respaldo | 35 días |

## 7. La materia como parámetro

- Cada evento lleva `subject`, y el tema es una unidad del programa **de esa materia y ese curso**. El dominio se calcula por materia y tema, así que no se mezcla «vectores» de Física con los de Matemática.
- El catálogo de errores lleva materia y versión (`"catalog": "physics@1"`). Hoy `ERROR_TAGS` es uno solo y es genérico (cálculo, interpretación, concepto, procedimiento incompleto, notación), y sirve para las tres materias. Las etiquetas propias de cada materia las define el equipo con profes de esa materia en la épica K. Acá no se proponen.
- La práctica autocorregida usa el verificador de la materia (`numberCheck` y mathjs hoy, y unidades para Física en K). El evento guarda qué verificador corrigió y con qué versión.
- Hoy el programa es uno por navegador («Mi materia», `lib/syllabus/store.ts`). En producción, cada grupo apunta a la materia y al programa con los que trabaja.

## 8. Cómo lo usa el motor (épica H) y qué necesita el piloto

**Qué lee el motor:**
- **La recompensa** sale de eventos: versión aprobada sin edición, motivos de rechazo, `adaptation_rated`, `student_feedback`, rendimiento contra su propio historial en el mismo tema, y abandono. La fórmula es tarea de H (Producto). Este diseño solo garantiza que cada parte esté en el registro.
- **La tabla de preferencias** (α y β por estudiante, perilla y valor) también es un derivado: se puede reconstruir repasando el registro. Así se cumplen el borrado y la auditoría sin lógica aparte.
- **El dominio por tema** lo usa la práctica periódica (J) para elegir temas. El motor de preferencias no lo usa para cambiar la dificultad: las perillas cambian la presentación, no lo que se evalúa.
- **Lo que escribe el motor:** `knobs_chosen` en cada generación (valores, si exploró o no, y el prior usado) y `preference_changed` cuando cambia lo aprendido, con evidencia y confianza. Lo segundo alimenta los hitos.

**Qué necesita el piloto de marzo para que esto sirva:**

| Dato | Por qué | Hoy |
|---|---|---|
| Consentimiento de cada familia | Sin eso no se registra nada para aprender | No existe (C) |
| Cada ejercicio con su tema del programa | Sin tema no hay dominio | No existe (B) |
| Correcciones por ejercicio, no solo la nota | Son la fuente principal del dominio | Existe, pero es opcional; hay que pedirle a los profes del piloto que corrijan por ejercicio |
| Tiempo, abandono y apoyos por ejercicio | Recompensa del motor y vista M | No existe (D) |
| Feedback del estudiante y «¿le sirvió?» | Recompensa del motor | En curso (D) |
| Historial de la versión (generado, editado, motivo) | Principal señal del profe | Existe en `localStorage` (B) |
| El brazo de la prueba A/B en cada generación | Para comparar perillas aprendidas contra perfil base (L) | No existe; va en `knobs_chosen` |

Expectativa honesta: un piloto de 4 a 6 semanas da por estudiante unas 2 a 4 pruebas del profe y, en Matemática, unas 8 a 12 prácticas. Alcanza para mostrar dominio en algunos temas de Matemática y unas pocas decisiones del motor. En Física y Química, sin práctica periódica, va a haber poco dominio y casi todo va a ser «sin datos». La vista tiene que decirlo así, y no inventar tendencias.

## Choques con el roadmap

- **Un muestreo no es una decisión.** El roadmap pide ver «cada decisión del motor». Con Thompson sampling, el motor a veces explora y la perilla cambia sin que haya cambiado lo aprendido. Mostrar cada elección como decisión llenaría la línea de tiempo y daría un porqué falso. Propuesta: se registra cada elección, pero el hito es el cambio de preferencia aprendida.
- **Los apoyos de razonamiento sí bajan la dificultad.** La regla de oro dice que las perillas no cambian lo que se evalúa, pero `supports` (preguntas guía, números simples, etc.) baja la dificultad a propósito. Un ejercicio bien resuelto con esos apoyos no vale lo mismo para el dominio. Propuesta: cuenta, pero queda marcado (`reasoningSupports`) y no alcanza solo para pasar a «dominado».
- **El feedback del profe es por versión hasta la épica I.** Mientras la versión sea por combinación de perfiles, aprobar o rechazar una versión afecta a varios estudiantes a la vez. Para el motor, esa señal se reparte y pesa menos que las señales propias de cada estudiante.
- **M depende de J, y J llega justo.** El dominio más rico viene de la práctica periódica, que termina en febrero, igual que M, y en el piloto es solo de Matemática. Para Física y Química, M solo va a tener las correcciones del profe.
- **D sin A no tiene dónde guardar.** Si la base de A se atrasa, las señales de D no tienen dónde vivir sin violar «nada sensible en el navegador». Mejor que D espere a A que guardarlas en `localStorage`.
- **El estudiante hoy carga los datos de todos.** Ver sección 5. Lo resuelve A, pero M no debería salir antes.

## Preguntas abiertas para el equipo

| Pregunta | Recomendación |
|---|---|
| ¿Quién ve la evolución? (abierta en el roadmap) | En el piloto, solo los profes del grupo. El equipo de inclusión, después, con un rol explícito y con el acceso auditado. |
| ¿El estudiante ve su dominio por tema? | No los niveles («flojo» no se le muestra). Solo el refuerzo positivo de la épica F («mejoraste en Cinemática»), igual para todos. Nunca perillas ni preferencias. |
| ¿Un ejercicio en blanco cuenta como mal para el dominio? | Sí en una prueba entregada del profe. No en una práctica abandonada: ahí cuenta como abandono. |
| ¿Umbrales de nivel y vida media? | Arrancar con los de la sección 3 y calibrarlos con los profes del piloto. Que lo que significa «dominado» lo definan ellos. |
| ¿Qué pasa con los ejercicios resueltos con apoyos de razonamiento? | Cuentan, marcados, y no alcanzan solos para «dominado» (ver choques). Validarlo con especialistas en C. |
| ¿Se migran los datos del hackathon? | No. Arrancar limpio con el consentimiento del piloto. |
| ¿Plazos de retención? | Los de la tabla de la sección 6 como borrador para la revisión legal de C. |
| ¿Quién etiqueta cada ejercicio con su tema? | La IA lo propone al leer el práctico y el profe lo confirma junto con el texto. Un ejercicio sin tema no cuenta para el dominio. |
| ¿Hace falta una fecha de cierre en las pruebas? | Sí, opcional. Sin ella, el abandono de una prueba no se puede derivar. Sumarla en el esquema de A. |
| ¿Medir el tiempo en parciales puede sentirse como vigilancia? | Decirlo en el consentimiento, y al profe mostrarle medianas por tema, no un registro minuto a minuto. |
| ¿Quién define los catálogos de errores de Física y Química? | Profes de cada materia en la épica K, con el catálogo genérico de hoy como base común. |
