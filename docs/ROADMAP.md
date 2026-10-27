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
- **Alcance para marzo.** Con las capas 5 y 6, marzo queda muy cargado. El piloto llega con la gamificación completa y con la práctica periódica solo en Matemática, usando el banco de ejercicios. Física y Química entran en la práctica después del piloto.

## Hoja de ruta sugerida (nov 2026 a mar 2027)
1. **Noviembre:**
   - base de datos y login reales
   - registro de eventos
   - guardar lo que generó la IA junto con el diff del profe
   - rechazo con motivo
   - temas del programa y etiquetas de error guardados por ejercicio, como base del modelo de dominio
   - el conocimiento de los perfiles pasa de los `.md` a la base, con versiones (los `.md` quedan como exportación)
2. **Diciembre:**
   - micro-feedback del estudiante y señales implícitas
   - catálogo de perillas derivado de los `.md`
   - **gamificación v1:** estrellas por completar y por dar feedback (con tope), y caras al ver la corrección del profe
   - empieza la validación pedagógica de Física y Química, y del estilo de refuerzo por perfil
   - **agente investigador v1:** busca fuentes en los sitios permitidos y arma borradores con cita, para acelerar esa validación. Lo aprueba un especialista.
3. **Enero:**
   - preferencias por estudiante, bandit con priors por perfil y memoria de preferencias aprobada por el profe
   - capa de personalización por estudiante
   - modelo de dominio por tema
   - banco de ejercicios armado con las pruebas aprobadas
4. **Febrero:**
   - Física y Química en las pruebas del profe
   - revisión por diferencias para el profe y pantalla de "por qué esta versión"
   - **práctica periódica v1 en Matemática:** autocorrección, caras al instante, aprobación semanal del plan por grupo y generación en lote
   - estrellas por progreso y rachas
   - medición del costo por estudiante y por semana
5. **Marzo:** piloto con un colegio. A partir de ahí se juntan los datos para la etapa C y se extiende la práctica a Física y Química.

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
- **Prueba A/B en el piloto:** una parte de las pruebas con perillas aprendidas y otra con las del perfil base, comparando las métricas.

## Decisiones abiertas para el equipo
- ¿"Ciencias exactas" en marzo son Física y Química, o solo Matemática más Física?
- ¿El estudiante sin diagnóstico entra en el piloto de marzo o después?
- ¿Quién valida los `.md` de ciencias y cuándo?
- ¿Quién valida con especialistas el estilo de refuerzo, incluido el estado neutro para los errores?
- ¿Qué frecuencia y qué largo debería tener la práctica periódica? Propuesta: 2 por semana, unos 10 minutos.
- ¿Les sirve que el profe apruebe el plan semanal por grupo en lugar de cada ejercicio?
- ¿Qué sitios entran en la lista de fuentes confiables del agente investigador, y quién la mantiene?
