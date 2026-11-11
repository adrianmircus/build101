# Revisión de Codex: docs/PLATAFORMA.md, ronda 2 (11/11/2026)

Copia completa de la salida de Codex. Resultado: de los 23 hallazgos de la ronda 1, 8 cerrados y 15 parciales; 30 hallazgos nuevos (19 altos, 11 medios). Cómo se incorporó cada uno: «Cambios por la revisión» en docs/PLATAFORMA.md.

lastlog=58 total=280
| ID ronda 1 | Estado | Evaluación |
|---|---|---|
| 1 | cerrado | Storage deja de autorizar solo por institución y exige relación con el práctico, grupo o estudiante. P:373–378. |
| 2 | parcial | Falta revocar `EXECUTE` a `PUBLIC`; revocarlo a `anon` y `authenticated` no elimina ese permiso heredado. N01. |
| 3 | parcial | Se separan las preguntas de su clave, pero faltan datos y consumidores necesarios para completar la migración del estudiante. N19. |
| 4 | cerrado | Un trabajo por invocación y plazo global de 50 s eliminan el segundo trabajo sin tiempo suficiente. P:324–328. |
| 5 | parcial | Hay leases y tokens, pero faltan transiciones por presupuesto, propagación del fallo al padre y recuperación independiente de las cuotas. N02–N03. |
| 6 | cerrado | El lock sobre la generación serializa los dos últimos resultados y evita el cierre perdido de esa misma generación. P:309–314. |
| 7 | parcial | Existe `generation_id`, pero un único puntero no alcanza para generaciones parciales concurrentes; tampoco queda definido el almacenamiento de las entradas históricas. N05–N06. |
| 8 | parcial | La publicación es inmutable, pero una asignación reasignable no fija por sí sola qué publicación corresponde a cada borrador, entrega y corrección. N09. |
| 9 | cerrado | Las tres rutas largas tienen trabajos y tickets explícitos. Que esos trabajos entren en 40 s requiere otra comprobación: N25. |
| 10 | parcial | Se limitan los sandboxes, pero las cuentas anónimas se crean antes del límite y la purga solo contempla cuentas asociadas a sandboxes. N14. |
| 11 | parcial | La reserva atómica está prevista, pero faltan una cota conservadora, el tratamiento del consumo incierto y la cobertura de llamadas sincrónicas. N04. |
| 12 | parcial | Se cierra el SELECT directo de las tablas nombradas, pero las copias de perfiles en versiones, generaciones e historiales pueden eludir la auditoría. N13. |
| 13 | cerrado | El consentimiento se comprueba al encolar y ejecutar; revocarlo cancela lo pendiente en la misma transacción. P:352. Quedan reglas de entrega y dictado por precisar en N10. |
| 14 | parcial | Ahora se respaldan los archivos, pero no se define un conjunto restaurable consistente ni se resuelve la contradicción sobre PITR y retención. N27. |
| 15 | cerrado | El email sintético por UUID elimina la colisión entre usuarios homónimos de distintos colegios. P:26, 390. |
| 16 | cerrado | Identidad global y membresías permiten trabajar en varias instituciones. P:210–213. |
| 17 | cerrado | Se reserva antes de firmar y se comprueban tamaño y firma del contenido al confirmar. P:367–371. Falta cerrar las operaciones directas: N12. |
| 18 | parcial | El nuevo mecanismo puede prescindir de `after()`, pero responder después de 50 s puede superar el timeout de headers de Edge. N18. |
| 19 | parcial | Se arreglan las dependencias señaladas, pero permanecen compuertas que requieren infraestructura o publicación todavía no implementadas. N21. |
| 20 | parcial | Los contratos nacen cerrados, pero el turno de migraciones no impide que un `db reset` del orquestador interrumpa a otros tickets. N20. |
| 21 | parcial | Hay reconciliación y primitivas concretas para Paula; falta verificar la identidad de cuentas recuperadas y definir el protocolo de sesión guardada. N15 y N23. |
| 22 | parcial | La importación tiene idempotencia y reanudación; las previews siguen pudiendo compartir staging y no se concreta la compatibilidad durante despliegues. N17. |
| 23 | parcial | Se corrigen los textos y se añaden plazos y borrado; faltan derivados personales y la prevención de su reaparición al restaurar. N16. |

**Resultado: 8 cerrados, 15 parciales y ninguno completamente abierto.** “Cerrado” significa cerrado en el diseño descrito, no implementación validada.

Referencias: **P** es [PLATAFORMA.md](C:/Users/adrim/build101/docs/PLATAFORMA.md); contrasté los IDs con [la primera revisión](C:/Users/adrim/build101/docs/revisiones/plataforma-codex-1.md), [CLAUDE.md](C:/Users/adrim/build101/CLAUDE.md) y [ROADMAP.md](C:/Users/adrim/build101/docs/ROADMAP.md). Los escenarios siguientes son consecuencias posibles de contratos incompletos o contradictorios; no fallos reproducidos de una implementación SQL, que todavía no existe en el repo.

**N01 — Alta. Seguridad y aislamiento, P:166–170: las RPC internas pueden conservar acceso público.**

- **Problema:** la revocación nombrada omite `PUBLIC`. Los grants son acumulativos: conceder después solo a `service_role` no elimina permisos heredados.
- **Escenario:** una función interna `security definer` nace con el permiso predeterminado y un usuario invoca directamente una operación de presupuesto, aprovisionamiento o purga.
- **Cambio a escribir:** revocar `EXECUTE` global predeterminado a `PUBLIC` para cada rol creador de funciones; revocar también los grants existentes y directos correspondientes. Añadir pruebas de privilegios **efectivos** y llamadas negativas a todas las RPC internas como `anon` y `authenticated`. Supabase documenta expresamente ambas revocaciones. [Documentación oficial](https://supabase.com/docs/guides/database/functions).

**N02 — Alta. Reclamar trabajos y concurrencia, P:303 y 346: `SKIP LOCKED` no garantiza las cuotas.**

- **Problema:** bloquear un trabajo evita su doble reclamo; no serializa el conteo de otros trabajos ni la ocupación global. Tampoco se define si un lease vencido sigue contando como `running`.
- **Escenario:** con tres trabajos institucionales activos, dos transacciones cuentan tres y reclaman filas distintas: quedan cinco. En el otro extremo, cuatro trabajos muertos pueden impedir su propia recuperación si el límite se comprueba antes de descontarlos.
- **Cambio a escribir:** especificar un protocolo transaccional de adquisición de plazas globales e institucionales, con orden de locks fijo. Definir como ocupación los leases vigentes y recuperar vencidos sin depender de una plaza adicional. Probar simultáneamente cuota institucional, global y recuperación con ambas cuotas llenas.

**N03 — Alta. Máquina de estados, P:301–322 y 351: faltan salidas completas.**

- **Problema:** reclamar consume intento, pero no existe una transición explícita para “no ejecutado por presupuesto”. Tampoco se define cómo un trabajo terminal fallido o cancelado termina su generación y actualiza la versión.
- **Escenario:** un trabajo sin presupuesto consume intentos sin llamar a la IA; otro agota tres intentos y deja la versión eternamente en `generating`, porque el cierre solo contempla que todos terminen bien.
- **Cambio a escribir:** añadir una operación de aplazamiento sin consumo de intento de ejecución; definir estados y transiciones del padre para éxito, fallo, cancelación y resultado obsoleto. Todas deben fijar fechas, liberar recursos y hacer que `/progress` deje de considerar activo un trabajo terminal.

**N04 — Alta. Concurrencia y gasto, P:287–289 y 347–361: la reserva todavía no establece un tope real.**

- **Problema:** `estimate` no tiene una cota definida. Liberar una reserva por vencimiento del lease tampoco demuestra que el proveedor no haya cobrado. El protocolo se atribuye al worker, dejando sin contrato equivalente dictado, comandos y TTS.
- **Escenario:** Anthropic procesa una llamada cuya respuesta se pierde; vence la reserva, se libera y un reintento por OpenRouter vuelve a gastar ese dinero. Cancelar impide guardar el resultado, pero no elimina el consumo.
- **Cambio a escribir:** reservar por intento de proveedor con límites conservadores de entrada, salida y precio; registrar separadamente consumo confirmado e incierto. La liquidación debe ser idempotente y admitir resultados tardíos aunque ya no sean publicables. Aplicar presupuesto y concurrencia a **todas** las llamadas pagadas. Definir además qué día contable corresponde a una reserva que cruza medianoche.

**N05 — Alta. Generaciones, P:236–240 y 307–313: un único `current_generation_id` hace incompatibles operaciones independientes.**

- **Problema:** `full`, `exercise` y `answer_key` comparten versión y puntero de vigencia.
- **Escenario:** el profe regenera el ejercicio 2 y luego el 4. La segunda generación vuelve obsoleta la primera. Generar una rúbrica también puede desplazar la adaptación; el finalizador genérico intenta llevar la versión a `ready` aunque solo haya terminado una clave.
- **Cambio a escribir:** definir exclusión explícita por versión o vigencia por recurso: versión completa, ejercicio y clave. El finalizador debe depender del tipo de generación y de su revisión objetivo. Probar dos regeneraciones distintas, regeneración más clave y generación completa frente a edición.

**N06 — Alta. Entradas fijas y cierre, P:156, 238, 265 y 307–313: faltan las revisiones que el protocolo necesita.**

- **Problema:** el formato de ejercicio no contiene `revision`, aunque el protocolo exige escribir con “su revision”. Para las entradas se enumeran contadores de revisión, pero no dónde recuperar el original, programa y configuración históricos.
- **Escenario:** dos trabajos reemplazan partes de un mismo JSON de ejercicios y uno pierde el cambio del otro; o un reintento carga el programa actualizado porque solo conserva el número anterior.
- **Cambio a escribir:** almacenar snapshots inmutables o referencias a revisiones realmente conservadas, incluyendo conocimiento pedagógico y prompt. Definir revisiones por ejercicio y escrituras condicionales atómicas. Coordinar iniciar, cancelar, editar y completar mediante un orden común de locks; el lock de una generación no protege por sí solo otra generación de la misma versión.

**N07 — Alta. Eventos, P:239 y 313: la unicidad propuesta pierde feedback que hoy ya se conserva.**

- **Problema:** `UNIQUE(generation_id, type)` limita también `edited`, `approved` y `rejected`, no solamente el cierre generado.
- **Escenario:** una segunda edición falla por unicidad o se descarta con `ON CONFLICT`. Usar `generation_id = NULL` para evitarlo pierde la atribución. Además, si el original de IA se captura recién al cerrar, una edición intermedia puede contaminarlo.
- **Cambio a escribir:** eventos append-only con identidad propia e idempotencia por operación. Reservar una restricción específica para el único cierre `generated`. Guardar cada salida original de IA antes de cualquier edición, las revisiones editadas, actor, motivos y aprobación de una revisión concreta. Preservar el historial importado.
  
Esto es una regresión respecto de [VersionEvent](C:/Users/adrim/build101/lib/groups/types.ts:49) y [withEvent](C:/Users/adrim/build101/lib/groups/history.ts:5), que actualmente permiten múltiples eventos.

**N08 — Alta. Modelo de versiones y roadmap, P:236–247 y 425: falta la atribución histórica por estudiante.**

- **Problema:** `version_students` permite versiones individuales —eso es compatible con marzo—, pero una relación mutable no documenta para quién se produjo y revisó cada adaptación. Tampoco hay un contrato de eventos pseudonimizados del estudiante.
- **Escenario:** una versión compartida se divide o cambia de destinatarios; después se atribuyen ediciones, rechazos o decisiones al alumnado actual, no al que motivó esos cambios.
- **Cambio a escribir:** conservar destinatarios históricos y vínculos inmutables entre estudiante pseudonimizado, revisión, publicación y eventos. Prever la relación entre base y adaptación individual, identificadores estables de tema y un registro extensible de feedback y uso. Las decisiones futuras deben referenciar evidencia, catálogo, valores y confianza; esos registros deben ser exportables y borrables. No hace falta implementar ahora el motor, pero sí conservar sus datos de entrada.

**N09 — Alta. Publicaciones y entregas, P:247–274: reasignar cambia indirectamente el enunciado de una respuesta.**

- **Problema:** entregas y notas apuntan a la asignación, cuyo `publication_id` puede cambiar. “Guardar el borrador viejo” no define una entidad ni cómo se recupera. La clave sigue siendo por versión mutable.
- **Escenario:** Paula comienza P1; el profe la reasigna a P2 y después consulta o corrige el borrador anterior. El join por asignación devuelve P2 o una clave regenerada.
- **Cambio a escribir:** introducir intentos de asignación o fijar `publication_id` y revisión de clave en cada borrador, entrega y corrección. La reasignación debe crear otro intento, preservando el anterior. Publicar y empezar deben bloquear la misma asignación para resolver su carrera. Los IDs de ejercicios y preguntas deben validarse contra la publicación fijada.

**N10 — Alta. Publicar y retirar, P:235, 267–275 y 722–723: faltan invariantes de acceso y aprobación.**

- **Problema:** no se concreta qué significa “empezada”, cómo se aplican las fechas en RPC, qué permite una publicación retirada ni qué revisiones invalida una edición.
- **Escenario:** una pestaña conserva P1 y guarda después de retirarla; otra accede antes de `publish_at`. Un cambio de preguntas o clave mantiene una aprobación anterior. Un DTO publicado con voz sigue habilitando dictado tras revocarse el consentimiento.
- **Cambio a escribir:** definir una matriz de lectura, guardado, entrega y corrección por estado, fecha e intento. `publish_version` debe comprobar atómicamente revisión aprobada, vigencia y componentes requeridos. Separar el contenido histórico inmutable de las autorizaciones actuales, incluido el consentimiento del dictado. La aprobación de una versión compartida no debe publicar cambios futuros sin nueva revisión.

**N11 — Alta. Capas y autoridad, P:104–105, 168–169 y 196: las reglas no permiten implementar varios servicios.**

- **Problema:** solo repos puede importar `db/**`, pero solo jobs, servicios admin y tests pueden importar `db/admin.ts`: los conjuntos permitidos no coinciden. Además, cancelar es interno y no se define su entrada pública autorizada. Una institución tampoco se deduce unívocamente de `auth.uid()` cuando hay varias membresías.
- **Escenario:** el implementador rompe ESLint o mueve consultas al servicio; para cancelar termina usando la clave secreta con un ID recibido del navegador, salteando la autorización en base.
- **Cambio a escribir:** definir repos privilegiados explícitos y separar RPC públicas autorizadas de primitivas internas. El destino institucional puede recibirse como selector o derivarse del recurso, pero debe validarse contra la membresía; el actor se obtiene siempre de la sesión. Toda operación con efectos en Auth o Storage debe partir de una autorización/intención persistida en base.

**N12 — Alta. Archivos, P:233 y 365–378: relación de lectura no equivale a permiso de modificación ni a reserva válida.**

- **Problema:** se exige “poder ver” la entidad para las operaciones de Storage, sin concretar la asociación en `files`, el estado permitido ni la diferencia entre leer, insertar y borrar.
- **Escenario:** un usuario relacionado con el grupo usa directamente Storage para insertar un objeto sin reserva o borrar un consentimiento. Un consumidor descarga un objeto todavía no confirmado.
- **Cambio a escribir:** asociaciones verificables por FK y finalidad, ruta inmutable, reserva válida y permisos distintos por operación. Solo objetos `ready` pueden consumirse. No conceder borrado por el mero derecho de lectura. Los consentimientos deben entregarse por una autorización auditada; permitir su descarga autenticada directa eludiría esa auditoría. Las URLs firmadas requieren también su propio registro de autorización.

**N13 — Alta. Lecturas sensibles, P:184 y 224–239: la clasificación no cubre las copias.**

- **Problema:** perfiles y apoyos también aparecen en `student_need_events`, configuración de versiones, snapshots de generación y posiblemente eventos. La lista de tablas sin SELECT directo no los cubre inequívocamente.
- **Escenario:** un profe consulta versiones y `version_students` directamente, reconstruye el perfil de un estudiante y no queda ningún acceso auditado.
- **Cambio a escribir:** clasificar sensibilidad por campos y derivados, no solo por tabla original. Todo resultado que revele perfil, historial clínico o notas privadas debe pasar por una lectura auditada. Ofrecer proyecciones separadas para listados que no necesitan esos campos y probar las combinaciones de tablas que permitirían reconstruirlos.

**N14 — Alta. Demo, P:402–414: limitar sandboxes no limita todas las cuentas anónimas.**

- **Problema:** `signInAnonymously()` ocurre antes de `create_sandbox()`. Si el segundo paso falla o el cliente nunca lo ejecuta, la cuenta no pertenece a ningún sandbox y no entra en la purga descrita.
- **Escenario:** un cliente repite altas anónimas sin crear instituciones. Crecen las cuentas aunque no se supere el límite de 500 sandboxes.
- **Cambio a escribir:** definir límites de Auth además de los límites de creación, origen confiable de la IP y limpieza de anónimos huérfanos. Los contadores deben ser atómicos y no aceptar IP declarada por el cliente. Las restricciones del sandbox deben depender también de institución y capacidades, porque Paula tiene una cuenta no anónima. Supabase confirma que el alta crea un usuario y que no existe limpieza automática. [Documentación oficial](https://supabase.com/docs/guides/auth/auth-anonymous).

**N15 — Alta. Aprovisionamiento, P:386–390: “el email ya existe” no prueba que sea la cuenta correcta.**

- **Problema:** el protocolo enlaza por coincidencia de email, sin acreditar que esa identidad fue creada por esta operación ni resolver carreras con baja y reconciliación.
- **Escenario condicionado:** si Auth admite un alta externa con el email sintético, reconciliar podría vincular una cuenta ajena. También puede recrearse una cuenta mientras otro proceso está borrando al estudiante.
- **Cambio a escribir:** bloquear altas públicas del dominio sintético y verificar una vinculación administrativa inmutable con la operación y el estudiante. Definir exclusión, unicidad, tombstone de baja y compensación para cada paso. Si se pierde la contraseña inicial, generar otra mediante un flujo autorizado; no intentar recuperarla ni guardarla en claro. Las invitaciones deben comprobar también la identidad destinataria al aceptarse.

**N16 — Alta. Borrado y exportación, P:420–427 y 451: el grafo de datos personales queda incompleto.**

- **Problema:** quedan fuera generaciones, destinatarios históricos, `student_need_events`, análisis de grupo y futuros datos aprendidos. “No llevan datos de estudiantes” no se deduce de que no haya nombre o ID: una adaptación individual sigue siendo atribuible.
- **Escenario:** se borra a Paula, pero su análisis y preferencias siguen vinculables; una restauración anterior al borrado los vuelve a poner en servicio.
- **Cambio a escribir:** inventariar sujetos y derivados, definir eliminación o anonimización verificable de cada uno y distinguir artefactos compartidos. Exportar el mismo grafo. Incluir preferencias, dominio, decisiones y evidencia del motor. Mantener un registro de supresiones que permita reaplicarlas tras restaurar, antes de abrir accesos y reactivar trabajos.

**N17 — Alta. Despliegue, P:49, 443–445 y 743: expand/contract está incompleto para Netlify y Branching.**

- **Problema:** aplicar migraciones antes de publicar no implementa por sí solo dual-write, backfill, transición de lectores y retirada. Tampoco se concreta qué impide que Netlify publique antes de CI o que Branching ejecute otra vía de migración.
- **Escenario:** durante el despliegue sigue activo código viejo que escribe solo la columna antigua. El siguiente deploy la elimina; una pestaña antigua, función o rollback queda incompatible. Una preview con migraciones falla contra staging viejo aunque no aplique SQL.
- **Cambio a escribir:** una única autoridad de migración, exclusión entre despliegues, publicación bloqueada por éxito del mismo SHA y protocolo explícito de backfill y compatibilidad. Contraer después de retirar lectores y escritores antiguos, incluyendo workers y rollback. Cada preview debe esperar su base compatible y credenciales; compartir staging exige una restricción adicional. Supabase Branching tiene su propio flujo automático y credenciales por rama. [Documentación oficial](https://supabase.com/docs/guides/deployment/branching).

**N18 — Alta. Plan B, P:336–342 y T0.6: 50 s antes de responder pueden ser demasiados.**

- **Problema:** el plan B conserva llamadas a rutas de Next y `proxy.ts`, pero puede tardar 50 s en emitir headers. Netlify documenta un timeout de headers de Edge de 40 s.
- **Escenario:** un trabajo tarda 45 s; el cliente o Cron recibe timeout antes de que el worker responda, aunque la función todavía esté procesando.
- **Cambio a escribir:** determinar y probar la ruta real del plan B. Excluir el paso por Edge cuando corresponda, con autenticación dentro del handler, o emitir headers mediante streaming y esperar el procesamiento dentro de la invocación. T0.6 debe probar específicamente un trabajo de 45–50 s, tanto desde Cron como desde `/kick`, no solo un 202 seguido de `after()`. [Límites oficiales de Edge](https://docs.netlify.com/build/edge-functions/limits/).

**N19 — Alta. DTO del estudiante, P:185–191 y T4.7: no alcanza para conservar el flujo actual.**

- **Problema:** faltan respuestas guardadas, elecciones, revisión del borrador, metadatos de tarea, nota y devolución. Cambiar `stepsOf` tampoco migra todos los consumidores de perfiles.
- **Escenario:** al volver a una tarea no se pueden restaurar respuestas; desaparece “Mis calificaciones”; se rompe la preparación de mirada o voz. La prueba que prohíbe cualquier `answer` rechaza la respuesta propia de `/api/answers/transcribe`.
- **Cambio a escribir:** DTOs separados y completos para lista, resolución, borrador y corrección, con allowlists por contexto. Prohibir la **clave correcta**, permitiendo respuestas propias. Migrar también [StudentGaze](C:/Users/adrim/build101/components/student/gaze/StudentGaze.tsx:12), [StudentVoice](C:/Users/adrim/build101/components/student/voice/StudentVoice.tsx:11) y [MyGrades](C:/Users/adrim/build101/components/student/MyGrades.tsx:14). Las capacidades de navegación necesitan un contrato neutral, sin exponer diagnósticos.

**N20 — Media. Turno de base, P:519–522 y 558: el reset sigue pudiendo interrumpir trabajo ajeno.**

- **Problema:** el turno restringe migraciones de implementadores, pero el orquestador ejecuta `db reset` después de cada merge mientras otros tickets pueden seguir usando la misma base.
- **Escenario:** un test de otro worktree pierde sus fixtures o valida contra migraciones que su rama no contiene.
- **Cambio a escribir:** extender el turno a resets, semillas y pruebas dependientes del esquema; exigir una barrera de inactividad y sincronización de ramas antes de cambiarlo. Alternativamente, aislar Supabase por worktree. Cada validación debe registrar el conjunto exacto de migraciones con el que corrió.

**N21 — Media. DAG y compuertas, P:487–494, 603–617 y 473–484: hay dependencias todavía invertidas.**

- **Problema:** T0.4 exige CI completo con Supabase antes de T1.1. En fase 4 se exige que el estudiante resuelva y entregue, pero el ticket explícito de `publish_version` llega en fase 8.
- **Escenario:** una fase no puede cerrar sin adelantar tickets, conservar un camino antiguo no documentado o debilitar silenciosamente sus pruebas.
- **Cambio a escribir:** un DAG con dependencias y compuertas activadas incrementalmente. Implementar la publicación mínima necesaria para el flujo de fase 4 y dejar para fase 8 su ampliación. T1.8 debe probar únicamente operaciones ya implementadas hasta que la matriz completa pueda ser obligatoria.

**N22 — Media. Lecturas auditadas y rendimiento, P:177–184 y 435: la optimización SQL prometida no es general.**

- **Problema:** envolver una función en `SELECT` no garantiza una evaluación por consulta cuando depende de `institution_id`, `group_id` o `student_id` de cada fila. Tampoco hay contrato de paginación y proyecciones para roster, búsqueda y detalle.
- **Escenario:** un listado hace autorizaciones repetidas por estudiante; el autosave provoca relecturas de perfiles y escrituras masivas de auditoría. Cachear después esos resultados puede omitir nuevas comprobaciones o registros.
- **Cambio a escribir:** lecturas de conjunto, índices y paginación; separar resúmenes sin perfil de lecturas sensibles. Definir auditoría por divulgación de datos y deduplicación dentro del pedido, sin caché compartida que eluda autorización. Medir planes y latencia con tamaños representativos. Supabase limita expresamente esa optimización a resultados independientes de los datos de la fila. [Documentación oficial](https://supabase.com/docs/guides/database/postgres/row-level-security).

**N23 — Media. “Ver como Paula”, P:409–413: las primitivas existen, pero falta el protocolo de retorno.**

- **Problema:** `httpOnly` no define integridad, asociación al sandbox, expiración ni tratamiento de la rotación de tokens. Tampoco se aclara qué cliente verifica el OTP.
- **Escenario:** una pestaña o un proxy refresca la sesión guardada, otra intenta restaurar una copia obsoleta; o un retorno conserva cookies o caché de Paula.
- **Cambio a escribir:** usar un cliente administrativo sin sesión persistente para generar el enlace y un cliente SSR del pedido para verificar `token_hash` y establecer cookies. Guardar la sesión de retorno mediante un identificador opaco en servidor o un contenedor autenticado, ligado al sandbox y al propietario. Definir consumo, limpieza, expiración y pruebas con dos pestañas y refresh.
  
`generateLink`, `verifyOtp` y `setSession` están documentados; **la secuencia completa no fue probada**. [generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp), [setSession](https://supabase.com/docs/reference/javascript/auth-setsession).

**N24 — Media. Idempotencia, P:316–322: el análisis diario confunde repetición con datos nuevos.**

- **Problema:** `analyze:<group_id>:<día>` identifica un día, no las entradas del análisis.
- **Escenario:** se corrigen más entregas y se vuelve a pedir el análisis esa tarde; se devuelve el trabajo anterior o se impide analizar los resultados nuevos.
- **Cambio a escribir:** clave por snapshot o hash de entradas y versión del analizador, además de una clave de operación para dobles clics. Separar “repetir la misma petición” de “analizar otra revisión”. Fijar también el mapeo de seudónimos del resultado.

**N25 — Media. Handlers largos, P:284–286 y T3.4–T3.5: mover a jobs no reduce su duración.**

- **Problema:** se reemplazan rutas con presupuestos de 110–280 s por trabajos cuya IA tiene 40 s, sin estrategia de partición. T3.0 solo compara generación de prácticos.
- **Escenario hipotético de capacidad:** un programa largo necesita más de 40 s; los tres intentos repiten la misma operación y terminan fallando.
- **Cambio a escribir:** límites verificables de páginas, contenido y salida por handler; partición y checkpoints cuando corresponda, o un ejecutor adecuado para la operación indivisible. Añadir pruebas de capacidad para documentos, programa y análisis. Los `maxDuration` actuales demuestran el presupuesto anterior, no la latencia real; esta última sigue sin medir.

**N26 — Media. Disparos y fairness, P:330–346: faltan capacidad de drenaje y orden implementable.**

- **Problema:** no se guarda el dato necesario para “la institución que hace más que no corre nada”. Cron dispara aparentemente un solo trabajo por tick y `/kick` puede favorecer al colegio que mantiene más pantallas abiertas.
- **Escenario:** tras cerrar el navegador quedan cientos de ejercicios; un disparo cada 10 s permite como máximo seis reclamos por minuto. Con el fallback de un minuto, uno. El límite global de 20 no aporta ese paralelismo.
- **Cambio a escribir:** estado de scheduling y desempate persistentes, reclamados atómicamente; dispatcher que reponga plazas hasta los límites. `/kick` debe respetar la misma política, sin elegir trabajo arbitrario. Separar mantenimiento para que purga y vencimientos no queden detrás de una institución con una cola grande.

**N27 — Media. Respaldos, P:48–50 y 447–452: faltan decisiones operativas necesarias para cumplir los objetivos.**

- **Problema:** PITR aparece como opcional y después como parte del respaldo con pérdida de minutos. “R2 con versionado” no especifica si significa snapshots propios o una capacidad nativa. Tampoco se define la correspondencia entre instante de base y archivos.
- **Escenario:** restaurar la base deja referencias a objetos ausentes, o la copia diaria sobrescribe el único respaldo útil. Pausar jobs no resuelve esos faltantes.
- **Cambio a escribir:** elegir PITR o modificar el RPO; definir snapshots inmutables de objetos con manifiesto, hashes, retención y procedimiento de reconciliación. Incluir configuración necesaria de Auth, Storage, secretos y Cron en el runbook. Los backups diarios de Pro consultados conservan siete días y no incluyen los objetos de Storage; los 30 días necesitan una política propia. [Backups oficiales](https://supabase.com/docs/guides/platform/backups). **No verifiqué una capacidad nativa de versionado de R2.**

**N28 — Media. IA y roadmap, P:220, 234 y 358: materia y conocimiento pedagógico no quedan suficientemente versionados.**

- **Problema:** tener materia en grupo/programa no asegura que sea parámetro del proveedor, prompt, catálogo de errores y verificador. El traslado “sin cambiar prompts” conserva el `SYSTEM` de matemática. Tampoco se fija qué revisión de los perfiles validados usa una generación.
- **Escenario:** una generación de Física hereda instrucciones matemáticas; un cambio posterior del catálogo impide explicar por qué una adaptación anterior aplicó cierta regla.
- **Cambio a escribir:** `subject_id` obligatorio y resuelto en servidor, con selección explícita de prompt, notación, errores y verificadores. Fijar revisión o hash del conocimiento aprobado y sus fuentes en cada generación. Prever borradores separados de revisiones aprobadas para el investigador; no hace falta construir ahora su panel. T0.7 debe preservar expresamente las reglas del roadmap al reescribir CLAUDE.md.

**N29 — Media. Jobs y presupuesto frente al roadmap, P:301, 327 y 350: el contrato uniforme dificulta los lotes.**

- **Problema:** todos los tipos comparten ejecución de 50 s y reservas que vencen con un lease de 90 s. Eso no representa una tarea externa por lotes que continúa después de la invocación.
- **Escenario:** al incorporar práctica periódica se fuerza a ejecutar en llamadas individuales o a mantener leases y reservas artificialmente abiertos; compite con la generación urgente del profe.
- **Cambio a escribir:** declarar ahora que ese protocolo corresponde a ejecución interactiva. Prever clase de trabajo, ventana horaria, prioridad, identificador externo y seguimiento de lotes separado de los leases de procesamiento. Sus reservas deben corresponder al ciclo del lote. La investigación y la práctica quedan fuera de alcance funcional, pero no deben quedar obligadas al ejecutor sincrónico actual.

**N30 — Media. Pruebas y aprobación, P:461 y 808: la compuerta no expresa todo WCAG 2.2 AA.**

- **Problema:** teclado, lector de pantalla, celular y axe son comprobaciones útiles, pero no constituyen por sí solas el criterio de aceptación exigido por CLAUDE.md.
- **Escenario:** pasan los tests y aun así el login impone una barrera cognitiva, el foco queda oculto, una interacción exige arrastrar o el vencimiento de sesión pierde una respuesta.
- **Cambio a escribir:** conservar WCAG 2.2 AA como requisito explícito y asignar comprobaciones automáticas y manuales por flujo: autenticación accesible, foco visible y no oculto, reflow/zoom, alternativas a arrastre, tamaño de objetivos, errores y estados anunciados, y recuperación de sesiones sin pérdida de trabajo. Incluir mirada y voz como mecanismos adicionales. [Referencia oficial de WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/).

**Qué verifiqué y qué queda sin verificar**

- **Spec y código:** leí ambos documentos de ronda 1, el spec completo, CLAUDE.md y ROADMAP.md; contrasté store, contratos, historial, generación, prompts, rutas largas y consumidores del estudiante. Confirmé que el código actual ya conserva originales y eventos de feedback. No encontré todavía `supabase/` ni el worker propuesto.
- **Next incluido en el proyecto:** consulté `authentication-with-cache-components.md`, `use-cache-private.md`, `server-actions.md` y `after.md`. Respaldan los patrones descritos de sesión, Suspense, despacho de acciones, límite predeterminado de 1 MB y duración de `after()` dependiente de la plataforma.
- **Documentación oficial:** comprobé soporte declarado de `after()` y Cache Components en [Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/), límites de [60 s y payload](https://docs.netlify.com/build/functions/configuration/?fn-language=js), región `gru`, timeout de Edge, privilegios/RLS de Supabase, primitivas de sesión, Branching y exclusión de Storage de los backups. También consulté [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net) y [Cron](https://supabase.com/docs/guides/cron/quickstart).
- **Sin verificar en ejecución:** SQL concurrente, adaptador desplegado, plan B, integración Netlify–Branching, latencias, límites configurados de Auth, sesiones de Paula, restauración completa, versionado nativo de R2 y conformidad WCAG. No ejecuté builds ni tests, y no creé, modifiqué ni eliminé archivos.

[exited with code 0]
