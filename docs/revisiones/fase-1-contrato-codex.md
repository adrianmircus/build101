# Revisiones de Codex del contrato de la fase 1

Nueve rondas sobre `plataforma/f1-contratos` hasta el veredicto «contrato listo». Cada ronda, tal como la devolvió Codex.

## Ronda 1

Revisión completada sin editar archivos. Pasaron tipos, lint y las 429 pruebas unitarias. pgTAP e integración no pudieron ejecutarse por restricciones del entorno sobre Supabase/Docker; los hallazgos SQL se basan en revisión estática.

1. **C1 · alta · `docs/contratos/fase-1.md:401` — La correspondencia de la clave no identifica todo el contenido.**  
   **Problema:** compara revisiones de ejercicios e ids de preguntas, pero omite las revisiones de las preguntas y sus opciones. Tampoco exige que editarlas incremente la revisión del ejercicio padre. Además, T1.4e indica guardar revisiones «de hoy» incluso para una clave generada.  
   **Escenario:** se intercambian las opciones A/B conservando el id, se vuelve a aprobar y la clave anterior sigue correspondiendo según esa comparación. Una generación tardía también puede quedar asociada al contenido posterior.  
   **Corrección:** comparar revisiones de preguntas o exigir el incremento del ejercicio padre; las claves generadas deben conservar el snapshot de entrada y comprobar su vigencia antes de convertirse en actuales.

2. **C2 · alta · `supabase/migrations/20261111130500_assessments_versions.sql:59` — Las instrucciones generales quedan fuera de la revisión aprobada.**  
   **Problema:** están en `assessments`, pero no en la versión ni en `VersionDetail`. T1.4a tampoco exige invalidar las aprobaciones cuando cambian.  
   **Escenario:** se aprueba una versión, se cambian las instrucciones del práctico y se publica con instrucciones que esa aprobación nunca cubrió. Reaparece R3-18.  
   **Corrección:** fijar cómo las instrucciones forman parte del contenido revisado, mostrarlas en la revisión y exigir que sus cambios incrementen las revisiones afectadas e invaliden sus aprobaciones.

3. **C3 · media · `docs/contratos/fase-1.md:341` — Una generación puede invalidar sus propias salidas hermanas.**  
   **Problema:** toda salida exige la revisión inicial del ejercicio, mientras aplicar su texto incrementa esa revisión. El protocolo admite salidas `exercise` y `gaze_questions`, pero no distingue cambios propios de una edición posterior.  
   **Escenario:** llega el texto y sube de r1 a r2; las preguntas de esa misma generación encuentran r2 y quedan `obsolete`.  
   **Corrección:** definir la procedencia y las revisiones esperadas por etapa, preservando que una edición manual gane. Probar texto y preguntas en ambos órdenes, con reintentos.

4. **C4 · media · `docs/contratos/fase-1.md:377` — Entregar invierte el orden de locks declarado.**  
   **Problema:** bloquea intento y borrador antes de actualizar la asignación, aunque el orden exige asignación → intento → borrador.  
   **Escenario:** entregar retiene el intento y espera la asignación; una operación de publicación o reasignación que sigue el orden contractual retiene la asignación y espera ese intento. Es el patrón de interbloqueo descrito por [PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).  
   **Corrección:** resolver primero el id sin lock y bloquear asignación, intento y borrador en ese orden. Añadir una prueba simultánea entre entrega y una operación sobre la asignación.

5. **C5 · media · `docs/contratos/fase-1.md:312` — El protocolo CAS no garantiza la repetición idempotente concurrente.**  
   **Problema:** consulta `op_id` antes del lock y no vuelve a comprobarlo después. Tampoco verifica que ese identificador pertenezca al mismo recurso y operación.  
   **Escenario:** dos pedidos iguales pasan la consulta inicial; el segundo espera, encuentra una revisión nueva y devuelve `CONFLICT` en lugar del resultado repetido. Reusar el identificador en otro recurso también puede producir un éxito aparente sin aplicar nada.  
   **Corrección:** comprobar nuevamente la operación bajo el lock, antes del CAS, y validar su identidad. Probar duplicados simultáneos y reutilización entre recursos.

6. **C6 · media · `lib/domain/groups/rpc.ts:17` — Los DTO de grupos no representan a todos sus lectores autorizados.**  
   **Problema:** `GroupSummary` y `GroupDetail` exigen `myRole: owner | co_teacher`, pero admin e inclusión pueden leer grupos sin pertenecer a su staff.  
   **Escenario:** T1.2b debe inventarles un rol docente o devolver una respuesta que el repo rechazará. Reproduje que `myRole: null` falla en el esquema.  
   **Corrección:** admitir explícitamente ausencia de rol docente y probar ambos lectores. Es un cambio del contrato que debe resolverse antes de repartir T1.2b.

7. **C7 · media · `supabase/migrations/20261111130200_groups_students.sql:141` — Las FK de actores contradicen la inmutabilidad del historial.**  
   **Problema:** eventos sensibles, eventos de versión y revisiones de clave usan `ON DELETE SET NULL` para su actor, pero sus triggers prohíben cualquier `UPDATE`. `publications.published_by` presenta la misma contradicción con su guardia.  
   **Escenario:** borrar una cuenta de Auth intenta borrar `app_users`; la acción referencial modifica el historial y recibe `P0004`, abortando la baja.  
   **Corrección:** definir una identidad histórica conservable o una desvinculación estrechamente permitida. Probar la eliminación del actor conservando los registros históricos.

8. **C8 · media · `supabase/migrations/20261111130700_delivery.sql:108` — La clave del intento no queda congelada.**  
   **Problema:** la guardia fija publicación y versión después de empezar, pero permite cambiar `answer_key_revision_id`. Su FK solo comprueba que sea de la misma versión.  
   **Escenario:** un intento empezado o entregado puede pasar a otra clave histórica sin cambiar de publicación; deja de cumplirse la garantía de corrección estable.  
   **Corrección:** congelar la clave junto con la publicación y garantizar su correspondencia con ella. Probar el rechazo del cambio después de empezar y después de entregar.

9. **C9 · media · `lib/domain/permissions/tables.ts:55` — El inventario obligatorio omite derivados personales.**  
   **Problema:** `STUDENT_DATA_TABLES` excluye `version_exercises`, `version_questions`, `question_keys`, `generation_outputs`, `answer_keys` y `answer_key_revisions`. T1.9 exige el tratamiento por campo únicamente para esa lista.  
   **Escenario:** el inventario y sus pruebas pasan sin justificar textos adaptados, salidas originales o rúbricas que siguen siendo atribuibles en versiones compartidas. Reaparece R3-7.  
   **Corrección:** incluir esos derivados —y revisar los restantes JSON de operaciones— con reglas explícitas de borrado, redacción o conservación y su justificación.

10. **C10 · media · `lib/domain/delivery/leaks.ts:27` — La prueba de fugas tiene puntos ciegos reproducibles.**  
    **Problema:** busca valores prohibidos únicamente como valores completos; no los comprueba en claves ni dentro de texto producido por el servidor.  
    **Escenario:** devolvió `[]` tanto para el id prohibido de otro estudiante usado como clave de `draft.answers` como para `body: "Adaptado para dyslexia"` teniendo `dyslexia` prohibido.  
    **Corrección:** inspeccionar también las claves y definir comprobaciones de contenido por contexto, respetando la excepción de las respuestas propias. Añadir ambos casos negativos y validar la estructura completa del DTO.

11. **C11 · media · `docs/contratos/fase-1.md:732` — T1.6a depende de trabajo que corre en su misma tanda.**  
    **Problema:** incluye repos e integración de grupos, pero sus lecturas pertenecen a T1.2b, que corre en paralelo en la tanda 2. Solo declara dependencia de T1.2a.  
    **Escenario:** su integración llama a `get_group` o `list_my_groups` todavía sin implementar y el ticket no puede cerrar sobre lo ya mergeado.  
    **Corrección:** separar `callRpc` y fábricas de los repos de grupos; estos últimos deben depender de T1.2b y ejecutarse después. También reduce el alcance excesivo de T1.6a. No encontré solapamientos de archivos de escritura dentro de las tandas actuales; se respeta un ticket de migraciones por tanda.

12. **C12 · media · `docs/contratos/fase-1.md:142` — Se posterga una precondición de privilegios de la base.**  
    **Problema:** se acepta que un creador de objetos, `supabase_admin`, conserve defaults abiertos y se difiere su revisión hasta T10.5. Esto contradice la revocación para todos los creadores exigida por el spec.  
    **Escenario:** un objeto creado por ese rol fuera del camino de migraciones nace ejecutable o legible por roles de API antes de que una prueba posterior lo detecte.  
    **Corrección:** establecer ahora un bootstrap privilegiado para cerrar esos defaults, o una restricción verificable que excluya a ese creador del esquema expuesto. La detección posterior no sustituye la precondición.

13. **C13 · media · `lib/domain/delivery/attempt-rules.ts:40` — La matriz ejecutable permite guardar y entregar un intento `opened`.**  
    **Problema:** devuelve `saveDraft: true` y `submit: true`, mientras el protocolo SQL exige `started` y crea el borrador recién al empezar.  
    **Escenario:** la UI habilita acciones que las RPC rechazan con `attempt_not_started`. Las pruebas actuales incluso usan `opened` para comprobar permisos después del vencimiento.  
    **Corrección:** representar por separado empezar y guardar/entregar; estas últimas capacidades deben requerir `started`. Cruzar estados con las situaciones temporales en las pruebas.

Respecto de **«Decisiones que cambian el spec»**:

| Decisión | Dictamen | Motivo |
|---|---|---|
| Lecturas no sensibles por RPC | **Acepto** | Mantiene proyecciones cerradas y una única frontera de autorización. |
| `op_key` único por institución | **Acepto** | Es una restricción coherente si la reutilización en otro recurso produce `CONFLICT`. |
| Renombrar `source_id` a `source_file_id` | **Acepto** | Aclara la relación; la procedencia de duplicados puede incorporarse después. |
| Adelantar publicación mínima a fase 1 | **Acepto** | Permite probar intentos y DTO mediante el camino real. |
| Mover las fábricas de T1.1 a T1.6a | **Acepto** | Usar RPC internas es adecuado; debe corregirse el reparto señalado en C11. |
| Partir también T1.2, T1.3 y T1.5 | **Acepto** | Reduce alcance y permite revisar cada área; T1.6a todavía merece otra separación. |
| Ejecutar T1.8 al final | **Acepto** | Es razonable manteniendo las pruebas de permisos por RPC en cada ticket. |
| `audit_log` y `erasures` sin FK a instituciones | **Acepto** | Su conservación debe sobrevivir a la baja institucional. |
| Nombres de versiones por posición | **Acepto** | Evita divulgar perfiles en listados. |
| Crear intentos como `opened` | **Acepto** | `first_viewed_at` distingue la visualización; debe corregirse C13. |
| Diferir el chequeo `store_profile` | **Acepto para datos sintéticos** | Es compatible con la compuerta previa a cualquier dato real. No habilita tratamiento real sin resolver el consentimiento escrito y la representación del menor; véase el [artículo 18 de la Ley 18.331](https://www.impo.com.uy/bases/leyes/18331-2008/18). |
| Conservar defaults abiertos de `supabase_admin` hasta T10.5 | **Rechazo** | Deja pendiente una garantía fundacional de privilegios: C12. |

Veredicto: contrato no listo — bloqueantes: C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12 y C13.

## Ronda 2

Revisión completada en modo solo lectura. **9 hallazgos anteriores están resueltos en el contrato y 4 quedan parciales. Encontré otros 4 de severidad media.** “Resuelto” se refiere al contrato: las RPC todavía son stubs.

Pasaron `typecheck`, `lint` y las **446 pruebas unitarias**. No pude ejecutar pgTAP ni integración: Supabase falló por permisos al escribir telemetría y Docker rechazó el acceso a su API. La revisión de SQL y concurrencia es estática. El worktree quedó sin cambios.

**C1–C13**

| Id | Estado | Resultado de intentar romper la corrección |
|---|---|---|
| C1 | **Parcial · alta** | Preguntas, opciones y snapshots generados quedaron cubiertos. Las instrucciones generales todavía pueden cambiar el significado de las respuestas sin romper la correspondencia de la clave. |
| C2 | **Resuelto** | Las instrucciones pertenecen a la versión, aparecen en su DTO, tienen revisión propia, invalidan la aprobación y se copian a la publicación. Cambiar el original conserva intacta esa copia. |
| C3 | **Resuelto** | La procedencia permite aplicar salidas hermanas en ambos órdenes; la edición manual borra esa procedencia. Se exigen pruebas de ambos órdenes, reintentos e intervención manual. |
| C4 | **Resuelto** | `lock_attempt_tree` toma asignación → intento → borrador. Entregar y publicar comparten el primer lock; además se exige su prueba concurrente. |
| C5 | **Parcial · media** | Se corrigió la comprobación bajo lock, pero la identidad guardada no distingue preguntas del mismo ejercicio ni edición de pregunta frente a edición de su ejercicio. |
| C6 | **Resuelto** | Ambos DTO admiten `myRole: null`; T1.2b exige probar admin e inclusión sin inventarles un rol docente. |
| C7 | **Resuelto** | Los cuatro actores históricos dejaron de tener FK. Hay una prueba de eliminación de la cuenta y otra que detecta acciones referenciales incompatibles con filas inmutables. |
| C8 | **Resuelto** | El trigger exige la clave de la publicación al insertar y actualizar; la guardia congela publicación y clave desde `started`. |
| C9 | **Parcial · media** | El inventario incorporó los derivados omitidos. Sin embargo, sus reglas de redacción contradicen guardias de inmutabilidad existentes. |
| C10 | **Parcial · media** | Ahora detecta claves prohibidas, perfiles dentro de texto y estructuras inválidas. Sigue omitiendo ids incrustados en texto y genera falsos positivos con opciones correctas visibles. |
| C11 | **Resuelto** | T1.6a quedó limitado a fábricas y `callRpc`. T1.6b espera a T1.2b y T1.6a y corre en la tanda siguiente. |
| C12 | **Resuelto** | Se reemplazó la postergación por aislamiento efectivo: únicamente `api` expuesto y `public` sin `USAGE` para los roles de usuario. La configuración hospedada queda como requisito explícito. |
| C13 | **Resuelto** | La matriz separa empezar de guardar/entregar. `opened` solo permite leer y empezar; las pruebas cruzan estados y situaciones temporales. |

Los cuatro bloqueantes anteriores requieren estos ajustes:

- **C1 · Alta — Las instrucciones siguen fuera de la correspondencia de la clave.**  
  Cambiar «expresá los resultados en centímetros» por «expresalos en metros» incrementa `instructions_revision` y la revisión de la versión, pero conserva los mapas de ejercicios y preguntas. Después de aprobar nuevamente, la clave anterior sigue “correspondiendo”: publicar compara esos mapas y explícitamente no confía en `stale`. Hay que incorporar la revisión de instrucciones al snapshot y a la comparación de claves generadas, editadas y confirmadas. Véanse [la comparación contractual](docs/contratos/fase-1.md:478) y [las columnas del snapshot](supabase/migrations/20261111130600_generations.sql:189).

- **C5 · Media — La identidad de la operación no identifica el recurso concreto.**  
  Dos `update_version_question` sobre preguntas distintas del mismo ejercicio pueden presentar la misma identidad al helper: institución, `op_id`, `edited`, versión y ejercicio. El segundo recibe el evento del primero, sin detectar reutilización; tampoco queda fijado cómo recuperar exactamente su revisión de pregunta. Hace falta identificar la operación concreta y la pregunta, y conservar su resultado para repetirlo. Añadiría pruebas pregunta↔pregunta y pregunta↔ejercicio. El problema está en [claim_version_op](supabase/migrations/20261111130600_generations.sql:222).

- **C9 · Media — Redactar una versión compartida contradice sus guardias.**  
  La regla exige quitar al estudiante de `recipients_changed` y redactar textos que lo nombren en salidas y publicaciones compartidas. `version_events`, `generation_outputs` y `answer_key_revisions` rechazan cualquier actualización; `publications` solo admite retiro y `generations_guard` congela `inputs`. T1.9 puede documentar esa redacción, pero T9.5 no puede ejecutarla según estas reglas. Debe definirse ahora un mecanismo compatible de supresión, sin perder las entregas de otros estudiantes. Compárense [las reglas de supresión](lib/domain/permissions/erasure.ts:34) con [los triggers](supabase/migrations/20261111130600_generations.sql:246).

- **C10 · Media — Hay falsos negativos y falsos positivos reproducidos.**  
  Ejecuté dos sondas en memoria: un `student_home` válido con `groups[0].name = "Referencia: <id-ajeno>"` devolvió `[]` aunque ese id estuviera prohibido; un `student_task` válido con opciones A/B devolvió `questions.0.options.0.id` al prohibir «A», la respuesta correcta. La prueba obligatoria de mirada confunde la opción que debe mostrarse con la revelación de cuál es correcta. Hay que comprobar ids incrustados en texto y distinguir secretos por contexto de las opciones y respuestas propias permitidas. Véanse [visitString](lib/domain/delivery/leaks.ts:40) y [la prueba exigida a T1.5d](docs/contratos/fase-1.md:831).

**Hallazgos nuevos**

- **C14 · Media — No existe una lectura para editar una opción correcta con CAS.**  
  `set_question_key` pide la revisión de la fila de `question_keys`, pero `get_version` devuelve preguntas sin clave ni revisión de clave. `get_answer_key` tampoco devuelve esa revisión por pregunta. Después de recargar, el docente no puede obtener el valor que debe enviar; la revisión de la pregunta puede ser distinta. Como `app` está cerrado, no hay otra lectura disponible. Hay que incluir `QuestionKey` en una proyección autorizada, preferentemente la revisión auditada de la versión. Referencias: [VersionDetail](lib/domain/assessments/rpc-versions.ts:34), [set_question_key](lib/domain/assessments/rpc-versions.ts:99).

- **C15 · Media — Mirada admite opciones ambiguas y claves imposibles.**  
  Reproduje que el esquema acepta opciones `[A, A]` y que `set_question_key` acepta «Z». SQL solo comprueba que las opciones sean un array y que la clave sea una letra; no hay guardia ni requisito explícito que exija ids únicos y pertenencia de la respuesta correcta a las opciones. Una clave puede tener revisiones coincidentes y señalar una opción inexistente. Deben exigirse esas validaciones en las RPC, también cuando una edición elimina la opción correcta, y probar ambos rechazos. Referencias: [entrada de preguntas](lib/domain/assessments/rpc-versions.ts:87), [question_keys](supabase/migrations/20261111130500_assessments_versions.sql:147).

- **C16 · Media — La lista cerrada de T1.4e omite una modificación obligatoria.**  
  La regla de reconstrucción obliga a cada ticket que incorpora una lectura no auditada a sumarla a `013_reconstruction.test.sql`. T1.4e incorpora `get_answer_key`, pero solo puede modificar su migración y `019_answer_keys.test.sql`. El implementador tendría que incumplir esa prueba o responder `BLOQUEADO`. Hay que agregar explícitamente `013_reconstruction.test.sql` a su lista. Referencias: [regla común](docs/contratos/fase-1.md:614), [archivos de T1.4e](docs/contratos/fase-1.md:745).

- **C17 · Media — Falta una precondición explícita contra publicar contenido pendiente.**  
  `create_version` crea ejercicios `pending` con cuerpo vacío. Aprobar solo exige igualdad de revisión; el protocolo de publicación exige aprobación y, en mirada, preguntas y clave, pero no exige que los ejercicios estén completos. La secuencia crear versión `typed` → asignar destinatario → aprobar → publicar satisface los requisitos enumerados con ejercicios todavía vacíos. Debe exigirse contenido completo y listo, con un error definido y una prueba que rechace esa secuencia. Referencias: [creación de ejercicios pendientes](docs/contratos/fase-1.md:674), [precondiciones de publicación](docs/contratos/fase-1.md:421).

**Dictamen sobre los cambios nuevos del spec**

| Cambio | Dictamen |
|---|---|
| RPC en `api`, expuesto como único esquema | **Acepto.** Configuración, clientes y tipos acompañan el cambio. Staging y producción deben fijar y verificar esa misma exposición. |
| `public` cerrado para `anon` y `authenticated` | **Acepto.** Quitar `USAGE` cierra el acceso aunque allí nazcan objetos con grants abiertos; resuelve la postergación cuestionada en C12. |
| Actores históricos como ids sin FK | **Acepto.** Evita reescribir historia al borrar cuentas y conserva trazabilidad. El id seudónimo no debe interpretarse como anonimización. |
| Instrucciones generales copiadas a cada versión | **Acepto.** Cierra C2 y hace coherentes revisión y publicación. Falta vincular también la clave a esas instrucciones: C1. |

Las restantes decisiones aceptadas en la ronda anterior mantienen su dictamen; la postergación de privilegios de `supabase_admin` fue reemplazada por la solución anterior.

**Los 21 tickets y las 14 tandas**

Comprobé las listas y las dependencias declaradas:

- Hay **21 tickets en 14 tandas**, sin archivos de escritura compartidos dentro de una misma tanda y con, como máximo, un ticket de migraciones por tanda.
- Todas las dependencias declaradas apuntan a tandas anteriores; no hay ciclos ni dependencias declaradas entre compañeros de tanda.
- Las listas no son disjuntas globalmente: `013_reconstruction.test.sql` pertenece a T1.3a, T1.3b, T1.4a, T1.4b y T1.5c. Ese solapamiento está serializado.
- **No están completamente cerradas para cumplir sus obligaciones:** falta incorporar ese archivo a T1.4e, según C16. Los demás cambios señalados deben resolverse en el contrato antes de repartir implementaciones con sus firmas y DTO congelados.

Bloqueantes: **C1 (alta); C5, C9, C10, C14, C15, C16 y C17 (media).**

Veredicto: contrato no listo

## Ronda 3

Revisé ambos diffs hasta `f479f50`. **Los ocho bloqueos anteriores tienen siete correcciones completas y una parcial; encontré cinco bloqueos adicionales de severidad media.** Los estados se refieren al contrato: las RPC siguen siendo stubs.

| Id | Estado | Resultado de intentar romperlo |
|---|---|---|
| C1 | **Resuelto** | La correspondencia ahora incluye `instructions_revision`, también para claves generadas, editadas y confirmadas. Cambiar centímetros por metros invalida la clave anterior aunque los ejercicios no cambien. |
| C5 | **Resuelto** | La identidad distingue RPC, versión y destino concreto. Dos preguntas del mismo ejercicio, o una pregunta y su ejercicio, ya no coinciden. Se guarda el resultado exacto para repetirlo bajo lock; el índice único respalda las carreras entre versiones. |
| C9 | **Resuelto** | La redacción de filas compartidas ya tiene un camino compatible con las guardias. La clasificación también considera destinatarios e intentos históricos. El mecanismo nuevo introduce otro problema: C18. |
| C10 | **Parcial — media** | Detecta ids incrustados y permite opciones visibles, pero sigue dejando pasar secretos incrustados en texto y produce falsos positivos con contenido legítimo. |
| C14 | **Resuelto** | `VersionDetail.keys` devuelve `QuestionKey` con su revisión, y el contrato exige incluirlo en `get_version`. Hay una lectura autorizada para recuperar el CAS después de recargar. |
| C15 | **Resuelto** | `OptionList` y el CHECK exigen ids únicos; los triggers respaldan la pertenencia de la correcta y rechazan quitarla al editar opciones. Las RPC deben devolver los errores definidos. |
| C16 | **Resuelto** | T1.4e ya puede modificar `013_reconstruction.test.sql`. Encontré otra omisión equivalente en T1.5d: C22. |
| C17 | **Resuelto** | Aprobar y publicar exigen versión y ejercicios listos, con texto. La secuencia original con ejercicios `pending` queda prohibida. Falta cerrar otra transición: C19. |

Los bloqueos restantes son los siguientes:

- **C10 — Media: el detector todavía acepta revelaciones explícitas.**  
  Ejecuté sondas en memoria sobre DTO válidos. Con secretos `A` y `x = 1`, `checkStudentDto` devolvió `[]` para títulos **«Respuesta correcta: A»** y **«Solucion: x = 1»**. Solo detectó el título cuyo contenido completo era `A`: [secretLeaks compara por igualdad exacta](lib/domain/delivery/leaks.ts:55).

  También reproduje falsos positivos: una respuesta esperada `1`, permitida solo en respuestas propias, marca la etiqueta del ejercicio `1` y el texto legítimo de la opción `1`; la correcta `A` marca una respuesta propia escrita como `A`. Hace falta distinguir la revelación de una solución de sus coincidencias legítimas, además de probar secretos incrustados. Ampliar indiscriminadamente a `includes` para letras tampoco resolvería esa distinción.

- **C18 — Media: el modo de supresión abre una excepción global al historial.**  
  La apertura directa queda cerrada por los privilegios de `app`: `anon`, `authenticated` y `service_role` no pueden llamar al helper. `begin_erasure` usa correctamente `set_config(..., true)`, por lo que **esa apertura no sobrevive al COMMIT**; terminar la supresión también la cierra.

  Sin embargo, [in_erasure solo comprueba que exista cualquier marca pendiente](supabase/migrations/20261111130800_platform.sql:189). No vincula la excepción con la institución, la fila ni los campos que se están redactando. Con una supresión de A abierta, [append_only acepta cualquier UPDATE](supabase/migrations/20261111130000_app_schema.sql:129), incluso sobre eventos de otra institución o sobre `audit_log`, cuya regla es conservarlo intacto.

  **Tampoco hay una barrera contra ejecutar una RPC normal dentro del modo**: `lock_begin` solo reinicia los marcadores de locks. Además, el lector confiaría en una GUC establecida a nivel de sesión mediante SQL; no verifica la transacción que abrió el modo. No encontré una vía REST actual para establecerla, así que esto no demuestra una explotación remota.

  Debe acotarse la excepción y definir cómo se rechazan entradas normales mientras está abierta. `004_contract_redaction` no prueba esos límites: corre como `postgres` y solo verifica algunas escrituras del caso feliz.

- **C19 — Media: una versión completada manualmente no tiene transición definida a `ready`.**  
  La versión nace `empty`. T1.4c exige que [editar manualmente pase el ejercicio a `ready`](docs/contratos/fase-1.md:721), pero no exige actualizar el estado de la versión. La transición explícita de la versión aparece al cerrar una generación.

  Por tanto, crear una versión `typed`, completar manualmente todos sus ejercicios e intentar aprobarla puede seguir dando `content_incomplete` indefinidamente, cumpliendo las reglas enumeradas. Hay que definir el cálculo del estado de la versión después de editar y probar ese recorrido sin generación. El ejemplo SQL de edición tampoco incorpora todavía el cambio de estado del ejercicio.

- **C20 — Media: el diff completo revierte la protección de capas.**  
  Se eliminan la resolución mediante TypeScript y numerosas pruebas de endurecimiento. Reproduje con `ESLint.lintText` que estos casos en `lib/domain/probe.ts` devuelven **cero diagnósticos**:

  ```ts
  import { log } from "@/LIB/server/log";
  export const y = log;
  ```

  ```ts
  export type P = import("@/lib/server/log").LogFields;
  ```

  TypeScript sí resuelve el primer destino en Windows. El [resolver nuevo conserva las mayúsculas](eslint/rules/imports.mjs:10) y los [visitores omiten los imports dentro de tipos](eslint/rules/imports.mjs:32). El contrato vuelve a depender de cómo se escriba el import para hacer cumplir sus capas.

- **C21 — Media: retrocede la comprobación de privacidad para lectores de pantalla.**  
  El diff elimina `a11y-tree.ts` y sus pruebas negativas. El [helper actual](tests/e2e/support/student.ts:16) solo inspecciona texto visible y algunos atributos literales. Por inspección, este caso pasa aunque el lector de pantalla anuncie el perfil:

  ```html
  <button aria-describedby="d">Seguir</button>
  <span id="d" hidden>Dislexia</span>
  ```

  También quedan fuera `aria-labelledby`, `aria-roledescription` y `aria-valuetext`. Son casos que la base comparada ya cubría; hay que conservar esa cobertura.

- **C22 — Media: T1.5d conserva una lista de archivos incompatible con la regla de reconstrucción.**  
  La [regla común](docs/contratos/fase-1.md:630) obliga a sumar cada lectura posterior no auditada a `013_reconstruction.test.sql`. T1.5d incorpora cuatro lecturas, pero su [lista cerrada](docs/contratos/fase-1.md:853) no permite tocar ese archivo.

  Hay que agregarlo o exceptuar expresamente las lecturas del estudiante, remitiendo su comprobación a `023_student_dto` y al test de fugas. Tal como está escrito, el implementador vuelve a tener obligaciones incompatibles.

La **renumeración y la planificación sí son coherentes**: 21 tickets en 14 tandas, dependencias siempre hacia tandas anteriores, sin archivos compartidos dentro de una tanda y con un máximo de una migración por tanda. Las 73 RPC coinciden con las 73 filas de la matriz y todos sus tickets existen. `004_contract_redaction` y `005_inventory` están referenciados consistentemente; no quedan referencias a `004_inventory`. La salvedad sobre las listas cerradas es C22.

Pasaron `typecheck`, `lint` y **449 pruebas unitarias**. `db:test` falló antes de ejecutar por permisos de escritura de telemetría; integración no pudo inicializar Supabase y Docker rechazó el acceso a su API. No ejecuté `db:reset`. Los resultados de SQL y concurrencia son estáticos. El worktree quedó limpio.

Veredicto: contrato no listo — bloqueantes: C10, C18, C19, C20, C21 y C22 (media).

## Ronda 4

Revisé ambos diffs hasta **`b3c0be2`**, sin editar archivos. **Queda un bloqueo de severidad media: C10.**

| Id | Estado | Resultado |
|---|---|---|
| **C10** | **Parcial — media** | Corrige los ejemplos anteriores y las coincidencias legítimas en opciones y respuestas propias, pero todavía acepta revelaciones explícitas y produce falsos positivos. |
| **C18** | **Resuelto en el perímetro API** | La marca exige supresión `marked`, institución coincidente y transacción actual. La redacción limita tabla y campo, excluye `audit_log` y conserva las guardias. Las **73 RPC** llaman a `rpc_begin()` como primera instrucción. |
| **C19** | **Resuelto** | `refresh_version_status` define el cálculo común; la edición manual actualiza el ejercicio y recalcula la versión. T1.4c exige probar completar y aprobar una versión sin generación. |
| **C22** | **Resuelto** | La reconstrucción queda limitada explícitamente a lecturas del staff; las del estudiante se comprueban mediante `023_student_dto` y la prueba de fugas. |

**C10 sigue siendo reproducible.** Ejecuté sondas en memoria con DTO estructuralmente válidos:

| Contenido | Secretos | Resultado de `checkStudentDto` |
|---|---|---|
| Título `Respuesta correcta: A` | `A` | Detectado |
| Título `Respuesta correcta: **A**` | `A` | **`[]`: fuga aceptada** |
| Título `La respuesta correcta es la A` | `A` | **`[]`: fuga aceptada** |
| Enunciado `La respuesta es 1/2` | `1` | **Falsa alarma** en `exercises.0.body` |

La [expresión del detector](lib/domain/delivery/leaks.ts:57) exige que el valor siga inmediatamente al separador y considera suficiente que termine antes de cualquier carácter no alfanumérico. Por eso pierde Markdown y artículos, y confunde `1` con el comienzo de `1/2`. Además, [excluir completamente etiquetas y textos de opciones](lib/domain/delivery/student-dto.ts:122) deja pasar allí frases como `Clave: A`; permitir el valor legítimo no exige permitir una declaración de cuál es la correcta. Faltan pruebas negativas y límites de coincidencia que cubran estos casos.

Sobre **C18**, la [implementación](supabase/migrations/20261111130800_platform.sql:195) cierra la excepción global anterior. Quedan dos precisiones **bajas, no bloqueantes**:

- La marca aporta vinculación transaccional, pero no autenticidad: SQL privilegiado puede fabricarla usando `txid_current()`. La protección frente a usuarios API son los privilegios cerrados; no encontré una vía API para falsificarla. La afirmación documental «puesta a mano, no abre nada» excede lo garantizado.
- [La prueba de presencia de `rpc_begin`](supabase/tests/001_contract.test.sql:148) busca una subcadena: no demuestra que sea la primera instrucción. Verifiqué esa posición directamente en las 73 RPC actuales.

La pasada completa contra `plataforma/fase-1` **no añadió hallazgos de severidad alta o media**. C20 y C21 no reaparecen.

Pasaron `typecheck`, `lint` y **506 pruebas unitarias**. Docker rechazó el acceso a su API: las conclusiones sobre SQL son estáticas; no ejecuté pgTAP ni concurrencia contra la base. El worktree quedó limpio.

Veredicto: contrato no listo — bloqueante: C10 (media).

## Ronda 5

**Acepto el criterio de revisión docente para texto libre; rechazo el cambio tal como está por un hallazgo de severidad media.**

- **Media — la nueva prueba SQL solo inspecciona un salto.** En [001_contract.test.sql:162](supabase/tests/001_contract.test.sql:162), una cadena `student_task → app.task_payload → app.solution_text → answer_key_revisions` pasa: el helper directo no nombra tablas prohibidas y el segundo nunca se inspecciona. Podría insertar una solución en `body` durante la lectura, sin aprobación docente de ese texto. Comprobé en memoria que un DTO válido con `body: "Respuesta correcta: **A**"` devuelve `[]`; eso es deliberado ahora, pero vuelve indispensable cerrar la comprobación del origen. Hace falta recorrer los helpers transitivamente y añadir una prueba negativa con dos saltos.

La aprobación ligada a la revisión y la publicación inmutable sostienen el diseño para contenido revisado. No encontré otro bypass definido ni otro hallazgo nuevo alto/media. Las RPC todavía son stubs: lo anterior es un hueco del contrato y de su prueba, no una fuga activa demostrada.

Pasaron `typecheck`, `lint` y **513 pruebas**. SQL revisado estáticamente; no ejecuté pgTAP. Worktree limpio.

Veredicto: contrato no listo

## Ronda 6

No está resuelto. **Persiste la media de C10:** el cierre recursivo sigue teniendo rutas invisibles.

- **Nombres y esquemas** — [línea 171](supabase/tests/001_contract.test.sql:171): `app."helper"()` y `app . helper()` no coinciden con el patrón. Un helper de otro esquema tampoco se recorre; que la RPC sea `SECURITY DEFINER` permite alcanzarlo con los privilegios del dueño. Las sobrecargas sí quedan cubiertas. Los nombres sin calificar normalmente quedan impedidos por `search_path = ''`.
- **Vistas y triggers** — [línea 167](supabase/tests/001_contract.test.sql:167): solo hay aristas entre funciones nombradas explícitamente. `student_* → vista → answer_key_revisions` o `student_* → UPDATE → trigger → clave` quedan fuera.
- **Helpers `LANGUAGE SQL … BEGIN ATOMIC`** — [línea 180](supabase/tests/001_contract.test.sql:180): se inspecciona únicamente `prosrc`; estos cuerpos están en `prosqlbody`. Un helper alcanzado puede leer directamente la clave sin ser detectado. Lo confirma la [documentación de PostgreSQL 17](https://www.postgresql.org/docs/17/catalog-pg-proc.html).

Los dos probes cubren sus casos, pero no estos bypasses. Hace falta seguir esas dependencias o rechazarlas explícitamente, con pruebas negativas.

Sin otra alta/media independiente. Revisión estática; pgTAP no ejecutado porque Docker denegó acceso. Sin cambios en archivos.

Veredicto: contrato no listo

## Ronda 7

**Persisten dos medias en la garantía:**

- **Triggers fuera del control.** [005_student_role:40](supabase/tests/005_student_role.test.sql:40) solo inspecciona definers con `EXECUTE`. PostgreSQL no comprueba ese permiso al disparar un trigger. Una futura `submissions_guard SECURITY DEFINER`, propiedad de `postgres`, podría copiar la clave a `NEW.answers` sin conceder ningún permiso adicional y sin que este control la detecte. Los triggers actuales son invoker; falta una comprobación sobre `pg_trigger` y un probe negativo. [Código de PostgreSQL 17](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/commands/trigger.c#L2177).

- **Perfiles derivados ajenos accesibles.** El [GRANT y la política de students](supabase/migrations/20261111131300_student_role.sql:44) permiten leer `interface` de todos los estudiantes. Según el contrato, `gaze` identifica `motor` y `voice` identifica `dysgraphia` sin `motor`. Una RPC puede deducir perfiles ajenos sin tocar `student_needs`. Hace falta limitar esas filas al actor.

La membresía administrativa de `postgres` no presta privilegios en dirección inversa y es compatible con PostgreSQL 17 hospedado. [Documentación](https://www.postgresql.org/docs/17/role-attributes.html). La ventana actual cierra, pero **no tiene autocierre**: confirmar `begin_student_rpc_change()` sin `end` deja permisos globales; debe exigirse cierre y atomicidad.

`session_user_id()` reproduce la [implementación de `auth.uid()`](https://github.com/supabase/auth/blob/master/migrations/20220224000811_update_auth_functions.up.sql); no encontré regresión de autorización por ese cambio.

513 pruebas unitarias pasan. pgTAP y staging no ejecutados. Worktree limpio.

Veredicto: contrato no listo

## Ronda 8

**Resueltos 1 y 3; el 2 sigue abierto (media).**

- **Triggers:** no encontré una cadena actual que escape del rol. El nuevo chequeo detecta definers en las tablas escribibles.
- **Perfiles ajenos:** la [política de intentos](supabase/migrations/20261111131300_student_role.sql:65) permite cambiar `publication_id`, `version_id` y `answer_key_revision_id` de un intento propio `opened`. Una RPC puede apuntarlo a una publicación ajena del mismo práctico, poniendo la clave en `NULL`. La [guardia](supabase/migrations/20261111130700_delivery.sql:131) también obtiene `NULL` porque RLS oculta esa publicación, y acepta. Las [FK omiten RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html); tras actualizar, la publicación queda visible y expone `answer_mode/aids`. Falta restringir `UPDATE` por columnas y agregar esta prueba negativa.
- **Ventana:** el commit abierto aborta. [`DEFERRED` no sobrevive al commit](https://www.postgresql.org/docs/17/sql-set-constraints.html), y `tiza_student` carece de autoridad para deshabilitar el trigger. `postgres`, como dueño, sí puede hacerlo deliberadamente.

Sin otras altas/medias identificadas. Typecheck, lint y 513 pruebas pasan. pgTAP no ejecutado: Docker denegó acceso. Worktree limpio.

Veredicto: contrato no listo

## Ronda 9

Sí, resuelto. No encontré nuevas altas/medias en `0ae5719..HEAD`.

- Los grants impiden cambiar las columnas de pertenencia; INSERT en `submissions` queda limitado por RLS a intentos propios.
- `attempts_key_matches` rechaza publicaciones invisibles.
- La redacción cubre `version_events.result`; el orden exige borrar Auth antes de cerrar la supresión.

Typecheck, lint y 513 pruebas pasan. pgTAP no ejecutado. Worktree limpio.

Veredicto: contrato listo
