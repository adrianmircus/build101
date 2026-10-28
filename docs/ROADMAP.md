# Tiza.ai: que la IA aprenda de cada estudiante (ciencias exactas, marzo 2027)

## Objetivo
- La plataforma y las adaptaciones se centran solo en ciencias exactas.
- Para marzo de 2027 la plataforma sigue andando, pero con otro motor por detrás: uno que aprende del feedback del profe y del estudiante. Así cada estudiante, con discapacidad o solo con preferencias, tiene su propio perfil aprendido y cada prueba es única.
- El estudiante tiene gamificación con refuerzo positivo.
- Además de las pruebas del profe, el estudiante recibe prácticas cortas y periódicas que refuerzan sus puntos débiles en cada materia.
- La IA investiga en internet para sumar recomendaciones con evidencia, siempre con aprobación de un especialista.

## Resumen
- **No se entrena un modelo por estudiante.** Con 1000 estudiantes serían 1000 modelos, y no es viable. Claude no se reentrena por usuario, y cada estudiante tiene pocos datos: unas 10 a 20 pruebas por año.
- **Lo que aprende es un perfil de preferencias por estudiante**, guardado como datos. Un modelo de ML chico (un *bandit* contextual con priors jerárquicos) decide qué adaptaciones aplicar y aprende de cada señal de feedback. Después Claude recibe ese perfil y arma la prueba.
- Cada uno de los 1000 estudiantes alimenta su propio perfil de forma distinta, y cada prueba sale única. Así funcionan hoy los sistemas de recomendación con LLM.
- Guardarlo como datos y no dentro de los pesos de un modelo también ayuda con la Ley 18.331. Se puede auditar, explicar al profe y borrar si una familia lo pide. Eso no se puede hacer con un modelo entrenado.

## Dónde está hoy el código (punto de partida)
- Hoy se arma una versión por combinación de perfiles, no por estudiante. Lo hace `groupByProfiles()` en `lib/groups/versions.ts`, y `generateVersion()` en `lib/agent/generate.ts` la genera.
- Las adaptaciones salen de `data/profiles/<id>.md` (`lib/agent/profiles.ts`), que ya funciona como el catálogo validado de qué se puede hacer.
- **Casi todo el feedback útil se pierde hoy.** Por eso es lo primero que hay que arreglar:
  - Cuando el profe edita una versión, se pisa `content` y se pierde lo que generó la IA (`AssessmentDetail.tsx` ~399). No queda ningún diff.
  - Aprobar es solo un flag `approved`. No hay rechazo con motivo ni historial.
  - No se mide el tiempo por ejercicio. Tampoco se registra si el estudiante usó lectura en voz alta, mirada o dictado.
  - Los tokens van solo a `console.info`.
  - Lo que sí se guarda sirve como señal: las notas, las marcas por ejercicio (`ExerciseResult`) y las respuestas.
- Todo vive en `localStorage`. Para aprender entre sesiones y dispositivos hace falta la base planeada en el README (Aurora PostgreSQL).
- El pipeline ya está pensado para matemática: el prompt `SYSTEM`, KaTeX, `GraphSpec`/mathjs, `numberCheck` y las reglas de mirada y dictado.

## Cómo se hace: 7 capas

### 1. Capturar feedback (sin esto no hay nada que aprender)
Todo queda en un registro de eventos por estudiante, en el servidor y pseudonimizado:
- **Profe:**
  - Aprueba o rechaza con un motivo estructurado: "muy largo", "cambió la dificultad", "contexto no le sirve", "le faltó apoyo visual", etc.
  - Se guarda el diff entre lo que generó la IA y lo que aprobó. Es la señal más rica: cada edición dice qué le faltaba o le sobraba a esa versión.
  - Al corregir, una pregunta rápida opcional: "¿la adaptación le sirvió?".
- **Estudiante:** micro-feedback accesible al terminar, de 1 o 2 toques o por voz, como "¿te resultó más fácil leerlo así?" o "¿te sirvió el ejemplo?". **Nunca menciona el perfil**, porque el estudiante no lo ve.
- **Señales implícitas:**
  - tiempo por ejercicio
  - ejercicios abandonados
  - uso de lectura en voz alta, mirada y dictado
  - rendimiento por ejercicio contra el resto del grupo en la misma prueba

### 2. Un catálogo cerrado de "perillas" de adaptación
El ML elige **entre opciones validadas, nunca inventa**. Así se respeta el principio de no inventar pedagogía. Cada adaptación de los `.md` pasa a ser una perilla con valores posibles, por ejemplo:
- largo del enunciado
- ítems por página
- segmentar en pasos
- incluir un ejemplo resuelto
- números simples
- contexto según intereses
- gráfico, tabla o texto
- tipografía y espaciado
- lectura en voz alta por defecto
- pistas graduadas

El perfil clínico (TDAH, dislexia, etc.) define **qué perillas están habilitadas y su punto de partida**. Un estudiante sin diagnóstico usa las mismas perillas, pero solo como preferencias. Eso es menos sensible y abre el producto a todo el grupo.

**Regla de oro:** las perillas cambian la presentación y el apoyo, no lo que se evalúa. La dificultad matemática la fija el práctico original del profe. Si no se pone esta regla, el sistema puede "aprender" a hacerle todo más fácil a quien se queja.

### 3. El motor que aprende (por etapas)
- **Etapa A, para marzo: bandit contextual con priors jerárquicos.**
  - Para cada estudiante y cada perilla se lleva una distribución de "qué tan bien le funciona cada valor" (Beta/Thompson sampling).
  - Un estudiante nuevo arranca del promedio de los estudiantes con su mismo perfil. Eso resuelve el arranque en frío. Con su propio feedback se va separando del promedio.
  - Es matemática chica: corre en el servidor sin GPU, se explica fácil ("le sacamos el ejemplo resuelto porque las últimas 3 veces no lo usó") y funciona bien con pocos datos.
- **Etapa B, también para marzo: memoria de preferencias en texto.**
  - Claude resume las ediciones del profe en notas cortas por estudiante, por ejemplo "prefiere enunciados de una línea" o "le sirven los contextos de fútbol".
  - **El profe aprueba esas notas** antes de que se usen. Después entran al prompt junto con algunos ejemplos ya aprobados para ese estudiante.
- **Etapa C, después de marzo y con volumen:**
  - Un modelo de recompensa entre estudiantes que predice si una versión se va a aprobar o le va a servir al estudiante (por ejemplo gradient boosting sobre las perillas y las señales).
  - Recién con miles de pruebas aprobadas tendría sentido evaluar un fine-tuning. Probablemente no haga falta.

**Cada decisión queda registrada con su porqué.** Cuando el motor cambia una perilla, guarda qué cambió, qué eventos lo llevaron a eso y con cuánta confianza. Así el profe puede ver la evolución de cada estudiante (épica M) sin que la IA invente explicaciones después.

### 4. Una prueba por estudiante, sin que explote el costo ni la revisión
- **Costo:** se mantiene una adaptación base por combinación de perfiles, como hoy y aprovechando la caché de prompts que ya está en `lib/agent/client.ts`. Encima va una capa por estudiante:
  - Las perillas de presentación (tipografía, ítems por página, voz) se aplican en código, sin IA.
  - Solo los cambios de contenido (contexto por intereses, pasos, pistas) pasan por un llamado corto por estudiante.
- **Revisión del profe:** revisar 30 versiones a mano no escala. La UI tiene que mostrar la base aprobada y, para cada estudiante, solo lo que cambia, agrupado. El profe sigue aprobando todo lo que llega al estudiante, pero en minutos.

### 5. Gamificación: estrellas y refuerzo positivo
**Dos "recompensas" que no hay que mezclar:**
- Las estrellas son para motivar al estudiante.
- El "modelo de recompensa" del motor (capa 3) es la señal interna con la que el sistema aprende qué adaptación funciona.

Las estrellas no deciden nada del ML. El uso del estudiante (si completa, si vuelve, si abandona) sí entra como señal.

**Qué da estrellas:**
- Completar un ejercicio, aunque esté mal. Se premia el esfuerzo, no solo el acierto.
- Mejorar en un tema donde venía flojo. Se premia el progreso contra su propio historial.
- Terminar la práctica periódica (capa 6) y mantener una racha semanal. La racha tiene que ser suave: perderla no tiene que doler y se recupera fácil.
- Dar feedback sobre la prueba ("¿te resultó más fácil así?"). Las estrellas son **por responder, nunca por responder bien**, y hay un tope por prueba. Si no, el feedback se llena de "sí" automáticos para ganar estrellas y el motor aprende de ruido.

**Caras por ejercicio, con un ajuste importante:**
- Correcto: cara verde contenta, más el texto "¡Bien!" y una forma, no solo el color.
- Incorrecto: **estado neutro y alentador** en otro color (por ejemplo ámbar), con "Casi, mirá este paso" y una pista o la opción de reintentar. No se usa una cara roja triste: para estudiantes con TDAH, TEA o ansiedad frente a la matemática puede generar frustración y abandono, y ahí la plataforma pierde justo al estudiante que más la necesita.
- La forma concreta del refuerzo tiene que salir de `data/profiles/*.md`, validada por especialistas, igual que las adaptaciones. No se inventa pedagogía tampoco acá. El estilo de feedback puede ser una perilla más de la capa 2, por ejemplo con o sin sonido, o celebración breve o ninguna.

**Cuándo se muestran las caras:**
- En la práctica periódica, al instante, porque se corrige sola (ver capa 6).
- En la mirada (motriz), al instante, porque la respuesta correcta ya se conoce.
- En pruebas y parciales del profe, **recién cuando el profe corrige**. Calificar sigue llevando aprobación humana, y durante un parcial no se le dice al estudiante si va bien.

**Reglas de diseño:**
- **Sin rankings ni comparación entre compañeros.** Solo progreso personal. Compararse desmotiva a quien va atrás y además expone datos de otros menores.
- Accesible (WCAG 2.2 AA):
  - nunca solo color
  - el texto alternativo de cada cara se anuncia por lector de pantalla (`aria-live`)
  - las animaciones respetan `prefers-reduced-motion`
  - el sonido es opcional
  - funciona con mirada y con voz
- Se ve igual para todos los perfiles, para que el estudiante no pueda deducir su perfil.
- Las estrellas no se canjean por nota. Mezclarlas con la calificación confunde y le saca autoridad al profe.

### 6. Práctica periódica personalizada para reforzar puntos débiles
**Qué es:** cada semana, cada estudiante recibe una o dos prácticas cortas por materia, de unos 10 minutos y 3 a 5 ejercicios, enfocadas en sus temas flojos. Va aparte de las pruebas del profe, como entrenamiento.

**Cómo sabe el sistema qué está flojo: un modelo de dominio por estudiante y por tema.**
- Los temas salen de las unidades del programa (`SyllabusUnit`) y de las etiquetas de error que ya existen (`lib/results/catalog.ts`).
- Cada ejercicio corregido actualiza una estimación de "qué tanto domina este tema". Puede venir de una corrección del profe (`ExerciseResult`) o de una práctica autocorregida. Técnicamente se usa *knowledge tracing* bayesiano o un puntaje tipo Elo. Es otra pieza chica de ML que aprende por estudiante, igual que el bandit.
- La práctica elige los temas de menor dominio y mezcla algo de repaso espaciado de temas ya dominados, para que no se olviden.
- La dificultad sube de a poco cuando el estudiante acierta y baja cuando se traba.

**De dónde salen los ejercicios:**
- Hay un **banco de ejercicios por tema aprobado por el profe o el equipo**, que se va armando con las pruebas que el profe ya subió y aprobó.
- La IA genera variantes de esos ejercicios, cambiando números y contexto según intereses, y las adapta con las perillas del estudiante (capas 2 y 3).
- Las respuestas se verifican con código (mathjs, `numberCheck`) antes de mostrarse. Eso permite corregir solo y dar las caras al instante.
- Se generan en lote y fuera de hora, porque no son urgentes. Así se puede usar la API por lotes de Anthropic, que es más barata, y no se compite con el profe cuando está generando.

**Aprobación humana sin que el profe revise 1000 prácticas:**
- El profe aprueba **el plan, no cada ejercicio**. Una vez por semana ve una pantalla por grupo con:
  - los temas que va a reforzar cada estudiante
  - una muestra de los ejercicios
  - las variantes nuevas que todavía no se aprobaron

  Aprueba en bloque o corrige.
- Los ejercicios que salen del banco ya aprobado, con cambios solo de presentación, no necesitan otra revisión. Las variantes nuevas generadas por la IA sí la necesitan.
- La práctica **no lleva nota**. Es formativa, y por eso la autocorrección no choca con el principio de que calificar requiere al profe.

**Cómo alimenta al resto del sistema:**
- Cada práctica actualiza el modelo de dominio, que decide qué temas reforzar.
- También actualiza el modelo de preferencias, que decide cómo presentarlos, porque la práctica es una fuente de feedback mucho más frecuente que las pruebas.
- Eso ayuda con el problema de "pocos datos por estudiante": con dos prácticas por semana, en un mes hay más señal que en un semestre de parciales.
- El profe ve en su panel cómo avanza cada estudiante en sus temas débiles. Eso suma a lo que ya hace el análisis de grupo (`lib/results/analyze.ts`).

**Datos y privacidad:**
- El modelo de dominio es un dato académico por estudiante, pseudonimizado, y se borra junto con el perfil si se pide.
- Las notificaciones de "tenés práctica nueva" van al estudiante en la plataforma. Si se avisa a las familias, el aviso no dice nada del perfil.

### 7. Una IA que investiga en internet, con un especialista que aprueba
La IA no busca en vivo mientras arma la prueba de un estudiante. Un "agente investigador" trabaja aparte y propone cambios.

**Qué existe hoy:** la API de Claude trae herramientas de búsqueda web (`web_search_20260209`) y de lectura de páginas (`web_fetch_20260209`) que corren del lado de Anthropic.
- Se puede limitar a una **lista de sitios permitidos** (`allowed_domains`).
- Se puede fijar un **tope de búsquedas por llamado** (`max_uses`).
- La lectura de páginas devuelve **citas** de la fuente.
- Cada búsqueda se cobra aparte de los tokens. Hay que confirmar el precio vigente en la página de precios de Anthropic.

**Por qué no buscar en vivo al generar cada prueba:**
- **Rompe el principio de no inventar pedagogía.** Internet está lleno de consejos sin evidencia sobre TDAH o dislexia. Si la IA aplica lo que encuentra sin que nadie lo revise, le llegan al estudiante adaptaciones sin validar.
- **Seguridad.** Una página puede traer instrucciones escondidas que intenten manipular a la IA. Es lo que se llama *prompt injection*. Es más riesgoso cuando lo que sale va directo a un menor.
- **Privacidad.** Las búsquedas salen hacia un buscador externo. Nunca pueden llevar nada del estudiante, ni nombre, ni perfil, ni sus errores.
- **Costo, demora y repetibilidad.** Cada prueba tardaría más y costaría más, y dos estudiantes iguales podrían recibir cosas distintas según lo que haya aparecido ese día en la web.

**Cómo hacerlo bien (extiende lo que ya existe):**
- Ya hay un circuito de borrador, revisión y aprobación. `scripts/distill-profiles.mjs` lee los documentos de `data/profiles/<id>/sources/` y escribe un `.draft.md` con fuente, página y cita. Después alguien lo revisa y recién entonces pasa a `<id>.md`. Hoy los documentos los busca el equipo a mano.
- **Lo nuevo es que el agente busque las fuentes.** Una vez por mes, o cuando se lo pide el equipo, busca evidencia nueva por perfil y por materia, solo en sitios confiables. Por ejemplo:
  - guías de diseño universal para el aprendizaje (CAST/UDL)
  - ANEP y Ceibal
  - UNESCO
  - asociaciones de dislexia, TDAH y TEA
  - revistas científicas con revisión de pares
- El agente arma un borrador con cada recomendación nueva, su fuente y su cita, y señala si contradice algo que ya está aprobado. **Un especialista lo aprueba** antes de que la IA lo use con estudiantes.
- **El agente también puede partir de lo que aprende la plataforma.** Usa patrones agregados y anónimos de la capa 3, por ejemplo "en el grupo de dislexia se rechaza mucho el ejemplo resuelto largo". Busca evidencia sobre eso y propone ajustar el `.md`. Así el aprendizaje de los estudiantes y la evidencia externa se alimentan entre sí, sin saltear al especialista.
- **Internet también puede alimentar el banco de ejercicios** de la capa 6, con recursos educativos abiertos de Física, Química y Matemática. Hay que revisar que la licencia lo permita, igual que hoy con los PDF de fuentes.

**¿Tiene que seguir siendo un `.md` en el código?** No necesariamente. Con la base de datos de producción:
- El conocimiento aprobado pasa a la base, con versiones e historial de quién aprobó qué y con qué fuente.
- Los especialistas lo editan y aprueban desde un panel de administración, sin pasar por el código ni por un deploy.
- Cuando crezca mucho, la IA deja de leer el archivo entero. Busca solo los fragmentos aprobados que aplican a ese tema y a ese perfil, lo que se llama recuperación o RAG.
- El `.md` puede quedar como exportación legible o como respaldo.

**En resumen, hay dos tipos de aprendizaje:**
- **Sobre cada estudiante:** sale de su feedback (capas 1 a 3 y 6). Internet no sabe nada de él.
- **Sobre qué funciona en general:** sale de internet y de los especialistas (capa 7). Siempre pasa por aprobación humana antes de llegar a un estudiante.

## Ciencias exactas
- Hay que generalizar lo que hoy dice "matemática". Cada materia (Matemática, Física, Química) tiene que traer su programa, su prompt, su catálogo de errores y su verificador de números.
- Notación: KaTeX con `mhchem` para química y unidades SI.
- Gráficos: diagramas de fuerzas y circuitos, además de funciones.
- Las reglas de mirada y dictado tienen que dejar de hablar solo de parábolas.
- **Los `data/profiles/*.md` necesitan contenido específico de ciencias, validado por especialistas.** Sin eso no se adapta. Es trabajo pedagógico, no de código, y hay que arrancarlo ya.

## Riesgos que hay que decir de frente
- **En marzo habrá pocos datos.** El sistema va a estar aprendiendo, pero al principio va a pesar más el prior del perfil que la historia de cada estudiante. Hay que venderlo así a los colegios: "mejora con el uso".
- **Feedback sesgado.** Un profe cansado aprueba todo. Por eso conviene pesar más las ediciones y el rendimiento que el clic de aprobar.
- **Gusto o aprendizaje.** Que al estudiante le guste no es lo mismo que que aprenda. La recompensa tiene que combinar las dos cosas.
- **Ley 18.331.** Hay que:
  - pedir consentimiento de las familias para el aprendizaje
  - fijar una finalidad explícita
  - borrar el perfil aprendido si se pide
  - nunca mandar nombres a la IA (el perfil viaja pseudonimizado)
  - hacer la revisión legal sobre el almacenamiento en `sa-east-1` que ya está pendiente
- **La demo guiada** sigue con datos fijos y sin aprendizaje, para que no se rompa. Puede mostrar estrellas, caras y una práctica de ejemplo, también con datos fijos.
- **Gamificación mal calibrada.**
  - Si las estrellas premian solo acertar, desmotivan a quien más le cuesta.
  - Si premian dar feedback sin tope, ensucian los datos del motor.
  - Por eso se miden las dos cosas desde el primer día (ver métricas).
- **Alcance para marzo.** Con las capas 5 y 6, marzo queda muy cargado, y enero también: ahí se juntan el motor que aprende, la versión por estudiante (con la revisión por diferencias, «por qué esta versión» y el costo por estudiante) y el arranque de la práctica periódica, que sigue en febrero. Febrero carga además Ciencias exactas (K) y la vista de evolución del estudiante (M). El piloto llega con la gamificación completa, la vista de evolución y la práctica periódica solo en Matemática, usando el banco de ejercicios. Física y Química entran en la práctica después del piloto.

## Hoja de ruta (nov 2026 a mar 2027)
El plan se divide en 13 épicas, de la A a la M. M va última para no cambiar las letras que ya están en Notion, aunque se hace en febrero. El estado de cada tarea se sigue en el kanban de Notion del equipo; acá queda qué se hace, en qué orden y cuándo una épica está terminada.

### Resumen
| Épica | Meses | Objetivo | Terminada cuando | Depende de |
|---|---|---|---|---|
| A · Base de producción | Nov | Base de datos, login real y autorización por institución | Los flujos y la demo andan sin `localStorage` | — |
| B · Registro de feedback | Nov | No perder más feedback del profe | Se guarda el original de la IA, el diff y el rechazo con motivo | A |
| C · Producto, pedagogía y legal | Nov–Dic | Especialistas, colegio piloto y marco legal | Hay validadores, colegio, consentimiento y revisión legal | — |
| D · Feedback del estudiante y señales | Dic | Escuchar al estudiante y medir el uso | Se registran feedback, tiempos, abandonos y uso de apoyos | A, B |
| E · Perillas | Dic | Convertir los perfiles en opciones que el motor pueda elegir | El prompt recibe perillas en vez del perfil entero | — |
| F · Gamificación v1 | Dic | Estrellas y refuerzo positivo | El estudiante ve estrellas y caras accesibles sin revelar su perfil | C, D |
| G · Agente investigador v1 | Dic | Buscar evidencia en la web con aprobación de especialista | Primer borrador con citas revisado por un especialista | C |
| H · Motor que aprende | Ene | Preferencias por estudiante que aprenden del feedback | Cada generación elige perillas según el estudiante | B, D, E |
| I · Una versión por estudiante | Ene | Pasar de versión por combinación a versión por estudiante | El profe revisa por diferencias y el costo por prueba está medido | E, H |
| J · Práctica periódica v1, Matemática | Ene–Feb | Prácticas cortas sobre los temas flojos | El estudiante recibe y resuelve su práctica semanal aprobada | A, B, C |
| K · Ciencias exactas | Feb | Sumar Física y Química | Se puede adaptar un práctico de Física y uno de Química | C |
| L · Piloto | Mar | Piloto con un colegio | Profes capacitados, QA completo y métricas visibles | Todas |
| M · Evolución del estudiante | Feb | Que el profe vea cómo avanza cada estudiante y por qué cambió su adaptación | El profe ve los avances y cada decisión del motor con su porqué, también con teclado y lector de pantalla | B, D, H, J |

### Por dónde arrancar
Las dependencias dejan tres frentes en paralelo desde la primera semana:
- **Back (A):** la base de staging, el esquema inicial y la interfaz de datos que reemplace `lib/groups/store.ts`.
- **Front y Back (B):** guardar el original de la IA y el diff del profe, y el rechazo con motivo. Es un cambio aditivo en `lib/contract.ts` sobre el store actual, y pasa a la base cuando A esté lista. Es lo más barato y empieza a juntar datos ya.
- **Producto (C y E):** quién valida los perfiles de ciencias, el colegio del piloto, la revisión legal, los motivos de rechazo y el catálogo de perillas sacado de `data/profiles/*.md`.

### A · Base de producción (Nov)
- **Objetivo:** base de datos, login real y autorización por institución.
- **Terminada cuando:** los flujos y la demo andan sin `localStorage`.
- **Tareas:**
  - Crear la base de staging (Aurora PostgreSQL, `sa-east-1`). `Back · Alta`
  - Esquema inicial: instituciones, profes, grupos, estudiantes, evaluaciones, versiones, entregas y notas. `Back · Alta`
  - Interfaz de datos que reemplace `lib/groups/store.ts` (`localStorage`) por llamadas a la API. `Back · Alta`
  - La UI usa la nueva capa de datos, y la demo sigue con datos fijos. `Front · Alta`
  - Pasar el programa del curso (`lib/syllabus/store.ts`) a la base. `Back · Media`
  - Pasar el conocimiento de los perfiles (`data/profiles/*.md`) a la base, con versiones; los `.md` quedan como exportación. `Back · Media`
  - Login real con roles de profe, estudiante y admin (reemplaza `lib/auth/accounts.ts`). `Back · Alta`
  - Autorización por institución en cada ruta de `app/api/`. `Back · Alta`
  - Guardar los tokens de cada llamada en la base (hoy solo van a `console.info`). `Back · Media`
  - Verificar que la demo guiada sigue andando después de la migración. `QA · Alta`

### B · Registro de feedback (Nov)
- **Objetivo:** no perder más feedback del profe.
- **Terminada cuando:** se guarda el original de la IA, el diff y el rechazo con motivo.
- **Tareas:**
  - Tabla de eventos (tipo, estudiante pseudonimizado, versión, datos, fecha). `Back · Alta`
  - Guardar el contenido original de la IA al generar. `Back · Alta`
  - Guardar el diff cuando el profe edita una versión (`AssessmentDetail.tsx`). `Front · Alta`
  - Botón «Rechazar» con motivos de una lista cerrada. `Front · Alta`
  - Definir la lista de motivos de rechazo. `Producto · Alta`
  - Historial de aprobaciones: quién y cuándo. `Back · Media`
  - Etiquetar cada ejercicio con su unidad del programa y sus errores (`lib/results/catalog.ts`). `Back · Media`

### C · Producto, pedagogía y legal (Nov–Dic)
- **Objetivo:** especialistas, colegio piloto y marco legal.
- **Terminada cuando:** hay validadores, colegio, consentimiento y revisión legal.
- **Tareas:**
  - Definir quién valida los perfiles de ciencias, y en qué plazo. `Reuniones · Alta`
  - Juntar prácticos reales de Física y Química de los profes. `Producto · Alta`
  - Elegir el colegio del piloto y la fecha. `Reuniones · Alta`
  - Borrador del consentimiento informado para las familias. `Legal · Alta`
  - Revisión legal de la Ley 18.331 y del almacenamiento en `sa-east-1`. `Legal · Alta`
  - Validar con especialistas el estilo de refuerzo y el estado neutro para los errores. `Reuniones · Media`
  - Definir con los profes la frecuencia y el largo de la práctica. `Reuniones · Media`
  - Escribir las preguntas de feedback para el estudiante (1 o 2 toques). `Producto · Media`
  - Armar la lista de sitios confiables para el agente investigador. `Producto · Media`
  - Decidir si los estudiantes sin diagnóstico entran en el piloto. `Producto · Media`

### D · Feedback del estudiante y señales (Dic)
- **Objetivo:** escuchar al estudiante y medir el uso.
- **Terminada cuando:** se registran feedback, tiempos, abandonos y uso de apoyos.
- **Tareas:**
  - Componente de feedback al terminar (toques o voz, accesible). `Front · Alta`
  - Medir el tiempo por ejercicio (agregar `startedAt`). `Front · Media`
  - Registrar el uso de lectura en voz alta, mirada y dictado. `Front · Media`
  - Registrar los abandonos. `Front · Media`
  - Pregunta «¿le sirvió?» cuando el profe corrige. `Front · Media`
  - Endpoint para guardar eventos, validado con zod. `Back · Alta`

### E · Perillas (Dic)
- **Objetivo:** convertir los perfiles en opciones que el motor pueda elegir.
- **Terminada cuando:** el prompt recibe perillas en vez del perfil entero.
- **Tareas:**
  - Sacar el catálogo de perillas de `data/profiles/*.md` (perilla, valores y perfiles habilitados). `Producto · Alta`
  - Esquema de perillas en `lib/contract.ts` (cambio aditivo). `Back · Alta`
  - El prompt de `lib/agent/prompt.ts` recibe perillas en lugar del perfil entero. `Back · Media`
  - Aplicar en código las perillas de presentación (tipografía, ítems por página, voz). `Front · Media`

### F · Gamificación v1 (Dic)
- **Objetivo:** estrellas y refuerzo positivo.
- **Terminada cuando:** el estudiante ve estrellas y caras accesibles sin revelar su perfil.
- **Tareas:**
  - Diseño de las estrellas y de las caras (verde y estado neutro). `Front · Media`
  - Componente de resultado por ejercicio (`aria-live`, sin animaciones si el estudiante las desactiva, no solo color). `Front · Media`
  - Reglas y contador de estrellas (completar, feedback con tope). `Back · Media`
  - Mostrar las caras cuando el estudiante ve la corrección del profe. `Front · Media`
  - Sumar la gamificación a la demo guiada, con datos fijos. `Front · Baja`
  - QA: la gamificación no permite deducir el perfil. `QA · Media`

### G · Agente investigador v1 (Dic)
- **Objetivo:** buscar evidencia en la web con aprobación de especialista.
- **Terminada cuando:** hay un primer borrador con citas revisado por un especialista.
- **Tareas:**
  - Extender `scripts/distill-profiles.mjs` con búsqueda web y `allowed_domains`. `Back · Media`
  - Que el borrador marque las recomendaciones que contradicen algo ya aprobado. `Back · Baja`
  - Tope de búsquedas (`max_uses`) y registro de costo. `Back · Media`
  - Primera corrida para TDAH y dislexia en ciencias, con revisión de un especialista. `Producto · Media`

### H · Motor que aprende (Ene)
- **Objetivo:** preferencias por estudiante que aprenden del feedback.
- **Terminada cuando:** cada generación elige perillas según el estudiante.
- **Tareas:**
  - Tabla de preferencias (estudiante, perilla y valor, con α y β). `Back · Alta`
  - Punto de partida por perfil, calculado con los datos acumulados. `Back · Alta`
  - Definir la recompensa (aprobado sin edición, feedback, rendimiento). `Producto · Alta`
  - Elegir perillas con Thompson sampling al generar. `Back · Alta`
  - Registrar cada decisión del motor con su evidencia: perilla, valor anterior y nuevo, eventos que la causaron y confianza. `Back · Alta`
  - Borrar lo aprendido de un estudiante cuando se pide. `Back · Alta`
  - Notas de preferencia: Claude resume las ediciones del profe. `Back · Media`
  - Pantalla donde el profe aprueba las notas de preferencia. `Front · Media`
  - Pantalla «por qué esta versión». `Front · Media`

### I · Una versión por estudiante (Ene)
- **Objetivo:** pasar de versión por combinación a versión por estudiante.
- **Terminada cuando:** el profe revisa por diferencias y el costo por prueba está medido.
- **Tareas:**
  - Separar la versión base de la capa por estudiante (`lib/groups/versions.ts`). `Back · Alta`
  - Llamado corto por estudiante, con caché de prompts. `Back · Alta`
  - Vista de revisión por diferencias para el profe. `Front · Alta`
  - Medir el costo por prueba y por estudiante. `Back · Media`

### J · Práctica periódica v1, Matemática (Ene–Feb)
- **Objetivo:** prácticas cortas sobre los temas flojos.
- **Terminada cuando:** el estudiante recibe y resuelve su práctica semanal aprobada.
- **Tareas:**
  - Modelo de dominio por estudiante y por tema. `Back · Alta`
  - Banco de ejercicios armado con las pruebas aprobadas. `Back · Alta`
  - Generar variantes en lote (API por lotes). `Back · Media`
  - Verificar las respuestas con código (`numberCheck`, mathjs). `Back · Alta`
  - Pantalla del profe para aprobar el plan semanal del grupo. `Front · Alta`
  - Pantalla del estudiante para resolver la práctica, con autocorrección. `Front · Alta`
  - Programar la generación y el envío semanal. `Back · Media`
  - Estrellas por progreso y rachas suaves. `Front · Baja`

### K · Ciencias exactas (Feb)
- **Objetivo:** sumar Física y Química.
- **Terminada cuando:** se puede adaptar un práctico de Física y uno de Química.
- **Tareas:**
  - La materia como parámetro (prompt, programa, catálogo de errores). `Back · Alta`
  - KaTeX con `mhchem` para química. `Front · Media`
  - Lectura en voz alta de fórmulas químicas (`lib/speech/latexSpeech.ts`). `Front · Media`
  - Reglas de mirada y dictado que no hablen solo de parábolas. `Back · Media`
  - Verificador de unidades para Física. `Back · Media`

### L · Piloto (Mar)
- **Objetivo:** piloto con un colegio.
- **Terminada cuando:** los profes están capacitados, el QA está completo y las métricas se ven.
- **Tareas:**
  - Panel de métricas (aprobadas sin edición, prácticas completadas, abandono). `Front · Media`
  - Configurar la prueba A/B (perillas aprendidas frente a las del perfil base). `Back · Media`
  - Capacitar a los profes del colegio piloto. `Reuniones · Alta`
  - QA de punta a punta antes del piloto. `QA · Alta`

### M · Evolución del estudiante (Feb)
- **Objetivo:** que el profe vea cómo avanza cada estudiante y cómo la IA fue cambiando sus adaptaciones.
- **Terminada cuando:** el profe abre a un estudiante y ve sus avances y cada decisión del motor, con su porqué y lo que pasó después, también con teclado y lector de pantalla.
- **Tareas:**
  - Definir qué cuenta como hito: cambio de perilla, nota de preferencia aprobada, tema que pasa a dominado o a flojo, el estudiante se separa del punto de partida de su perfil. `Producto · Alta`
  - Endpoint que arma la línea de tiempo de un estudiante (nodos y conexiones) a partir del registro de eventos, autorizado solo para los profes de su grupo. `Back · Alta`
  - Explicación en lenguaje simple de cada decisión, armada con plantillas a partir de los datos registrados (no la redacta la IA después). `Back · Media`
  - Vista de nodos conectados en carriles (rendimiento por tema, feedback, decisiones de la IA). Cada hito se conecta con la evidencia que lo causó y con lo que pasó después. `Front · Alta`
  - Versión accesible de la misma vista: lista cronológica que se recorre con teclado y lector de pantalla. `Front · Alta`
  - Desde un hito, el profe puede revertir la decisión o fijar una perilla, y eso le llega al motor como feedback. `Front · Media`
  - Exportar la historia de un estudiante cuando la familia la pide (Ley 18.331), y borrarla junto con lo aprendido. `Back · Media`
  - Sumar la vista a la demo guiada con un estudiante ficticio y datos fijos. `Front · Media`
  - QA: la vista no aparece en el acceso del estudiante, no deja deducir el perfil y no le manda nombres a la IA. `QA · Alta`

Después del piloto se juntan los datos para la etapa C del motor y la práctica periódica se extiende a Física y Química.

## Cómo sabremos que funciona
- **Métrica principal:** el porcentaje de versiones aprobadas sin edición tiene que subir con el tiempo para un mismo estudiante.
- **Métricas secundarias:**
  - menos tiempo de revisión por prueba
  - mejor rendimiento por ejercicio contra el propio historial
  - mejor feedback del estudiante
- **Práctica periódica:**
  - porcentaje de prácticas completadas por semana
  - mejora del dominio en los temas que se reforzaron
  - si esa mejora se nota después en los parciales del profe
- **Gamificación:**
  - si sube la práctica completada sin que baje en los estudiantes que más fallan
  - si el feedback del estudiante sigue variado (y no es todo "sí")
  - tasa de abandono después de un ejercicio incorrecto
- **Vista de evolución:** cuántos profes la abren y cuántas decisiones del motor revierten. Las reversiones dicen dónde se equivoca el motor.
- **Prueba A/B en el piloto:** una parte de las pruebas con perillas aprendidas y otra con las del perfil base, comparando las métricas.

## Decisiones abiertas para el equipo
- ¿"Ciencias exactas" en marzo son Física y Química, o solo Matemática más Física?
- ¿El estudiante sin diagnóstico entra en el piloto de marzo o después? (tarea en C)
- ¿Quién valida los `.md` de ciencias y cuándo? (tarea en C)
- ¿Quién valida con especialistas el estilo de refuerzo, incluido el estado neutro para los errores? (tarea en C)
- ¿Qué frecuencia y qué largo debería tener la práctica periódica? Propuesta: 2 por semana, unos 10 minutos. (tarea en C)
- ¿Les sirve que el profe apruebe el plan semanal por grupo en lugar de cada ejercicio?
- ¿Qué sitios entran en la lista de fuentes confiables del agente investigador, y quién la mantiene? (tarea en C)
- ¿Quién más ve la evolución de un estudiante: solo los profes del grupo, o también el equipo de inclusión o la dirección del colegio?
