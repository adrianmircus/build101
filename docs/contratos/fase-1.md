# Contrato de la fase 1

Este documento fija la base de datos de la fase 1: dónde viven las tablas, cómo se escriben las RPC, cómo se toman los locks y cómo se reparten los tickets. Lo escribió el orquestador antes de repartir. Los tickets lo leen y no lo cambian: si algo no cierra, responden `BLOQUEADO`.

Fecha: 11/11/2026. Rama: `plataforma/f1-contratos`.

Archivos del contrato:

- Migraciones `supabase/migrations/20261111130000` a `20261111131200`. Nacen cerradas y ningún ticket las edita.
- Pruebas `supabase/tests/000_privileges.test.sql`, `001_contract.test.sql` y `002_contract_rules.test.sql`.
- Tipos y esquemas en `lib/domain/`, con el registro de RPC en `lib/domain/rpc.ts`.
- El chequeo de compilación entre el registro y la base, en `lib/server/db/rpc-contract.ts`.

## Decisiones

### Las tablas viven en `app`, las RPC en `public`

Todas las tablas están en el esquema `app`. PostgREST no lo expone: `config.toml` publica solo `public` y `graphql_public`. En `public` solo hay RPC.

Por qué:

- El spec ya pide que toda escritura y toda lectura sensible pase por una RPC. Con las tablas fuera de la API, un `GRANT` puesto por error no se convierte en un endpoint. Es una segunda pared.
- Nadie usa `app` salvo su dueño. Ni `service_role`: el código privilegiado también entra por RPC internas. Así la clave secreta no lee tablas de salud de forma directa.
- Los tipos generados (`npm run db:types`) muestran solo las RPC, con sus parámetros. Un repo no puede hablar con una tabla porque no la ve.

Consecuencia: en la fase 1 también las lecturas no sensibles van por RPC (ver «Decisiones que cambian el spec»).

### RLS activado y forzado, sin políticas

Cada tabla tiene `ENABLE` y `FORCE ROW LEVEL SECURITY`, y ninguna política.

- Sin políticas, RLS niega todo a cualquier rol que no la saltee. Es la tercera pared, detrás del esquema no expuesto y de la falta de privilegios.
- `FORCE` hace que la regla valga también para el dueño de la tabla si algún día deja de tener `BYPASSRLS`. Hoy `postgres` lo tiene, así que las RPC, que corren como `postgres`, no se ven afectadas. Si cambia el dueño, todo falla cerrado, nunca abierto.
- Las RPC autorizan por su cuenta, con las funciones de `app` (ver «Quién llama»).
- Si un ticket futuro agrega una vista en `public` para un listado flexible, la vista va con `security_invoker`, privilegios por columna y políticas escritas sobre conjuntos. Los índices `(user_id, institution_id)` y `(user_id, group_id)` ya están.

### CHECK en vez de enums de Postgres

Los estados y tipos son `text` con un `CHECK`.

- Un valor de un enum de Postgres no se puede borrar, y agregar uno tiene restricciones dentro de una transacción. Un `CHECK` se cambia en una migración nueva, con los cuatro pasos de expandir y contraer.
- Las tablas no aparecen en los tipos generados, así que los enums de Postgres no darían tipos de TypeScript.
- La fuente de los valores en TypeScript es zod en `lib/domain` (por ejemplo `ATTEMPT_STATUSES`). Las listas coinciden con los `CHECK`; un cambio toca los dos en el mismo ticket.

Los perfiles y apoyos no tienen un `CHECK` con la lista: la base solo controla la forma (`app.is_key_set`). La lista validada vive en `lib/domain/students/needs.ts`, y una prueba la compara con los `data/profiles/*.md` aprobados. La RPC rechaza un perfil fuera de esa lista con `INVALID` y `unknown_profile`.

### Parámetros tipados, salida jsonb

- Las RPC reciben parámetros con tipo y prefijo `p_`. Postgres valida el tipo antes de entrar, PostgREST elige la función por nombre de parámetro y los tipos generados quedan exactos.
- Los parámetros que pueden faltar van al final con `default null`. Así los tipos generados los marcan opcionales.
- Un parámetro `jsonb` se usa solo para un documento anidado: la configuración de una versión, la clave, el borrador, las opciones de una pregunta, las entradas y salidas de la IA. El repo lo valida con zod antes de llamar, y la RPC revisa la forma de arriba.
- Toda RPC devuelve `jsonb`, armado clave por clave con `jsonb_build_object` y en camelCase. Nunca `to_jsonb(fila)`: armar a mano es la lista de lo que sale, y una columna nueva no se filtra sola.
- El repo valida la respuesta con el esquema `result` del registro.

### Registro de RPC

`lib/domain/rpc.ts` junta todas las RPC: por nombre, el esquema de `args` con las claves de los parámetros de SQL y el de `result`. `lib/server/db/rpc-contract.ts` falla en `npm run typecheck` si el registro y la base no nombran las mismas funciones, o si los argumentos no coinciden en nombre y tipo.

Los repos (T1.6 y T1.7) usan un único `callRpc(db, name, args)` en `lib/server/repos/rpc.ts`, que crea T1.6a:

- valida `args` con el registro;
- llama a `db.rpc(name, args)` y, si la versión de `supabase-js` lo permite, manda el id del pedido en la cabecera `x-request-id` (lo guarda `audit_log`);
- traduce el error con `parseRpcError` de `lib/domain/errors/rpcError.ts`;
- valida el resultado.

Los repos reciben el cliente como primer parámetro, así los tests de integración pasan su propio cliente logueado. `db` es `SessionClient` en `repos/` y `AdminClient` en `repos/admin/`.

### Errores

Las RPC levantan los errores esperados con `app.raise_error(code, reason)`:

```sql
raise exception using errcode = 'P0001', message = '<CODE>', detail = '<reason>';
```

- `CODE` es uno de `NOT_FOUND`, `FORBIDDEN`, `INVALID`, `CONFLICT`, `RATE_LIMITED` y `UNAVAILABLE`.
- `reason` es una clave en snake_case (`revision_mismatch`, `not_enrolled`). No es un texto en español.
- El texto para el usuario vive en `lib/domain/errors/reasons.ts`. Una razón que no está ahí muestra el texto por defecto del código.
- `app.raise_error` rechaza un código desconocido o una razón con otra forma. Así ningún dato puede llegar a un mensaje, ni siquiera por error.
- `parseRpcError` solo reconoce `P0001` con un código válido como mensaje. Un `RAISE EXCEPTION 'texto'` cualquiera también tiene `P0001`, pero su mensaje no es un código: el repo lo trata como inesperado y lo loguea solo por código.
- Los errores de programación (orden de locks, filas inmutables, revisiones que saltan) usan `P0004`. Un `WHEN OTHERS` de plpgsql no lo atrapa, así que una RPC no puede tragarse un bug por accidente. El repo lo ve como inesperado.

Por qué razones y no texto en `DETAIL`: el texto queda en un solo lugar revisable en español rioplatense, las pruebas comparan razones estables y SQL nunca arma un mensaje.

Qué responde una RPC cuando el recurso no está a su alcance:

- `NOT_FOUND` si el recurso no existe o el actor no puede verlo (otra institución, otro grupo). No se distingue, para no revelar que existe.
- `FORBIDDEN` si el actor lo ve pero su rol no alcanza (inclusión que intenta escribir una nota), o si no hay sesión (`no_session`).

### Identidad de las filas

- Toda tabla tiene `id uuid` y `created_at`. Las editables tienen además `updated_at` y `revision`. La excepción es `subjects`, cuyo id es el nombre de la carpeta de la materia (`math`).
- Toda tabla de una institución tiene `institution_id` no nulo y `UNIQUE (institution_id, id)`. Las hijas apuntan con FK compuesta `(institution_id, x_id)`. La prueba `001_contract` falla si alguna FK entre dos tablas institucionales no empareja `institution_id` con `institution_id`.
- Algunos padres exponen además `UNIQUE (institution_id, padre_id, id)`. Con una sola FK la hija prueba dos cosas: que no sale de la institución y que su padre es el correcto. Por ejemplo, un ejercicio adaptado apunta a un ejercicio original del mismo práctico que su versión, y una versión solo puede tener vigente una generación propia.
- Las FK hacia filas con efecto afuera (archivos) o con historia (eventos, salidas, revisiones de la clave) no tienen `ON DELETE`. Borrar el padre falla mientras queden hijas, salvo que se borre todo el árbol junto.

### Triggers

- `app.touch_row()` en toda tabla con `updated_at`. Pone `updated_at`, congela `id`, `institution_id` y `created_at`, y exige que `revision` quede igual o suba de a uno. No sube la revisión solo: aprobar o cambiar un estado no es editar, y una revisión aprobada tiene que seguir coincidiendo.
- `app.append_only()` en eventos, salidas, revisiones de la clave, `audit_log` y `feedback_events`. Prohíbe `UPDATE`. `DELETE` queda posible para la supresión y la retención.
- Guardias propias: una generación u operación terminada no se reabre; una publicación solo se retira, una vez; un intento solo avanza (`opened`, `started`, `submitted`) y no cambia de publicación después de empezar; una entrega no cambia después de `submitted_at`.

### Quién llama

Funciones de `app`, sin `EXECUTE` para nadie. Las RPC las llaman como su dueño.

| Función | Devuelve |
|---|---|
| `app.actor_id()` | El usuario de `auth.uid()` si tiene fila en `app_users`; si no, nulo |
| `app.require_actor()` | Lo mismo, o `FORBIDDEN` con `no_session` |
| `app.actor_institutions(roles)` | Las instituciones donde el actor tiene alguno de esos roles activos (conjunto) |
| `app.is_member(institución, roles)` | Si el actor es miembro activo con alguno de esos roles |
| `app.actor_staff_groups()` | Los grupos donde el actor es staff, con membresía de profe o admin activa (conjunto) |
| `app.is_group_staff(grupo)` | Si el actor es staff de ese grupo |
| `app.actor_student_id()` | La fila de estudiante del actor, si es estudiante activo y no archivado |
| `app.is_student_self(estudiante)` | Si ese estudiante es el actor |
| `app.institution_kind(institución)` | `school` o `sandbox` |
| `app.audit_disclosure(institución, acción, entidad, id, estudiantes)` | Escribe una fila de `audit_log` por pedido, con el conjunto de estudiantes ordenado y sin repetidos |

Un sandbox vencido cuenta como sin membresía: después de `expires_at` su visitante no ve nada. Sacar a un profe de la institución le saca todos sus grupos de una, sin tocar `group_staff`.

### Nombres

- `verbo_sustantivo` en inglés: `create_group`, `list_group_students`, `get_version`.
- `internal_*`: solo `service_role`. Una prueba falla si `authenticated` puede ejecutar alguna.
- `student_*`: los DTO del estudiante.
- El ticket que implementa una RPC la reemplaza con `CREATE OR REPLACE FUNCTION` en una migración nueva, con la misma firma, y concede `EXECUTE` a `authenticated` (públicas) o a `service_role` (internas). Supabase ya concede `EXECUTE` a `service_role` sobre todo `public`; el ticket lo deja escrito igual. Cambiar una firma es cambiar el contrato.

## Decisiones que cambian el spec

- **Lecturas no sensibles por RPC.** El spec dice «RLS en lecturas no sensibles» con `SELECT` para `authenticated`. Con las tablas en `app`, en la fase 1 todas las lecturas son RPC con proyección. Una sola forma de autorizar, una sola cosa que prueba la matriz, y la salida es siempre una lista cerrada de claves. RLS queda activado y sin políticas. Si se mide que un listado necesita la flexibilidad de PostgREST, se agrega una vista como dice «RLS activado y forzado».
- **`op_key` único por institución.** El spec dice «por institución y recurso». Es más estricto: un `op_key` reusado en otro recurso responde `CONFLICT` (`op_key_reused`) en vez de crear una segunda generación.
- **`source_id` de `assessments` se llama `source_file_id`.** Es el documento del que se leyó. Duplicar un práctico (T7.8) suma su propia columna cuando llegue.
- **La publicación mínima pasa a la fase 1 (T1.5a).** El spec la pone en T4.7. Las pruebas de intentos, de los DTO y de fugas necesitan publicaciones hechas por el camino real, y una publicación sembrada a mano no prueba nada. T4.7 queda para el servicio y la acción de publicar.
- **T1.1 no dejó `tests/factories/`.** Las crea T1.6a, sobre las RPC internas de T1.2a.
- **Se parten también T1.2, T1.3 y T1.5**, no solo T1.4. Cada uno pasaba las 400 líneas con sus pruebas.
- **T1.8 va al final de la fase.** La matriz necesita datos de todas las áreas para probar cada fila. Mientras tanto, cada ticket de base prueba sus permisos en pgTAP.
- **`audit_log` y `erasures` no tienen FK a `institutions`.** El registro de accesos se guarda cinco años y el de supresiones tiene que sobrevivir a la baja de la institución. Los borra la retención, no la cascada.
- **Las versiones se nombran por posición** («Versión 1»), no por perfil. Un listado sin datos sensibles puede nombrarlas.
- **El intento nace `opened`** al publicar, y `first_viewed_at` marca la primera vez que el estudiante lo abre. Los tres estados del spec quedan iguales.
- **Guardar el perfil no exige todavía el consentimiento `store_profile`.** El chequeo y sus efectos llegan con T9.3. Hasta la compuerta legal (T10.6) no entra ningún dato real.
- **`supabase_admin` sigue concediendo por defecto a `anon` y `authenticated` en `public`.** La primera migración no puede cambiarlo porque `postgres` no es miembro de ese rol. No es un cambio de este contrato, pero es un riesgo: un objeto creado desde el panel de Supabase nacería abierto. `000_privileges` lo detecta para objetos que existen; T10.5 lo revisa en staging y producción.

## Tablas

Todas en `app`. Las RLS y RPC de cada una las escribe el ticket de la columna «Dueño». «Sensible» marca los campos que solo salen por una lectura auditada.

| Tabla | Migración | Dueño | Sensible |
|---|---|---|---|
| `app_users` | `130100_identity` | T1.2a | |
| `institutions` | `130100_identity` | T1.2a | |
| `subjects` | `130100_identity` | (datos fijos) | |
| `memberships` | `130100_identity` | T1.2a | |
| `invitations` | `130100_identity` | T2.3 | |
| `groups` | `130200_groups_students` | T1.2a | |
| `group_staff` | `130200_groups_students` | T1.2a | |
| `students` | `130200_groups_students` | T1.2b | |
| `enrollments` | `130200_groups_students` | T1.2b | |
| `student_pseudonyms` | `130200_groups_students` | T1.2b | |
| `account_provisioning` | `130200_groups_students` | T1.2b crea la fila; T2.5 la ejecuta | |
| `student_needs` | `130200_groups_students` | T1.3a | Todo |
| `student_need_events` | `130200_groups_students` | T1.3a | Todo |
| `student_notes` | `130200_groups_students` | T1.3b | `body` |
| `files` | `130300_files_syllabi_consents` | T4.5 | Los de `consents` |
| `syllabi` | `130300_files_syllabi_consents` | T4.5 | |
| `consents` | `130300_files_syllabi_consents` | T1.3b | Todo |
| `assessments` | `130500_assessments_versions` | T1.4a | |
| `assessment_exercises` | `130500_assessments_versions` | T1.4a | |
| `versions` | `130500_assessments_versions` | T1.4b | `config`, `answer_mode` |
| `version_exercises` | `130500_assessments_versions` | T1.4c | `body`, `changes` |
| `version_questions` | `130500_assessments_versions` | T1.4c | |
| `question_keys` | `130500_assessments_versions` | T1.4c | Nunca al estudiante |
| `version_recipients` | `130500_assessments_versions` | T1.4b | Todo |
| `generations` | `130600_generations` | T1.4d | `inputs` |
| `operations` | `130600_generations` | T3.4 y T3.5 | |
| `generation_outputs` | `130600_generations` | T1.4d | `output` |
| `version_events` | `130600_generations` | T1.4c y T1.4d | `data` de `recipients_changed` |
| `answer_keys` | `130600_generations` | T1.4e | Nunca al estudiante |
| `answer_key_revisions` | `130600_generations` | T1.4e | Nunca al estudiante |
| `publications` | `130700_delivery` | T1.5a | `answer_mode`, `aids` para el profe |
| `assignments` | `130700_delivery` | T1.5a | |
| `assignment_attempts` | `130700_delivery` | T1.5b | |
| `submissions` | `130700_delivery` | T1.5b | |
| `grades` | `130700_delivery` | T1.5c | |
| `group_analyses` | `130700_delivery` | T3.5 | `pseudonym_map` |
| `feedback_events` | `130700_delivery` | T8.5 | |
| `audit_log` | `130800_platform` | T1.3a (escribe), T9.4 (lee) | Todo |
| `erasures` | `130800_platform` | T9.5 | |
| `rate_limits` | `130800_platform` | T2.7 | |
| `presets` | `130800_platform` | T7.8 | |
| `notifications` | `130800_platform` | T8.4 | |
| `import_runs` | `130800_platform` | T4.13 | |
| `sandbox_sessions` | `130800_platform` | T4.9 | |

Reglas de unicidad que pide el spec, ya en el esquema:

- una inscripción activa por grupo y estudiante (`enrollments_active_key`);
- un owner por grupo y una fila de staff activa por persona;
- un usuario único por institución;
- un consentimiento vigente por estudiante y finalidad;
- una versión por práctico y estudiante a la vez (`version_recipients_one_per_assessment_key`);
- `op_key` único por institución en `generations`, `operations`, `account_provisioning` e `import_runs`;
- una generación `running` por recurso y tipo;
- un solo evento `generated` por generación;
- `op_id` único por institución en `version_events` y `student_need_events`;
- una salida por generación, tipo y ejercicio;
- un intento vigente por asignación y una asignación por práctico y estudiante.

## RPC

Todas `SECURITY DEFINER`, con `search_path = ''`, devuelven `jsonb` y hoy responden `UNAVAILABLE` con `not_implemented`. Los esquemas de entrada y salida están en `lib/domain/**/rpc*.ts`.

| RPC | Ticket |
|---|---|
| `internal_create_institution(p_name, p_code, p_kind, p_expires_at = null, p_owner_user_id = null)` | T1.2a |
| `internal_upsert_app_user(p_user_id, p_display_name = null)` | T1.2a |
| `internal_add_membership(p_institution_id, p_user_id, p_role)` | T1.2a |
| `internal_revoke_membership(p_membership_id)` | T1.2a |
| `list_my_institutions()` | T1.2a |
| `create_group(p_institution_id, p_name, p_subject_id, p_school_year)` | T1.2a |
| `update_group(p_group_id, p_revision, p_name, p_school_year)` | T1.2a |
| `archive_group(p_group_id, p_revision)` y `restore_group(p_group_id, p_revision)` | T1.2a |
| `add_group_staff(p_group_id, p_user_id, p_role)` y `remove_group_staff(p_group_id, p_user_id)` | T1.2a |
| `internal_link_student_user(p_student_id, p_user_id)` | T1.2b |
| `create_student(p_group_id, p_display_name, p_username, p_op_key)` | T1.2b |
| `update_student(p_student_id, p_revision, p_display_name, p_username)` | T1.2b |
| `archive_student(p_student_id, p_revision)` y `restore_student(p_student_id, p_revision)` | T1.2b |
| `enroll_student(p_group_id, p_student_id)` y `unenroll_student(p_group_id, p_student_id)` | T1.2b |
| `list_my_groups(p_institution_id, p_include_archived = false, p_limit = 50, p_offset = 0)` | T1.2b |
| `get_group(p_group_id)` | T1.2b |
| `list_group_students(p_group_id, p_include_archived = false, p_limit = 50, p_offset = 0)` | T1.2b |
| `set_student_needs(p_student_id, p_profiles, p_supports, p_interests, p_op_id, p_revision = null, p_review_due_on = null)` | T1.3a |
| `get_student_needs(p_student_ids)` (auditada) | T1.3a |
| `get_group_needs(p_group_id)` (auditada) | T1.3a |
| `list_student_need_events(p_student_id, p_limit = 50, p_offset = 0)` (auditada) | T1.3a |
| `list_student_notes(p_student_id)` (auditada) | T1.3b |
| `create_student_note(p_student_id, p_body)` | T1.3b |
| `update_student_note(p_note_id, p_revision, p_body)` y `archive_student_note(p_note_id, p_revision)` | T1.3b |
| `list_student_consents(p_student_id)` (auditada) | T1.3b |
| `record_consent(p_student_id, p_purpose, p_text_version, p_valid_until = null, p_file_id = null)` | T1.3b |
| `revoke_consent(p_consent_id, p_revision)` | T1.3b |
| `create_assessment(p_group_id, p_kind, p_topic, p_general_instructions)` | T1.4a |
| `update_assessment(p_assessment_id, p_revision, p_kind, p_topic, p_general_instructions)` | T1.4a |
| `archive_assessment(p_assessment_id, p_revision)` | T1.4a |
| `list_assessments(p_group_id, p_include_archived = false, p_limit = 50, p_offset = 0)` | T1.4a |
| `get_assessment(p_assessment_id)` | T1.4a |
| `add_exercise(p_assessment_id, p_label, p_body, p_topic_id = null)` | T1.4a |
| `update_exercise(p_exercise_id, p_revision, p_label, p_body, p_topic_id = null)` | T1.4a |
| `remove_exercise(p_exercise_id, p_revision)` | T1.4a |
| `reorder_exercises(p_assessment_id, p_revision, p_exercise_ids)` | T1.4a |
| `create_version(p_assessment_id, p_config, p_answer_mode, p_base_version_id = null)` | T1.4b |
| `update_version_config(p_version_id, p_revision, p_config, p_answer_mode)` | T1.4b |
| `set_version_recipients(p_version_id, p_revision, p_student_ids, p_op_id)` | T1.4b |
| `archive_version(p_version_id, p_revision)` | T1.4b |
| `list_versions(p_assessment_id)` | T1.4b |
| `get_version(p_version_id)` (auditada) | T1.4b |
| `update_version_exercise(p_version_exercise_id, p_revision, p_body, p_op_id)` | T1.4c |
| `update_version_question(p_question_id, p_revision, p_stem, p_options, p_op_id)` | T1.4c |
| `set_question_key(p_question_id, p_correct_option_id, p_revision = null)` | T1.4c |
| `approve_version(p_version_id, p_revision, p_op_id)` | T1.4c |
| `reject_version(p_version_id, p_revision, p_reasons, p_op_id)` | T1.4c |
| `internal_create_generation(p_version_id, p_kind, p_op_key, p_inputs, p_profiles_hash, p_profiles_revision, p_prompt_version, p_required_jobs, p_target_exercise_id = null, p_requested_by = null)` | T1.4d |
| `internal_record_generation_output(p_generation_id, p_kind, p_output, p_version_exercise_id = null)` | T1.4d |
| `internal_finish_generation(p_generation_id, p_status, p_error_code = null)` | T1.4d |
| `get_answer_key(p_version_id)` | T1.4e |
| `edit_answer_key(p_version_id, p_content, p_base_revision_id = null)` | T1.4e |
| `confirm_answer_key(p_version_id, p_base_revision_id)` | T1.4e |
| `approve_answer_key(p_version_id, p_revision_id)` | T1.4e |
| `internal_record_answer_key_revision(p_generation_id, p_content)` | T1.4e |
| `publish_version(p_version_id, p_revision, p_op_key, p_answer_key_revision_id = null)` | T1.5a |
| `open_attempt(p_assignment_id)` | T1.5b |
| `start_attempt(p_attempt_id)` | T1.5b |
| `save_draft(p_attempt_id, p_revision, p_answers, p_choices)` | T1.5b |
| `submit_attempt(p_attempt_id, p_revision)` | T1.5b |
| `list_assessment_attempts(p_assessment_id)` | T1.5c |
| `get_attempt_for_grading(p_attempt_id)` (auditada) | T1.5c |
| `grade_attempt(p_attempt_id, p_feedback, p_exercise_results, p_score = null, p_revision = null)` | T1.5c |
| `student_home()`, `student_task_list()`, `student_task(p_attempt_id)` y `student_grades()` | T1.5d |

Quedan para su fase, con su propio contrato: archivos y programa (T4.5), presets (T7.8), avisos (T8.4), límites (T2.7), importación (T4.13), sandbox (T4.9), operaciones (T3.4 y T3.5), `request_generation` (T5.1), invitaciones (T2.3) y retiro y reasignación (T8.1).

## Orden de locks y revisión

Orden único, de arriba hacia abajo. Se saltean los niveles que no hacen falta, pero nunca se vuelve para arriba:

```
assessments -> assessment_exercises (por id) -> versions (por id) -> generations
  -> version_exercises (por id) -> version_questions y question_keys -> answer_keys
  -> assignments (por id) -> assignment_attempts -> submissions -> grades
```

Lo hacen cumplir las funciones de `20261111130900_lock_order.sql`:

- `app.lock_begin()` se llama una vez al empezar la RPC.
- `app.lock_version_tree(versión, generación, ejercicios)` toma la versión, después la generación y después los ejercicios ordenados por id. Si ya bloqueó ejercicios, no deja bloquear una generación. Solo un árbol de versión por RPC.
- `app.lock_versions(ids)` bloquea varias versiones por id («Aprobar todas», publicar), y después no deja bloquear el árbol de ninguna.
- `app.lock_assignments(ids)` va después de cualquier versión. Empezar y entregar bloquean solo su asignación o su intento, así que nunca esperan a una versión.
- Una violación levanta `P0004`: es un bug.

Edición con revisión (CAS), por ejemplo de un ejercicio adaptado:

```sql
-- Autorizar primero con una lectura sin lock: no se bloquea lo que el actor no puede ver.
select ve.version_id, a.group_id into v_version_id, v_group_id
  from app.version_exercises ve
  join app.assessments a on a.id = ve.assessment_id
 where ve.id = p_version_exercise_id;
if not found or not app.is_group_staff(v_group_id) then
  perform app.raise_error('NOT_FOUND', 'not_found');
end if;

-- Idempotencia: el mismo op_id ya se aplicó, se devuelve el estado de hoy.
if exists (select 1 from app.version_events e where e.institution_id = v_institution_id and e.op_id = p_op_id) then
  return <estado actual>;
end if;

perform app.lock_begin();
perform app.lock_version_tree(v_version_id, null, array[p_version_exercise_id]);

select ve.revision into v_revision from app.version_exercises ve where ve.id = p_version_exercise_id;
perform app.assert_revision(p_revision, v_revision);  -- CONFLICT revision_mismatch

update app.version_exercises set body = p_body, revision = revision + 1
 where id = p_version_exercise_id returning revision into v_revision;
-- Todo cambio de contenido sube la revisión de la versión: la aprobación anterior deja de valer.
update app.versions set revision = revision + 1 where id = v_version_id returning revision into v_version_revision;
update app.answer_keys set stale = true where version_id = v_version_id;
insert into app.version_events (institution_id, version_id, op_id, kind, version_exercise_id,
                                version_revision, exercise_revision, data, actor_user_id)
values (v_institution_id, v_version_id, p_op_id, 'edited', p_version_exercise_id,
        v_version_revision, v_revision, jsonb_build_object('body', p_body), app.actor_id());
return jsonb_build_object('id', p_version_exercise_id, 'revision', v_revision, 'versionRevision', v_version_revision);
```

Una salida de la IA que llega (T1.4d):

```sql
select g.version_id into v_version_id from app.generations g where g.id = p_generation_id;  -- sin lock
perform app.lock_begin();
perform app.lock_version_tree(v_version_id, p_generation_id, array_remove(array[p_version_exercise_id], null));
-- Releer con lock. Vigente quiere decir: la generación sigue running, es la current_generation_id
-- de su recurso (la versión o el ejercicio) y el ejercicio tiene la revisión que la generación
-- esperaba (target_revision, o inputs.exerciseRevisions[id] para una generación de versión).
v_outcome := case when <vigente> then 'applied' else 'obsolete' end;
insert into app.generation_outputs (..., outcome) values (..., v_outcome)
  on conflict (generation_id, kind, version_exercise_id) do nothing;
if v_outcome = 'applied' then
  update app.version_exercises set body = ..., changes = ..., status = 'ready', revision = revision + 1 ...;
end if;
```

Crear una generación nueva bloquea la versión, pasa a `superseded` las generaciones `running` que reemplaza (las filas de `generations`, antes que cualquier ejercicio) y recién después bloquea los ejercicios. Cerrar una generación (`internal_finish_generation`) toma versión y generación, no hace nada si ya no está `running` y, si termina `done` y sigue vigente, pasa la versión a `ready` y escribe el único evento `generated` con `op_id` igual al id de la generación.

## Intentos y entrega

Estados: `opened`, `started` y `submitted`. Solo avanzan. Un intento reemplazado guarda `superseded_at` y sigue existiendo, con sus respuestas. Lo que se puede hacer en cada momento está en `lib/domain/delivery/attempt-rules.ts`, con una prueba por fila de la tabla del spec, y las RPC aplican la misma tabla.

Publicar (`publish_version`, T1.5a), en una transacción:

- toma el árbol de la versión;
- exige `approved_revision = revision = p_revision`;
- en mirada, exige preguntas y una revisión de la clave que corresponda (ver «Clave»); en escritura y dictado la clave es opcional;
- exige que cada destinatario esté inscripto y tenga el consentimiento `ai_adaptation` vigente, si la versión tiene una generación;
- copia la revisión a `publications`, sin la opción correcta, sin `changes` y con `answer_mode` y `aids` calculados;
- crea las asignaciones que falten y las bloquea por id;
- por asignación: sin intento crea el 1 en `opened`; con uno `opened` lo pasa a la publicación nueva; con uno empezado o entregado no lo toca.

Abrir (`open_attempt`): el estudiante ve su intento vigente si la tabla lo deja leer, y la primera vez se guarda `first_viewed_at`.

Empezar (`start_attempt`): bloquea la asignación (el mismo lock que publicar), pasa `opened` a `started` y crea la fila de `submissions` con revisión 1. Si ya empezó, devuelve lo mismo.

Guardar (`save_draft`): exige `started` y que la tabla deje guardar; valida que cada id de ejercicio y de pregunta sea de la publicación del intento; compara `p_revision` con la del borrador (`CONFLICT revision_mismatch`) y la sube.

Entregar (`submit_attempt`), lo que pide R3-4:

```sql
select ... from app.assignment_attempts t where t.id = p_attempt_id for update;
if t.status = 'submitted' then
  return jsonb_build_object('submittedAt', t.submitted_at, 'late', t.late, 'alreadySubmitted', true);
end if;
if t.status <> 'started' then perform app.raise_error('CONFLICT', 'attempt_not_started'); end if;
<la tabla deja entregar: no retirada, no reemplazado, después de publish_at>
select s.revision into v_draft from app.submissions s where s.attempt_id = p_attempt_id for update;
if v_draft <> p_revision then perform app.raise_error('CONFLICT', 'draft_outdated'); end if;
update app.submissions set submitted_at = now() where attempt_id = p_attempt_id;
update app.assignment_attempts set status = 'submitted', submitted_at = now(), late = <now() > due_at>,
       revision = revision + 1 where id = p_attempt_id;
update app.assignments set status = 'submitted', revision = revision + 1 where id = t.assignment_id;
```

- El segundo clic encuentra `submitted` y no cambia nada.
- Si otra pestaña guardó algo más nuevo, la respuesta es `draft_outdated` y la pantalla muestra lo último antes de entregar.
- Después de entregar, el trigger de `submissions` rechaza cualquier cambio con `CONFLICT already_submitted`.
- Corregir (`grade_attempt`, T1.5c) se puede desde que hay entrega, también en una publicación retirada o un intento reemplazado.

## Clave

Lo que pide R3-3:

- `answer_key_revisions` es solo agregar. Cada revisión guarda su contenido, `version_revision`, `exercise_revisions` (`{ id del ejercicio adaptado: revisión }`) y `question_ids` en el momento en que se generó, editó o confirmó.
- Una revisión R corresponde a la versión V si `R.exercise_revisions` es igual al mapa de revisiones de los ejercicios de V de hoy y `R.question_ids` es igual al conjunto de preguntas de V de hoy. `version_revision` queda para trazar, no para comparar: cambiar destinatarios sube la revisión de la versión pero no toca la clave.
- `answer_keys.stale` lo prende toda edición de un ejercicio o una pregunta (T1.4c). Publicar no confía en el flag: compara.
- Confirmar (`confirm_answer_key`) crea una revisión nueva con el mismo contenido y las revisiones de hoy. En mirada exige una opción correcta para cada pregunta de hoy.
- Editar y confirmar mandan la revisión de la que partieron (`p_base_revision_id`). Si no es la vigente, `CONFLICT`.
- Cada intento apunta a una revisión de la clave. Una revisión nueva no cambia la de los intentos viejos.

## Seudónimos y supresiones

Lo que pide R3-7, y lo que el esquema garantiza:

- El seudónimo es el id de su fila en `student_pseudonyms`. `feedback_events` y `group_analyses` usan el seudónimo, no el id del estudiante. A la IA no le llega ninguno de los dos: el análisis usa etiquetas (E1, E2) y el mapa queda en `group_analyses.pseudonym_map`.
- Un estudiante con su seudónimo vinculado no se puede borrar: la FK no tiene `ON DELETE`. Primero se desvincula (`student_id` nulo y `unlinked_at`).
- Una cuenta que no está marcada `deleted` tampoco deja borrar al estudiante, y la marca sobrevive a la fila del estudiante. Así `reconcile_accounts` nunca recrea la cuenta.
- Los archivos frenan el borrado de su dueño: primero se borran los objetos de Storage y después las filas.
- `erasures` guarda solo el seudónimo, ya desvinculado, y fechas. Se marca antes de borrar nada. Se copia afuera de la base en la misma acción (`external_copied_at`).

Lo que no garantiza:

- Desvincular no anonimiza. El texto libre, las fechas y las combinaciones raras pueden identificar. Lo que queda atado a un seudónimo desvinculado es dato personal salvo que el inventario (T1.9, `docs/PRIVACIDAD-DATOS.md`) diga, campo por campo, que se borró o se redactó.
- `audit_log` guarda ids de estudiantes que, después de la supresión, ya no se resuelven a nadie. El registro de accesos se conserva por su plazo de retención; el inventario lo justifica.
- Los respaldos conservan los datos hasta que vencen (30 días). Al restaurar se vuelven a aplicar las supresiones del registro externo.

## Matriz de permisos

`lib/domain/permissions/matrix.ts` tiene una fila por RPC y una columna por rol, con la fase desde la que rige y el ticket. Lo que no está permitido se niega. Las decisiones que no estaban en el spec:

- El admin administra la institución: grupos, staff, estudiantes y consentimientos. No lee perfiles, notas, prácticos ni entregas de grupos donde no es staff. Es lo mínimo para datos de salud. Si también enseña, entra como profe del grupo.
- Inclusión lee y edita perfiles de toda la institución, y lee grupos, estudiantes y consentimientos. Nunca notas, prácticos ni entregas.
- El visitante del sandbox es profe dentro de su sandbox, menos lo que tiene efectos reales: no suma staff y `create_student` no crea cuenta real.
- El estudiante solo actúa sobre lo suyo (`own`).
- Sin sesión, todo se niega. Las RPC `internal_*` se niegan a todos los roles de usuario.

## Tickets de la fase 1

Tandas. Cada tanda tiene a lo sumo un ticket con migraciones (turno de base). Los tickets de base van en fila; los de repos corren al lado, sobre lo ya mergeado.

| Tanda | Turno de base | En paralelo |
|---|---|---|
| 1 | T1.2a | T1.9 |
| 2 | T1.2b | T1.6a |
| 3 | T1.3a | |
| 4 | T1.3b | |
| 5 | T1.4a | T1.6b |
| 6 | T1.4b | |
| 7 | T1.4c | T1.7a |
| 8 | T1.4d | |
| 9 | T1.4e | |
| 10 | T1.5a | T1.7b |
| 11 | T1.5b | |
| 12 | T1.5c | |
| 13 | T1.5d | |
| 14 | | T1.7c, T1.8 |

Reglas comunes a los tickets de base, además de las de `AGENTS.md`:

- Una migración nueva con el nombre de su ticket, que reemplaza los stubs con `CREATE OR REPLACE FUNCTION`, misma firma, y concede `EXECUTE` como dice «Nombres». Se aplica con `supabase migration up`, nunca con `db reset`.
- Toda RPC sigue «Errores», «Quién llama» y «Orden de locks y revisión».
- Toda RPC auditada llama a `app.audit_disclosure` una vez por pedido, con el conjunto de estudiantes que muestra.
- pgTAP por RPC: el caso feliz; cada rol de la matriz que la niega; un usuario de otra institución; la revisión vieja (`CONFLICT`); el `op_key` o `op_id` repetido; y la fila de `audit_log` donde corresponde. Los usuarios se simulan con `set_config('request.jwt.claims', ...)` y `set local role authenticated` para probar el privilegio.
- `npm run db:types` regenera `lib/server/db/types.ts` si el ticket cambió algo que se vea ahí (no debería: las firmas no cambian).
- Ninguna tabla nueva: si hace falta una, `BLOQUEADO`.

```
T1.2a · Identidad y grupos
Agente: backend          Tanda: 1        Depende de: contrato
Turno de base: sí
Objetivo: las RPC internas de identidad y las de grupos y su staff funcionan, autorizadas por la base.
Archivos que puede crear o cambiar: supabase/migrations/20261112100000_t1_2a_identity_groups.sql,
  supabase/tests/010_identity_groups.test.sql.
Contratos que usa (solo lectura): docs/contratos/fase-1.md, migraciones 2026111113*, lib/domain/identity/**,
  lib/domain/groups/**, lib/domain/permissions/matrix.ts.
Criterios de aceptación:
  - internal_create_institution, internal_upsert_app_user, internal_add_membership e internal_revoke_membership,
    solo para service_role.
  - list_my_institutions devuelve las instituciones y roles activos del actor; un sandbox vencido no aparece.
  - create_group valida la institución contra las membresías del actor y deja al creador como owner.
  - update, archive y restore con revisión. add y remove staff solo owner o admin, nunca en un sandbox, y solo
    con personas que son profe o admin activos de la institución (si no, INVALID not_a_member).
  - Un trigger impide que una persona sea estudiante y staff en la misma institución.
Pruebas obligatorias: 010_identity_groups.test.sql con las reglas comunes; internal_* rechazadas como anon y
  authenticated.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: lecturas de grupos (T1.2b), invitaciones (T2.3), sacar a alguien de la institución (T9.6).
Dependencias nuevas: ninguna.
```

```
T1.2b · Estudiantes, inscripciones y listados
Agente: backend          Tanda: 2        Depende de: T1.2a
Turno de base: sí
Objetivo: crear, editar, archivar e inscribir estudiantes, y listar grupos y estudiantes sin datos sensibles.
Archivos que puede crear o cambiar: supabase/migrations/20261112110000_t1_2b_students.sql,
  supabase/tests/011_students.test.sql.
Contratos que usa (solo lectura): los de T1.2a, lib/domain/students/entities.ts, lib/domain/students/rpc.ts.
Criterios de aceptación:
  - create_student, con op_key, crea estudiante, inscripción, seudónimo y account_provisioning pending (en un
    sandbox, sin provisioning). Un usuario repetido en la institución es CONFLICT username_taken.
  - update, archive y restore con revisión; enroll y unenroll con una sola inscripción activa.
  - internal_link_student_user (service_role) vincula la cuenta, crea la membresía student y pasa el
    provisioning a active.
  - list_my_groups, get_group y list_group_students: proyecciones paginadas con exactamente las claves de su
    esquema. Admin e inclusión ven los grupos de la institución; un profe, los suyos.
Pruebas obligatorias: 011_students.test.sql con las reglas comunes; las proyecciones no tienen ninguna clave
  fuera de su esquema.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: crear la cuenta de Auth (T2.5), importar (T6.1), perfiles (T1.3a).
Dependencias nuevas: ninguna.
```

```
T1.3a · Perfiles, lecturas auditadas y prueba de reconstrucción
Agente: backend          Tanda: 3        Depende de: T1.2b
Turno de base: sí
Objetivo: los perfiles se guardan con historial y solo se leen por RPC auditadas.
Archivos que puede crear o cambiar: supabase/migrations/20261112120000_t1_3a_needs.sql,
  supabase/tests/012_needs.test.sql, supabase/tests/013_reconstruction.test.sql.
Contratos que usa (solo lectura): lib/domain/students/needs.ts, lib/domain/students/rpc-sensitive.ts.
Criterios de aceptación:
  - set_student_needs crea o edita con revisión, rechaza perfiles y apoyos fuera del catálogo
    (unknown_profile, unknown_support) y escribe student_need_events con op_id.
  - get_student_needs, get_group_needs y list_student_need_events escriben una fila de audit_log por pedido,
    con el conjunto de estudiantes sin repetir; ninguna fila si no mostró a nadie.
  - Inclusión lee y edita perfiles de toda la institución; el admin no.
Pruebas obligatorias: 012_needs.test.sql con las reglas comunes. 013_reconstruction.test.sql: como profe del
  grupo, llama a todas las RPC no auditadas que existan y comprueba que ninguna respuesta contiene un perfil, un
  apoyo, un interés, la configuración de una versión ni sus destinatarios. Cada ticket posterior que agrega una
  lectura no auditada suma su llamada a esta prueba.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: consentimiento store_profile (T9.3), vista del registro (T9.4).
Dependencias nuevas: ninguna.
```

```
T1.3b · Notas privadas y consentimientos
Agente: backend          Tanda: 4        Depende de: T1.3a
Turno de base: sí
Objetivo: notas del profe y consentimientos por finalidad, con lecturas auditadas.
Archivos que puede crear o cambiar: supabase/migrations/20261112130000_t1_3b_notes_consents.sql,
  supabase/tests/014_notes_consents.test.sql, supabase/tests/013_reconstruction.test.sql (sumar sus lecturas).
Contratos que usa (solo lectura): lib/domain/students/records.ts, lib/domain/students/rpc-sensitive.ts.
Criterios de aceptación:
  - Notas: crear, editar y archivar solo quien la escribió; leer solo staff del grupo; inclusión nunca.
  - record_consent deja un solo consentimiento vigente por finalidad (registrar otro revoca el anterior en la
    misma transacción); revoke_consent con revisión.
  - list_student_notes y list_student_consents auditadas.
Pruebas obligatorias: 014_notes_consents.test.sql con las reglas comunes.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: subir el formulario firmado (T4.5) y los efectos de revocar (T9.3).
Dependencias nuevas: ninguna.
```

```
T1.4a · Prácticos y ejercicios originales
Agente: backend          Tanda: 5        Depende de: T1.2b
Turno de base: sí
Objetivo: crear y editar prácticos con instrucciones generales y ejercicios con id estable.
Archivos que puede crear o cambiar: supabase/migrations/20261112140000_t1_4a_assessments.sql,
  supabase/tests/015_assessments.test.sql, supabase/tests/013_reconstruction.test.sql (sumar sus lecturas).
Contratos que usa (solo lectura): lib/domain/assessments/entities.ts, lib/domain/assessments/rpc.ts.
Criterios de aceptación:
  - create_assessment toma la materia del grupo, nunca del navegador.
  - add, update y remove de ejercicios con revisión del ejercicio; reorder con revisión del práctico y el
    conjunto exacto de ejercicios vigentes (si no, INVALID).
  - Editar o sacar un ejercicio marca stale las versiones que lo adaptaron, tomando los locks en orden.
  - list_assessments y get_assessment solo para staff del grupo.
Pruebas obligatorias: 015_assessments.test.sql con las reglas comunes.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: leer un documento (T3.4), publicar fechas (T8.1).
Dependencias nuevas: ninguna.
```

```
T1.4b · Versiones, configuración y destinatarios
Agente: backend          Tanda: 6        Depende de: T1.4a, T1.3a
Turno de base: sí
Objetivo: versiones con su configuración y sus destinatarios en el tiempo, leídas por RPC auditada.
Archivos que puede crear o cambiar: supabase/migrations/20261112150000_t1_4b_versions.sql,
  supabase/tests/016_versions.test.sql, supabase/tests/013_reconstruction.test.sql (sumar list_versions).
Contratos que usa (solo lectura): lib/domain/assessments/versions.ts, lib/domain/assessments/rpc-versions.ts.
Criterios de aceptación:
  - create_version asigna la posición siguiente y crea un version_exercise pending por cada ejercicio
    conservado (config.keep, o todos).
  - set_version_recipients cierra las filas vigentes (valid_to) y abre las nuevas, sube la revisión, escribe
    recipients_changed con op_id y exige, con un trigger, que cada destinatario esté inscripto en el grupo.
  - list_versions no devuelve config, answer_mode ni destinatarios. get_version es auditada con los
    destinatarios que muestra.
Pruebas obligatorias: 016_versions.test.sql con las reglas comunes; un estudiante no inscripto como
  destinatario falla; un estudiante con dos versiones del mismo práctico falla.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: vista previa (T7.2), generar (T1.4d y T5.1).
Dependencias nuevas: ninguna.
```

```
T1.4c · Contenido de la versión y aprobación
Agente: backend          Tanda: 7        Depende de: T1.4b
Turno de base: sí
Objetivo: editar ejercicios adaptados y preguntas, y aprobar o rechazar una revisión concreta.
Archivos que puede crear o cambiar: supabase/migrations/20261112160000_t1_4c_version_content.sql,
  supabase/tests/017_version_content.test.sql.
Contratos que usa (solo lectura): lib/domain/assessments/rpc-versions.ts, 20261111130900_lock_order.sql.
Criterios de aceptación:
  - Cada edición sigue el protocolo CAS de este documento: lock_version_tree, revisión del ejercicio, revisión
    de la versión, answer_keys.stale y evento edited con op_id (repetido no aplica dos veces).
  - set_question_key con revisión de la fila de la clave.
  - approve_version exige p_revision = revision y deja approved_revision; cualquier cambio posterior la deja
    atrás. reject_version escribe rejected con sus motivos.
Pruebas obligatorias: 017_version_content.test.sql con las reglas comunes; aprobar una revisión vieja es
  CONFLICT; editar después de aprobar deja la versión sin aprobar.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: regenerar un ejercicio (T7.4), checklist (T7.5).
Dependencias nuevas: ninguna.
```

```
T1.4d · Generaciones (internas)
Agente: backend          Tanda: 8        Depende de: T1.4c, T1.6a
Turno de base: sí
Objetivo: crear, completar y cerrar generaciones con vigencia por recurso, sin que un resultado tardío pise nada.
Archivos que puede crear o cambiar: supabase/migrations/20261112170000_t1_4d_generations.sql,
  supabase/tests/018_generations.test.sql, tests/integration/generations-concurrency.test.ts.
Contratos que usa (solo lectura): lib/domain/assessments/generations.ts, lib/domain/assessments/rpc-generations.ts,
  «Vigencia» del spec, tests/factories/**.
Criterios de aceptación:
  - internal_create_generation es idempotente por op_key (created false), reemplaza las generaciones vigentes
    según «Vigencia» y guarda en inputs las revisiones esperadas de cada ejercicio.
  - internal_record_generation_output guarda siempre la salida y la aplica solo si sigue vigente (applied u
    obsolete).
  - internal_finish_generation cierra una sola vez y escribe un único evento generated.
  - Solo service_role.
Pruebas obligatorias: 018_generations.test.sql; en integración, con dos clientes a la vez: los dos últimos
  ejercicios que terminan juntos (un solo generated), una salida que llega después de cerrar (obsolete), una
  edición manual que gana a una salida y dos regeneraciones de ejercicios distintos.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: trabajos y presupuesto (fase 3), request_generation (T5.1).
Dependencias nuevas: ninguna.
```

```
T1.4e · Clave de respuestas
Agente: backend          Tanda: 9        Depende de: T1.4d
Turno de base: sí
Objetivo: revisiones inmutables de la clave, con su correspondencia a los ejercicios y preguntas.
Archivos que puede crear o cambiar: supabase/migrations/20261112180000_t1_4e_answer_keys.sql,
  supabase/tests/019_answer_keys.test.sql.
Contratos que usa (solo lectura): sección «Clave» de este documento, lib/domain/assessments/rpc-generations.ts.
Criterios de aceptación:
  - edit, confirm e internal_record_answer_key_revision agregan una revisión numerada con exercise_revisions y
    question_ids de hoy; CAS con p_base_revision_id.
  - confirm en mirada exige una opción para cada pregunta vigente.
  - get_answer_key solo staff del grupo; nunca un estudiante.
  - Una función app.answer_key_matches(revisión, versión) que usa publish_version.
Pruebas obligatorias: 019_answer_keys.test.sql con las reglas comunes; editar un ejercicio deja la clave sin
  corresponder hasta confirmarla; una revisión no se puede modificar.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: generar la clave con IA (T7.6).
Dependencias nuevas: ninguna.
```

```
T1.5a · Publicación mínima
Agente: backend          Tanda: 10       Depende de: T1.4e, T1.3b
Turno de base: sí
Objetivo: publish_version sin fechas, según «Intentos y entrega».
Archivos que puede crear o cambiar: supabase/migrations/20261112190000_t1_5a_publish.sql,
  supabase/tests/020_publish.test.sql.
Contratos que usa (solo lectura): lib/domain/delivery/**, sección «Intentos y entrega».
Criterios de aceptación: los puntos de «Publicar» de este documento, cada uno con su error (not_approved,
  missing_questions, stale_answer_key, missing_consent, not_enrolled); el op_key repetido devuelve la misma
  publicación; la copia no lleva opción correcta, changes ni config.
Pruebas obligatorias: 020_publish.test.sql con las reglas comunes; volver a publicar mueve solo intentos sin
  empezar.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: fechas, retirar y reasignar (T8.1).
Dependencias nuevas: ninguna.
```

```
T1.5b · Intentos del estudiante
Agente: backend          Tanda: 11       Depende de: T1.5a
Turno de base: sí
Objetivo: abrir, empezar, guardar y entregar con la tabla de intentos del spec.
Archivos que puede crear o cambiar: supabase/migrations/20261112200000_t1_5b_attempts.sql,
  supabase/tests/021_attempts.test.sql, tests/integration/submit-concurrency.test.ts.
Contratos que usa (solo lectura): lib/domain/delivery/attempt-rules.ts, lib/domain/delivery/rpc.ts.
Criterios de aceptación: el protocolo de «Intentos y entrega»; cada fila de la tabla del spec probada; ids de
  otra publicación rechazados (unknown_exercise); un estudiante no toca el intento de otro.
Pruebas obligatorias: 021_attempts.test.sql; en integración, dos entregas a la vez entregan una vez, y un
  guardado de otra pestaña antes de entregar da draft_outdated.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: feedback_events (T8.5), dictado (fase 4).
Dependencias nuevas: ninguna.
```

```
T1.5c · Corrección
Agente: backend          Tanda: 12       Depende de: T1.5b
Turno de base: sí
Objetivo: el profe ve el estado por estudiante y corrige lo entregado.
Archivos que puede crear o cambiar: supabase/migrations/20261112210000_t1_5c_grading.sql,
  supabase/tests/022_grading.test.sql, supabase/tests/013_reconstruction.test.sql (sumar list_assessment_attempts).
Contratos que usa (solo lectura): lib/domain/delivery/rpc.ts.
Criterios de aceptación: list_assessment_attempts no dice qué versión recibió cada uno; get_attempt_for_grading
  auditada; grade_attempt con revisión, solo con entrega (not_submitted), resultados por id de ejercicio de la
  publicación.
Pruebas obligatorias: 022_grading.test.sql con las reglas comunes.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: análisis del grupo (T3.5).
Dependencias nuevas: ninguna.
```

```
T1.5d · Lo que ve el estudiante y prueba de fugas
Agente: backend          Tanda: 13       Depende de: T1.5c, T1.6a
Turno de base: sí
Objetivo: los cuatro DTO del estudiante, con exactamente las claves de su lista.
Archivos que puede crear o cambiar: supabase/migrations/20261112220000_t1_5d_student_dto.sql,
  supabase/tests/023_student_dto.test.sql, tests/integration/student-dto-leaks.test.ts.
Contratos que usa (solo lectura): lib/domain/delivery/student-dto.ts, lib/domain/delivery/leaks.ts.
Criterios de aceptación: interface, answer_mode y aids calculados en el servidor, sin nombrar perfiles; sin
  consentimiento de dictado, voice pasa a typed en cada lectura; student_grades solo intentos corregidos.
Pruebas obligatorias: en integración, un estudiante con perfil motor y otro con dislexia en el mismo grupo:
  findLeaks sobre cada DTO no encuentra claves fuera de la lista, ni la opción correcta, ni un perfil, ni el id
  del otro estudiante.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: el payload RSC (T4.8).
Dependencias nuevas: ninguna.
```

```
T1.6a · Fábricas de prueba, callRpc y repos de grupos
Agente: backend          Tanda: 2        Depende de: T1.2a
Turno de base: no
Objetivo: los tests de integración crean su institución y sus usuarios logueados, y los repos de identidad y
  grupos pasan por un único callRpc.
Archivos que puede crear o cambiar: lib/server/repos/rpc.ts, lib/server/repos/rpc.test.ts,
  lib/server/repos/institutions.ts, lib/server/repos/groups.ts, lib/server/repos/admin/identity.ts,
  tests/factories/index.ts, tests/factories/institutions.ts, tests/factories/users.ts,
  tests/factories/clients.ts, tests/integration/groups.test.ts, tests/integration/isolation-groups.test.ts.
Contratos que usa (solo lectura): lib/domain/rpc.ts, lib/domain/errors/**, lib/server/db/**.
Criterios de aceptación: callRpc según «Registro de RPC»; las fábricas crean usuarios de Auth con el cliente
  admin y los vinculan con las RPC internas (nunca con SQL directo); cada test crea su propia institución.
Pruebas obligatorias: unidad de callRpc con un cliente falso (error esperado, inesperado y respuesta inválida);
  integración de los repos de grupos y su aislamiento con un usuario de otra institución.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: servicios (fase 4), repos de estudiantes (T1.6b).
Dependencias nuevas: ninguna.
```

```
T1.6b · Repos de estudiantes, perfiles, notas y consentimientos
Agente: backend          Tanda: 5        Depende de: T1.2b, T1.3b, T1.6a
Turno de base: no
Archivos que puede crear o cambiar: lib/server/repos/students.ts, lib/server/repos/needs.ts,
  lib/server/repos/notes.ts, lib/server/repos/consents.ts, lib/server/repos/admin/students.ts,
  tests/factories/students.ts, tests/integration/students.test.ts, tests/integration/needs.test.ts,
  tests/integration/notes-consents.test.ts.
Objetivo, criterios y pruebas: como T1.6a, para sus RPC; las lecturas auditadas dejan su fila de audit_log
  con el id del pedido.
```

```
T1.7a · Repos de prácticos y versiones
Agente: backend          Tanda: 7        Depende de: T1.4b, T1.6a
Turno de base: no
Archivos que puede crear o cambiar: lib/server/repos/assessments.ts, lib/server/repos/versions.ts,
  tests/factories/assessments.ts, tests/integration/assessments.test.ts, tests/integration/versions.test.ts.
Objetivo, criterios y pruebas: como T1.6a, para sus RPC, con aislamiento.
```

```
T1.7b · Repos de contenido, generaciones y clave
Agente: backend          Tanda: 10       Depende de: T1.4e, T1.7a
Turno de base: no
Archivos que puede crear o cambiar: lib/server/repos/version-content.ts, lib/server/repos/answer-keys.ts,
  lib/server/repos/admin/generations.ts, tests/integration/version-content.test.ts,
  tests/integration/answer-keys.test.ts.
Objetivo, criterios y pruebas: como T1.6a, para sus RPC. admin/generations.ts es lo que usará el puente de
  la fase 4 (T4.3).
```

```
T1.7c · Repos de publicación, intentos, corrección y estudiante
Agente: backend          Tanda: 14       Depende de: T1.5d, T1.7b
Turno de base: no
Archivos que puede crear o cambiar: lib/server/repos/publications.ts, lib/server/repos/attempts.ts,
  lib/server/repos/grading.ts, lib/server/repos/student.ts, tests/integration/delivery.test.ts,
  tests/integration/student.test.ts.
Objetivo, criterios y pruebas: como T1.6a, para sus RPC; lo que devuelve student.ts pasa findLeaks.
```

```
T1.8 · Prueba de la matriz de permisos
Agente: backend          Tanda: 14       Depende de: T1.5d, T1.6a
Turno de base: no
Objetivo: un test recorre lib/domain/permissions/matrix.ts rol por rol contra las RPC y la API REST.
Archivos que puede crear o cambiar: tests/integration/permissions-matrix.test.ts,
  tests/integration/matrix/fixtures.ts, tests/integration/matrix/calls.ts.
Contratos que usa (solo lectura): lib/domain/permissions/**, lib/domain/rpc.ts, tests/factories/**.
Criterios de aceptación: un fixture por rol de roles.ts sobre un grupo objetivo; para cada fila de
  operationsFor(1), allow tiene éxito, deny da FORBIDDEN o NOT_FOUND (o un listado sin el objetivo) y own se
  prueba sobre lo propio y lo ajeno; un usuario de otra institución se niega en todas; cada tabla de APP_TABLES
  pedida por REST no existe para ningún rol, con y sin la cabecera Accept-Profile: app. El visitante del
  sandbox puede ser un usuario común dueño de un sandbox: las reglas miran el tipo de institución.
Pruebas obligatorias: las de arriba.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: botones de la UI (fase 4).
Dependencias nuevas: ninguna.
```

```
T1.9 · Inventario de datos personales
Agente: orquestador      Tanda: 1        Depende de: contrato
Turno de base: no
Objetivo: docs/PRIVACIDAD-DATOS.md dice, para cada tabla y campo con datos de un estudiante, qué pasa al
  borrarlo, y una prueba lo compara con el esquema.
Archivos que puede crear o cambiar: docs/PRIVACIDAD-DATOS.md, supabase/tests/003_inventory.test.sql,
  lib/domain/permissions/inventory.test.ts.
Contratos que usa (solo lectura): este documento, lib/domain/permissions/tables.ts.
Criterios de aceptación: 003_inventory compara las tablas de app con una lista literal; inventory.test.ts
  comprueba que esa lista, APP_TABLES y las tablas del inventario son las mismas, y que cada tabla de
  STUDENT_DATA_TABLES dice qué se borra, qué se redacta y qué se conserva y por qué. También lista los
  proveedores y qué recibe cada uno.
Pruebas obligatorias: las de arriba.
Inventario de datos: es este ticket.
Fuera de alcance: exportar y borrar (T9.5).
Dependencias nuevas: ninguna.
```
