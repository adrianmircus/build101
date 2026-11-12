# Contrato de la fase 1

Este documento fija la base de datos de la fase 1: dónde viven las tablas, cómo se escriben las RPC, cómo se toman los locks y cómo se reparten los tickets. Lo escribió el orquestador antes de repartir. Los tickets lo leen y no lo cambian: si algo no cierra, responden `BLOQUEADO`.

Fecha: 11/11/2026. Rama: `plataforma/f1-contratos`. Incorpora las ocho rondas de revisión de Codex del contrato (C1 a C22) y los hallazgos de T1.9 sobre el inventario.

Archivos del contrato:

- Migraciones `supabase/migrations/20261111130000` a `20261111131300`. Nacen cerradas y ningún ticket las edita.
- Pruebas `supabase/tests/000_privileges.test.sql`, `001_contract.test.sql`, `002_contract_rules.test.sql`, `003_contract_history.test.sql`, `004_contract_redaction.test.sql` y `005_student_role.test.sql`.
- Tipos y esquemas en `lib/domain/`, con el registro de RPC en `lib/domain/rpc.ts`.
- El chequeo de compilación entre el registro y la base, en `lib/server/db/rpc-contract.ts`.
- La regla de supresión de cada tabla con datos de un estudiante, en `lib/domain/permissions/erasure.ts`.
- `supabase/config.toml` expone solo el esquema `api`; los clientes (`lib/server/db/client.ts` y `admin.ts`) apuntan a él.

## Decisiones

### Tres esquemas: `app`, `api` y `public`

| Esquema | Qué tiene | Quién lo usa |
|---|---|---|
| `app` | Todas las tablas y las funciones auxiliares | Nadie más que su dueño, `postgres`. Ni `service_role` |
| `api` | Solo las RPC, todas `SECURITY DEFINER` | Lo expone PostgREST, solo. `authenticated` y `service_role` lo pueden mirar; ejecutan solo lo que cada ticket concede. `anon` nada |
| `public` | Nada nuestro | Cerrado para `anon` y `authenticated` |

Por qué las tablas en `app`:

- El spec ya pide que toda escritura y toda lectura sensible pase por una RPC. Con las tablas fuera de la API, un `GRANT` puesto por error no se convierte en un endpoint. Es una segunda pared.
- Nadie usa `app` salvo su dueño. Ni `service_role`: el código privilegiado también entra por RPC internas. Así la clave secreta no lee tablas de salud de forma directa.
- Los tipos generados (`npm run db:types`) muestran solo las RPC, con sus parámetros. Un repo no puede hablar con una tabla porque no la ve.

Por qué las RPC en `api` y no en `public` (C12). `supabase_admin`, el rol con el que Supabase crea objetos propios (extensiones, cosas del panel), tiene privilegios por defecto en `public` que conceden todo lo que crea a `anon` y `authenticated`. `postgres`, que corre las migraciones, no puede cambiar los privilegios por defecto de otro rol, ni en local ni en Supabase hospedado. Las opciones, y por qué se eligió esta:

- Correr un arranque como `supabase_admin`. En local se puede; en Supabase hospedado no hay acceso a ese rol. No sirve en los dos lados.
- Un event trigger que revoque lo que se crea. En Supabase los event triggers de un rol que no es superusuario no se disparan para comandos de un superusuario, y `supabase_admin` lo es. No cubre justo el caso.
- Excluir a ese creador de lo expuesto, que es lo elegido. Funciona igual en local y hospedado, porque son migraciones de `postgres` y una opción de configuración:
  - `api` lo crea `postgres`, así que en `api` solo rigen los privilegios por defecto de `postgres`, y esos están cerrados (ni `service_role` recibe nada solo);
  - `api` es el único esquema expuesto: `supabase/config.toml` en local y «Exposed schemas» en el proyecto hospedado, que se fija al crear staging y producción (T1.0). `public` y `graphql_public` quedan afuera;
  - `public` además queda cerrado: la migración saca `USAGE` a `PUBLIC`, `anon` y `authenticated`, y se lo devuelve explícitamente a todos los demás roles. Aunque `public` vuelva a exponerse por error, nada de lo que cree `supabase_admin` ahí se puede usar desde la API.

Cómo se prueba:

- `000_privileges` falla si `anon` o `authenticated` pueden usar `public`, si algún objeto de `app` o `api` es de otro rol que `postgres`, o si otro rol tiene privilegios por defecto en `app` o `api`.
- `tests/integration/db-connection.test.ts` falla si PostgREST expone otro esquema que `api` (pide `public`, `app` y `graphql_public` con `Accept-Profile` y espera `PGRST106`). T10.1 corre la misma prueba contra staging y producción, así la opción del panel también queda verificada.

Un rol que Supabase agregue más adelante nace sin `USAGE` en `public`. Si algo de Supabase lo necesitara, falla cerrado y se concede por nombre.

Consecuencia: en la fase 1 también las lecturas no sensibles van por RPC (ver «Decisiones que cambian el spec»).

### RLS activado y forzado, sin políticas

Cada tabla tiene `ENABLE` y `FORCE ROW LEVEL SECURITY`, y ninguna política.

- Sin políticas, RLS niega todo a cualquier rol que no la saltee. Es la tercera pared, detrás del esquema no expuesto y de la falta de privilegios.
- `FORCE` hace que la regla valga también para el dueño de la tabla si algún día deja de tener `BYPASSRLS`. Hoy `postgres` lo tiene, así que las RPC, que corren como `postgres`, no se ven afectadas. Si cambia el dueño, todo falla cerrado, nunca abierto.
- Las RPC autorizan por su cuenta, con las funciones de `app` (ver «Quién llama»).
- Si un ticket futuro agrega una vista en `api` para un listado flexible, la vista va con `security_invoker`, privilegios por columna y políticas escritas sobre conjuntos. Los índices `(user_id, institution_id)` y `(user_id, group_id)` ya están.

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

`lib/domain/rpc.ts` junta todas las RPC: por nombre, el esquema de `args` con las claves de los parámetros de SQL y el de `result`. Los tipos se generan del esquema `api` (`npm run db:types`). `lib/server/db/rpc-contract.ts` falla en `npm run typecheck` si el registro y la base no nombran las mismas funciones, o si los argumentos no coinciden en nombre y tipo.

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
- Guardias propias: una generación u operación terminada no se reabre; una publicación solo se retira, una vez; un intento solo avanza (`opened`, `started`, `submitted`) y, después de empezar, no cambia de publicación ni de clave; un intento siempre usa la revisión de la clave de su publicación (`app.attempts_key_matches`); una entrega no cambia después de `submitted_at`.

Actores en el historial (C7). Una fila que no se modifica nunca no puede tener una FK que la modifique al borrar el padre. Por eso `student_need_events.actor_user_id`, `version_events.actor_user_id`, `answer_key_revisions.author_user_id` y `publications.published_by` no tienen FK: guardan el id de quien actuó, como `audit_log`. Borrar la cuenta deja el historial intacto y ese id deja de llevar a alguien. `001_contract` falla si alguna FK con `SET NULL`, `SET DEFAULT` u `ON UPDATE CASCADE` apunta desde una tabla de solo agregar o inmutable, y `003_contract_history` borra una cuenta que escribió historial y comprueba que todo sigue.

### Instrucciones generales (C2)

- La versión tiene su propia copia, `versions.general_instructions`, adaptada o no. Nace copiada del práctico, la puede adaptar la generación (salida `instructions`) y la puede editar el profe con `update_version_instructions`.
- Es parte del contenido aprobado: editarla sube `instructions_revision` y la revisión de la versión, así una aprobación anterior deja de valer. `get_version` la devuelve con el resto y la publicación copia esta, no la del práctico.
- Cambiar las instrucciones del práctico (`update_assessment`) marca `stale` sus versiones. Nunca cambia un texto ya aprobado debajo del profe; regenerar o editar lo actualiza.
- Tiene la misma procedencia que un ejercicio (`instructions_written_by`, ver «Una salida de la IA»).

### El rol del estudiante

Lo que lee un estudiante nunca sale de la clave ni de los perfiles de nadie, y eso lo garantiza Postgres, no una revisión del código. Un chequeo estático de los cuerpos de las funciones no alcanza: no ve nombres entre comillas, helpers de otros esquemas, vistas, triggers ni cuerpos `BEGIN ATOMIC`.

- Toda RPC `api.student_*` es `SECURITY DEFINER` y su dueño es `tiza_student` (`20261111131300_student_role.sql`). Corre con los privilegios de ese rol, por cualquier camino: helpers, vistas, triggers, cualquier esquema. Las RPC de intentos también llevan el prefijo: `student_open_attempt`, `student_start_attempt`, `student_save_draft` y `student_submit_attempt`.
- `tiza_student` es `NOLOGIN` y `NOINHERIT`, no es miembro de ningún rol y ningún rol de la API es miembro suyo. Su único miembro es `postgres`, con `ADMIN OPTION` y sin `SET` ni `INHERIT`: Postgres se lo da a quien crea el rol, y es lo que deja a las migraciones pasarle funciones.
- Tiene `SELECT` solo sobre `app_users`, `institutions`, `memberships`, `subjects`, `students`, `groups`, `enrollments`, `assessments`, `publications`, `assignments`, `assignment_attempts`, `submissions` y `grades`. De `consents`, solo las columnas que dicen si uno está vigente, nunca el texto ni el archivo. Escribe solo lo que pide el protocolo de intentos, columna por columna: en `assignments`, `status` y `revision`; en `assignment_attempts`, `status`, `first_viewed_at`, `started_at`, `submitted_at`, `late` y `revision`; en `submissions`, inserta `institution_id`, `attempt_id`, `answers` y `choices`, y actualiza `answers`, `choices`, `submitted_at` y `revision`. Nunca puede mover un intento a otra publicación, versión o clave, ni una entrega a otro intento. Nada sobre `question_keys`, `answer_keys`, `answer_key_revisions`, perfiles, notas ni generaciones: cualquier camino hacia ellas falla con `insufficient_privilege`.
- Sin `BYPASSRLS`. Las tablas fuerzan RLS; una política `to tiza_student` en cada tabla concedida lo deja pasar, y solo a las filas del propio estudiante. La cadena arranca en su fila de `students` (`user_id = app.session_user_id()`) y cada tabla se acota por la anterior: sus inscripciones, sus grupos, sus asignaciones, sus intentos, sus publicaciones, sus entregas y notas, sus consentimientos, sus instituciones. Así una RPC del estudiante no ve a ningún otro estudiante ni nada que revele su perfil: su `interface` (mirada implica motriz, voz implica disgrafía), su publicación (`answer_mode`, `aids`) o sus intentos. `subjects` es la única abierta: no tiene datos personales.
- Solo ejecuta helpers `SECURITY INVOKER`: un helper `SECURITY DEFINER` de `postgres` le prestaría más derechos. Por eso los helpers de «Quién llama» pasan a ser invoker, y `app.session_user_id()` reemplaza a `auth.uid()` (el rol no tiene `USAGE` en `auth` y `postgres` no puede dárselo).
- Los triggers de las tablas que escribe (`touch_row`, las guardias de intentos y entregas, `attempts_key_matches`) corren como quien escribe y solo leen `publications`, que está concedida. Si quien escribe no ve la publicación (RLS le oculta a `tiza_student` la de otro estudiante), `attempts_key_matches` rechaza en vez de leer la fila que falta como una clave nula. Postgres no chequea `EXECUTE` al disparar un trigger, así que una función de trigger `SECURITY DEFINER` sobre esas tablas correría con los derechos de su dueño y escaparía del rol. Por eso todo trigger sobre una tabla que `tiza_student` puede escribir llama a una función invoker, y un trigger nuevo tiene que poder correr con este rol.
- Para crear, reemplazar o conceder una RPC del estudiante, la migración abre una ventana: `select app.begin_student_rpc_change();` antes y `select app.end_student_rpc_change();` después. La ventana le da a `postgres` `SET` e `INHERIT` sobre el rol y a este `CREATE` en `api`; al cerrarla, toda `api.student_*` pasa a ser de `tiza_student` y se devuelven los dos permisos.
- La ventana falla cerrada. Abrirla anota la transacción en `app.student_rpc_windows`, y un constraint trigger diferido revisa al hacer commit que se haya cerrado. Si no, la transacción aborta, y como `GRANT` es transaccional los permisos se van con ella: una ventana nunca queda abierta. Usa una tabla y un constraint trigger, que `postgres` puede crear en Supabase hospedado (no hacen falta event triggers ni superusuario).
- Supabase hospedado: `postgres` tiene `CREATEROLE` también ahí, que es todo lo que esto necesita. T1.0 lo confirma al aplicar las migraciones en staging.

`005_student_role` lo prueba: los atributos del rol y sus membresías; que toda `api.student_*` es definer y de `tiza_student`; que no puede ejecutar ninguna otra función definer; la lista exacta de tablas que puede tocar; que no tiene nada sobre la clave, los perfiles, las notas ni las generaciones, ni las columnas de texto de `consents`; que no borra nada; que toda política de `app` es solo para él. Y con funciones creadas en la prueba: una RPC del estudiante que llega a `answer_key_revisions` o a `student_needs` falla con `42501`; el protocolo de empezar un intento, con sus triggers, funciona con el rol; la misma RPC ve solo la fila del propio estudiante y no ve la `interface`, la publicación ni el intento de otro; y no puede apuntar su propio intento a la publicación de otro estudiante (`42501`). Además: ningún trigger sobre una tabla que escribe el rol usa una función definer (y uno plantado en `submissions` hace fallar el chequeo), y una ventana sin cerrar falla al hacer commit sin dejar permisos.

### Quién llama

Funciones de `app`, `SECURITY INVOKER`: corren con los derechos de la RPC que las llama. Solo `tiza_student` tiene `EXECUTE` sobre ellas, para las RPC del estudiante; las del staff corren como `postgres`.

| Función | Devuelve |
|---|---|
| `app.session_user_id()` | El usuario de Auth del pedido, leído de los mismos valores que `auth.uid()` |
| `app.actor_id()` | Ese usuario si tiene fila en `app_users`; si no, nulo |
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
- `student_*`: todo lo que llama un estudiante (sus DTO y sus intentos). Su dueño es `tiza_student` (ver «El rol del estudiante»).
- El ticket que implementa una RPC la reemplaza con `CREATE OR REPLACE FUNCTION` en una migración nueva, con la misma firma, y concede `EXECUTE` a `authenticated` (las de usuario) o a `service_role` (las internas). En `api` nada tiene privilegios por defecto, ni siquiera para `service_role`: si el ticket no concede, nadie ejecuta. Cambiar una firma es cambiar el contrato.

## Decisiones que cambian el spec

- **Lecturas no sensibles por RPC.** El spec dice «RLS en lecturas no sensibles» con `SELECT` para `authenticated`. Con las tablas en `app`, en la fase 1 todas las lecturas son RPC con proyección. Una sola forma de autorizar, una sola cosa que prueba la matriz, y la salida es siempre una lista cerrada de claves. RLS queda activado y sin políticas. Si se mide que un listado necesita la flexibilidad de PostgREST, se agrega una vista como dice «RLS activado y forzado».
- **`op_key` único por institución.** El spec dice «por institución y recurso». Es más estricto: un `op_key` reusado en otro recurso responde `CONFLICT` (`op_key_reused`) en vez de crear una segunda generación.
- **`source_id` de `assessments` se llama `source_file_id`.** Es el documento del que se leyó. Duplicar un práctico (T7.8) suma su propia columna cuando llegue.
- **La publicación mínima pasa a la fase 1 (T1.5a).** El spec la pone en T4.7. Las pruebas de intentos, de los DTO y de fugas necesitan publicaciones hechas por el camino real, y una publicación sembrada a mano no prueba nada. T4.7 queda para el servicio y la acción de publicar.
- **`create_student_note` recibe `p_op_key` (T1.F2).** Cambio aditivo aprobado: una firma nueva, `create_student_note(p_student_id, p_body, p_op_key)`, obligatoria (un nulo es `INVALID`, `invalid_op_key`; no hay valor por defecto porque un envío sin identidad es justo el doble envío que se quiere evitar). La firma vieja se borra. `student_notes` suma `op_key` y `op_identity` (sha256 de estudiante y texto de la creación, que no se reconstruye desde la fila porque el texto se puede editar). El `op_key` es por autor: el mismo `op_key` y la misma identidad responden la nota original (`id`, revisión 1), aunque después se haya editado o archivado; el mismo `op_key` con otro estudiante u otro texto es `CONFLICT` (`op_key_reused`). Las dos columnas se borran con la fila. El front manda un `crypto.randomUUID()` por intento de guardar y lo reusa al reintentar.
- **Toda alta lleva su identidad de operación (T1.F3).** Cambio aditivo aprobado, con el mismo protocolo que `create_student_note`. Firmas nuevas, con `p_op_key` obligatorio (nulo: `INVALID invalid_op_key`); las viejas se borran: `create_group(p_institution_id, p_name, p_subject_id, p_school_year, p_op_key)`, `create_assessment(p_group_id, p_kind, p_topic, p_general_instructions, p_op_key)`, `add_exercise(p_assessment_id, p_label, p_body, p_op_key, p_topic_id = null)` y el stub `create_version(p_assessment_id, p_config, p_answer_mode, p_op_key, p_base_version_id = null)`. `p_op_key` va antes de los parámetros con valor por defecto. `groups`, `assessments`, `assessment_exercises` y `versions` suman `op_key` y `op_identity`; `publications` suma además `op_attempts`, porque `publish_version` ya recibía `p_op_key` y no tenía dónde guardarlo. El detalle, con el inventario de todas las RPC que crean filas, está en «Idempotencia de las altas». `create_group` valida además nombre y año (`invalid_name`, `invalid_school_year`), que antes llegaban como `23514` crudo. El front manda un `crypto.randomUUID()` por intento de guardar y lo reusa al reintentar. Los nombres de migración que dicen los tickets T1.4b a T1.5d ya no están libres (`20261112180000` es la de T1.F3): cada uno usa un timestamp posterior al de la última migración aplicada.
- **Un práctico archivado tiene su propia razón (T1.F3, revisión de T1.4a).** Escribir en un práctico archivado es `INVALID assessment_archived` («ya no se puede cambiar»: un práctico no se restaura); en un grupo archivado sigue siendo `INVALID archived`. Cambiar el tema de un ejercicio adaptado marca `stale` sus versiones, igual que el texto.
- **`unenroll_student` toma la hora después del lock (T1.F2).** Usa `clock_timestamp()` y no `now()`, que podía ser anterior al `started_at` de una inscripción hecha mientras esperaba (`23514` crudo). Sin cambio de contrato.
- **T1.1 no dejó `tests/factories/`.** Las crea T1.6a, sobre las RPC internas de T1.2a.
- **Se parten también T1.2, T1.3 y T1.5**, no solo T1.4. Cada uno pasaba las 400 líneas con sus pruebas.
- **T1.8 va al final de la fase.** La matriz necesita datos de todas las áreas para probar cada fila. Mientras tanto, cada ticket de base prueba sus permisos en pgTAP.
- **`audit_log` y `erasures` no tienen FK a `institutions`.** El registro de accesos se guarda cinco años y el de supresiones tiene que sobrevivir a la baja de la institución. Los borra la retención, no la cascada.
- **Las versiones se nombran por posición** («Versión 1»), no por perfil. Un listado sin datos sensibles puede nombrarlas.
- **El intento nace `opened`** al publicar, y `first_viewed_at` marca la primera vez que el estudiante lo abre. Los tres estados del spec quedan iguales.
- **Guardar el perfil no exige todavía el consentimiento `store_profile`.** El chequeo y sus efectos llegan con T9.3. Hasta la compuerta legal (T10.6) no entra ningún dato real.
- **Las RPC viven en `api`, no en `public`.** El spec habla de «RPC en `public`». Se cambia por los privilegios por defecto de `supabase_admin` (ver «Tres esquemas»).
- **Las instrucciones generales se copian a cada versión.** El spec las pone en `assessments`. La versión tiene su propia copia, que se aprueba y se publica con el resto (ver «Instrucciones generales»).
- **Las RPC del estudiante corren con el rol `tiza_student`.** Lo que no lee la clave ni los perfiles lo garantizan los privilegios de Postgres (ver «El rol del estudiante»). Las RPC de intentos pasan a llamarse `student_open_attempt`, `student_start_attempt`, `student_save_draft` y `student_submit_attempt`, y `students.interface` guarda la forma de responder derivada del perfil.
- **La prueba de fugas garantiza solo lo estructural.** Si un texto aprobado dice la solución se trata como contenido, con un aviso al profe que no bloquea (ver «Prueba de fugas»).
- **`account_provisioning` recuerda la operación (T1.2b-fix).** Suma `op_identity` (sha256 del grupo y el usuario de la creación) y el estado `not_applicable`. `create_student` compara esa identidad bajo el lock del `op_key` y responde siempre lo original (id, `provisioningId` y revisión 1), aunque después se edite o se inscriba al estudiante; otro grupo u otro usuario con el mismo `op_key` es `CONFLICT` (`op_key_reused`). Un sandbox guarda la fila como `not_applicable` (no se aprovisiona ninguna cuenta real) para que repetir el pedido no dé `username_taken`; ahí `provisioningId` sigue siendo nulo. `not_applicable` ya está en `PROVISIONING_STATUSES`. `op_identity` es dato personal: con los UUID de los grupos, que quedan, se pueden probar usuarios candidatos. Al suprimir al estudiante se pone en nulo junto con `student_id`, y se conservan la marca `deleted` y el `op_key` (T1.R, N1).
- **Las opciones de una pregunta validan `GraphSpec` completo y la copia las proyecta (T1.F5, revisión de T1.5a, P-1).** Los validadores SQL de las opciones (la edición de T1.4c y las salidas de la IA de T1.4d/T1.4e) solo pedían que `graph` fuera un objeto: una opción con `graph: {"functions":[],"correctOptionId":"B","recipients":[...]}` entraba por RPC, se aprobaba y se publicaba. Ahora `app.is_graph_spec` replica `GraphSpec` de `lib/domain/assessments/versions.ts` (claves permitidas por nivel, tipos, límites, números finitos, largos contados como los cuenta zod, en unidades UTF-16) y devuelve siempre un booleano; `app.is_question_option` y `app.is_strict_option_list` lo usan, y lo que no cumple se rechaza (`INVALID invalid_options`) o se descarta (`discarded`). Además `publish_version` ya no copia `q.options`: `app.publication_content` proyecta cada opción a `id`, `text` y `graph` proyectado, de modo que una fila sembrada como dueño con claves de más tampoco llega al estudiante. Quien cambie `GraphSpec` en zod cambia `app.is_graph_spec` y `app.project_graph` en la misma migración.
- **La copia publicada se arma hoja por hoja con su tipo y un gráfico inválido bloquea la publicación (T1.F6, cierre de P-1).** `app.project_graph` ya no copia hojas con `->` / `#>` sin mirar el tipo: cada texto (`expr`, `label`) es un string dentro de su largo, cada número (`x`, `y`, límites de `window`) es finito, y una hoja de otro tipo no se copia (queda como `null`, que ningún `GraphSpec` acepta); nunca se copia un subárbol, y las listas fuera de límite no se recortan. `app.publication_content` valida cada gráfico proyectado con `app.is_graph_spec` y, si alguno no pasa (datos viejos sucios), publicar falla con `CONFLICT invalid_option_graph`: el profe tiene que abrir esa pregunta y volver a guardarla. No se publica nada recortado en silencio. Pruebas en `supabase/tests/020d_publish_fix6.test.sql`.
- **`aids.readAloud` es `true` en toda publicación (T1.F5, P-2).** Antes valía «el perfil incluye dislexia», una política pedagógica sin respaldo. La app muestra «Escuchar» a todo estudiante que no responde con la mirada, sin mirar su perfil (`components/solve/SolveAssessment.tsx`), y mostrarlo solo a algunos permitiría deducir el perfil, que el estudiante nunca ve. `aids` no depende de la configuración de la versión ni nombra perfiles. Si más adelante una elección docente apaga la lectura, es un cambio de contrato con su propio campo.
- **La primera publicación pasa el práctico a `published` (T1.F5, P-3).** `get_assessment` y `list_assessments` devolvían `draft` con una publicación e intentos en curso. El `CHECK` ya admitía `published`. Publicar de nuevo no cambia nada. La revisión del práctico no se mueve: protege los campos que edita una persona (tipo, tema, instrucciones) y publicar no toca ninguno. Un práctico archivado no se publica (`INVALID assessment_archived`) y no se reabre. Para no tomar el lock del práctico tarde, `publish_version` lo toma al principio (después del grupo `FOR SHARE`, antes de la versión) con `FOR NO KEY UPDATE`, que es el que toma cualquier `UPDATE` de `status`. No usa `FOR UPDATE` porque este choca también con el `FOR KEY SHARE` de cualquier inserción con FK al práctico y abriría un interbloqueo con quien ya tiene una asignación; contra el resto de las RPC (que toman el práctico `FOR SHARE` o `FOR UPDATE`) choca igual. El orden sigue siendo grupo, práctico, versión, asignaciones, intentos: dos publicaciones de versiones distintas del mismo práctico se ponen en fila en el práctico y ninguna toma un lock hacia arriba.
- **Los actores del historial no tienen FK.** En los eventos, las revisiones de la clave y las publicaciones, el id de quien actuó queda como dato histórico, como en `audit_log` (ver «Triggers»).

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
| `students` | `130200_groups_students` | T1.2b (`interface`: T1.3a) | `interface` (derivada del perfil) |
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
| `versions` | `130500_assessments_versions` | T1.4b (configuración), T1.4c (instrucciones) | `config`, `answer_mode` |
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
- `op_key` único por institución en `generations`, `operations`, `account_provisioning`, `import_runs`, `groups`, `assessments`, `assessment_exercises`, `versions` y `publications` (las cinco últimas desde T1.F3), y por autor en `student_notes` (T1.F2);
- una revisión de la clave por generación (`answer_key_revisions_generation_key`, T1.F3);
- una generación `running` por recurso y tipo;
- un solo evento `generated` por generación;
- `op_id` único por institución en `version_events` y `student_need_events`;
- una salida por generación, tipo y ejercicio;
- un intento vigente por asignación y una asignación por práctico y estudiante.

## RPC

Todas en el esquema `api`, `SECURITY DEFINER`, con `search_path = ''`, devuelven `jsonb` y hoy responden `UNAVAILABLE` con `not_implemented`. Los esquemas de entrada y salida están en `lib/domain/**/rpc*.ts`.

| RPC | Ticket |
|---|---|
| `internal_create_institution(p_name, p_code, p_kind, p_expires_at = null, p_owner_user_id = null)` | T1.2a |
| `internal_upsert_app_user(p_user_id, p_display_name = null)` | T1.2a |
| `internal_add_membership(p_institution_id, p_user_id, p_role)` | T1.2a |
| `internal_revoke_membership(p_membership_id)` | T1.2a |
| `list_my_institutions()` | T1.2a |
| `create_group(p_institution_id, p_name, p_subject_id, p_school_year, p_op_key)` | T1.2a, T1.F3 |
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
| `create_student_note(p_student_id, p_body, p_op_key)` | T1.3b, T1.F2 |
| `update_student_note(p_note_id, p_revision, p_body)` y `archive_student_note(p_note_id, p_revision)` | T1.3b |
| `list_student_consents(p_student_id)` (auditada) | T1.3b |
| `record_consent(p_student_id, p_purpose, p_text_version, p_valid_until = null, p_file_id = null)` | T1.3b |
| `revoke_consent(p_consent_id, p_revision)` | T1.3b |
| `create_assessment(p_group_id, p_kind, p_topic, p_general_instructions, p_op_key)` | T1.4a, T1.F3 |
| `update_assessment(p_assessment_id, p_revision, p_kind, p_topic, p_general_instructions)` | T1.4a |
| `archive_assessment(p_assessment_id, p_revision)` | T1.4a |
| `list_assessments(p_group_id, p_include_archived = false, p_limit = 50, p_offset = 0)` | T1.4a |
| `get_assessment(p_assessment_id)` | T1.4a |
| `add_exercise(p_assessment_id, p_label, p_body, p_op_key, p_topic_id = null)` | T1.4a, T1.F3 |
| `update_exercise(p_exercise_id, p_revision, p_label, p_body, p_topic_id = null)` | T1.4a |
| `remove_exercise(p_exercise_id, p_revision)` | T1.4a |
| `reorder_exercises(p_assessment_id, p_revision, p_exercise_ids)` | T1.4a |
| `create_version(p_assessment_id, p_config, p_answer_mode, p_op_key, p_base_version_id = null)` | T1.4b (firma de T1.F3) |
| `update_version_config(p_version_id, p_revision, p_config, p_answer_mode)` | T1.4b, T1.F4 (cambiar la configuración o el modo pasa a `superseded` las generaciones running de la versión, limpia `current_generation_id` y la procedencia, y marca `stale` también si hay instrucciones editadas) |
| `set_version_recipients(p_version_id, p_revision, p_student_ids, p_op_id)` | T1.4b |
| `archive_version(p_version_id, p_revision)` | T1.4b |
| `list_versions(p_assessment_id)` | T1.4b |
| `get_version(p_version_id)` (auditada; incluye instrucciones y claves de las preguntas con su revisión) | T1.4b |
| `update_version_instructions(p_version_id, p_revision, p_general_instructions, p_op_id)` (`p_revision` es `instructions_revision`) | T1.4c |
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
| `student_open_attempt(p_assignment_id)` | T1.5b |
| `student_start_attempt(p_attempt_id)` | T1.5b |
| `student_save_draft(p_attempt_id, p_revision, p_answers, p_choices)` | T1.5b |
| `student_submit_attempt(p_attempt_id, p_revision)` | T1.5b |
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

- `app.rpc_begin()` es la primera instrucción de toda RPC de `api`, justo después de `begin` (C18; `001_contract` falla si falta o si algo va antes). Rechaza correr si el modo supresión está puesto, en cualquier forma, y después llama a `app.lock_begin()`, que reinicia los marcadores de locks.
- `app.lock_version_tree(versión, generación, ejercicios)` toma la versión, después la generación y después los ejercicios ordenados por id. Si ya bloqueó ejercicios, no deja bloquear una generación. Solo un árbol de versión por RPC.
- `app.lock_versions(ids)` bloquea varias versiones por id («Aprobar todas», publicar), y después no deja bloquear el árbol de ninguna.
- `app.lock_assignments(ids)` va después de cualquier versión.
- `app.lock_attempt_tree(intento)` (C4) resuelve la asignación sin lock y bloquea asignación, intento y borrador, en ese orden. Lo usan empezar, guardar, entregar y corregir, así nunca toman el intento antes que la asignación, que es lo que toma publicar.
- Una violación levanta `P0004`: es un bug.

Edición con revisión (CAS), por ejemplo de un ejercicio adaptado. La idempotencia por `op_id` se comprueba bajo el lock (C5): dos copias del mismo pedido se ordenan en el lock y la segunda encuentra el evento de la primera.

```sql
perform app.rpc_begin();  -- primera línea de toda RPC: rechaza el modo supresión y reinicia los locks
-- Autorizar primero con una lectura sin lock: no se bloquea lo que el actor no puede ver.
select ve.version_id, a.group_id, a.institution_id into v_version_id, v_group_id, v_institution_id
  from app.version_exercises ve
  join app.assessments a on a.id = ve.assessment_id
 where ve.id = p_version_exercise_id;
if not found or not app.is_group_staff(v_group_id) then
  perform app.raise_error('NOT_FOUND', 'not_found');
end if;

perform app.lock_version_tree(v_version_id, null, array[p_version_exercise_id]);

-- Bajo el lock: ¿este op_id ya se aplicó? La identidad es la RPC y su destino concreto (esta
-- pregunta, este ejercicio, la versión). La misma: se devuelve el resultado que se guardó. Otra
-- (otra pregunta del mismo ejercicio, el ejercicio de esa pregunta): CONFLICT op_key_reused.
v_event := app.claim_version_op(v_institution_id, p_op_id, 'update_version_exercise', v_version_id, p_version_exercise_id);
if v_event.id is not null then
  return v_event.result;
end if;

select ve.revision into v_revision from app.version_exercises ve where ve.id = p_version_exercise_id;
perform app.assert_revision(p_revision, v_revision);  -- CONFLICT revision_mismatch

-- Una edición manual deja written_by_generation_id en nulo: ninguna salida pendiente la pisa.
-- Con texto el ejercicio queda ready; vacío vuelve a pending.
update app.version_exercises
   set body = p_body, revision = revision + 1, written_by_generation_id = null,
       status = case when btrim(p_body) <> '' then 'ready' else 'pending' end, error_code = null
 where id = p_version_exercise_id returning revision into v_revision;
-- Todo cambio de contenido sube la revisión de la versión: la aprobación anterior deja de valer.
update app.versions set revision = revision + 1 where id = v_version_id returning revision into v_version_revision;
-- El estado de la versión se recalcula siempre igual, venga el contenido de la IA o del profe (C19).
perform app.refresh_version_status(v_version_id);
update app.answer_keys set stale = true where version_id = v_version_id;
begin
  v_result := jsonb_build_object('id', p_version_exercise_id, 'revision', v_revision, 'versionRevision', v_version_revision);
  insert into app.version_events (institution_id, version_id, op_id, kind, operation, target_id, result,
                                  version_exercise_id, version_revision, exercise_revision, data, actor_user_id)
  values (v_institution_id, v_version_id, p_op_id, 'edited', 'update_version_exercise', p_version_exercise_id, v_result,
          p_version_exercise_id, v_version_revision, v_revision, jsonb_build_object('body', p_body), app.actor_id());
exception when unique_violation then
  -- El mismo op_id usado a la vez sobre otra versión (otro lock): el índice único es el respaldo.
  perform app.raise_error('CONFLICT', 'op_key_reused');
end;
return v_result;
```

La misma regla vale para `student_need_events` (bajo el lock de la fila del estudiante) y para todo `op_key` de `generations`, `operations`, `account_provisioning`, `import_runs` y las altas de «Idempotencia de las altas»: se busca bajo el lock del recurso, se compara la identidad (recurso y tipo de operación) y el índice único es el respaldo.

### Idempotencia de las altas (T1.F3)

Toda RPC que crea una fila que una persona puede disparar dos veces (doble clic, reintento después de un corte) tiene una identidad de operación, o una razón para no necesitarla. Inventario de las RPC de la fase 1 que insertan filas, implementadas o stubs:

| RPC | Inserta en | Antes de T1.F3 | Ahora |
|---|---|---|---|
| `internal_create_institution` | `institutions` | clave natural `code` | Excluida: interna; el mismo `code` con los mismos datos devuelve la misma, con otros es `op_key_reused`. |
| `internal_upsert_app_user` | `app_users` | clave natural (id de Auth) | Excluida: interna, upsert por id. |
| `internal_add_membership`, `internal_link_student_user` | `memberships` | clave natural (institución, usuario, rol vigente) | Excluidas: internas; repetir devuelve la membresía vigente. |
| `create_group` | `groups`, `group_staff` | nada | `p_op_key` (T1.F3). |
| `add_group_staff` | `group_staff` | clave natural (grupo, persona vigente) | Excluida: repetir con el mismo rol devuelve la misma fila. |
| `create_student` | `students`, `enrollments`, `student_pseudonyms`, `account_provisioning` | `op_key` (T1.2b) | Sin cambios. |
| `enroll_student` | `enrollments` | clave natural (una inscripción vigente por par) | Excluida: repetir devuelve la vigente. |
| `set_student_needs` | `student_needs`, `student_need_events` | `op_id` (T1.3a) | Sin cambios. |
| `create_student_note` | `student_notes` | `op_key` (T1.F2) | Sin cambios. |
| `record_consent` | `consents` | idempotente por contenido | Excluida: el consentimiento vigente con la misma finalidad, versión del texto, vencimiento y formulario se devuelve tal cual. |
| `create_assessment` | `assessments` | nada | `p_op_key` (T1.F3). |
| `add_exercise` | `assessment_exercises` | nada | `p_op_key` (T1.F3). |
| `create_version` (stub) | `versions`, `version_exercises` | nada | Firma con `p_op_key` y columnas (T1.F3); lo implementa T1.4b. |
| `set_version_recipients` (stub) | `version_recipients`, `version_events` | `op_id` | Sin cambios. |
| `update_version_instructions`, `update_version_exercise`, `update_version_question`, `approve_version`, `reject_version` (stubs) | `version_events` | `op_id` | Sin cambios. |
| `set_question_key` (stub) | `question_keys` | clave natural (una por pregunta) y revisión | Excluida: la segunda copia encuentra la clave; T1.4c responde lo mismo si la opción es la misma y `revision_mismatch` si no. |
| `internal_create_generation` (stub) | `generations` | `op_key` | Sin cambios. |
| `internal_record_generation_output` (stub) | `generation_outputs` | clave natural (generación, tipo, ejercicio) | Excluida: interna; un reintento devuelve la salida guardada. |
| `internal_finish_generation` (stub) | `version_events` | clave natural (un `generated` por generación, `op_id` = id de la generación) | Excluida: interna. |
| `edit_answer_key`, `confirm_answer_key` (stubs) | `answer_keys`, `answer_key_revisions` | revisión base (`p_base_revision_id`) | Excluidas: como toda edición con revisión, la segunda copia encuentra que su base ya no es la vigente y responde `CONFLICT`; nunca hay dos revisiones. |
| `internal_record_answer_key_revision` (stub) | `answer_key_revisions` | nada | Clave natural nueva: una revisión por generación (índice único, T1.F3); T1.4e devuelve la guardada en un reintento. |
| `publish_version` (stub) | `publications`, `assignments`, `assignment_attempts` | `p_op_key` sin dónde guardarlo | Columnas `op_key`, `op_identity` y `op_attempts` (T1.F3); lo implementa T1.5a. |
| `student_start_attempt` (stub) | `submissions` | clave natural (`attempt_id` único) | Excluida: si ya empezó, devuelve lo mismo. |
| `grade_attempt` (stub) | `grades` | clave natural (`attempt_id` único) y revisión (nula la primera vez) | Excluida: la segunda copia encuentra la nota; T1.5c responde lo mismo si es idéntica y `revision_mismatch` si no. |

Las demás RPC no insertan filas (ediciones, archivos, restauraciones y bajas con revisión, lecturas, `student_open_attempt` y `student_submit_attempt`, que solo cambian estado).

El protocolo, igual en todas las altas con `op_key`:

- La fila guarda `op_key` y `op_identity`: el sha256 del texto de un `jsonb_build_array` con el nombre de la RPC y lo que define el alta, tal como era al crearla (un arreglo JSON, así ningún separador hace chocar dos entradas). Nunca se reconstruye desde la fila, que se puede editar después. Un `CHECK` exige las dos o ninguna.
- `op_key` es único por institución (`<tabla>_op_key_key`). Reusarlo en otro recurso, o con otros datos, es `CONFLICT op_key_reused`; nunca una segunda fila.
- La RPC autoriza y valida primero. Después toma `pg_advisory_xact_lock` de (RPC, institución, `op_key`), antes de cualquier lock de fila y antes de buscar, y busca bajo ese lock. La misma identidad devuelve el resultado original (`{ id, revision: 1 }`, o lo que diga la RPC), aunque la fila se haya editado, archivado o sacado después. Recién si no existe toma los locks de fila, valida las referencias que pueden cambiar (la materia habilitada de `create_group`, la unidad del programa de `add_exercise`) y escribe: la repetición de un alta nunca depende de ellas (T1.F4).
- `app.op_key_frozen()` congela las dos columnas (`P0004`). En `assessments`, `assessment_exercises` y `versions` la identidad es un hash del texto tal como se creó, aunque después se edite: la supresión en curso de esa institución puede ponerlas en nulo juntas, sin mirar el contenido actual (ver «Seudónimos y supresiones»); `groups` nunca. `publications_guard` ya congela las de una publicación, también dentro de una supresión.
- La prueba de carrera, con dos conexiones, comprueba que la segunda copia espera en el lock (`advisory`) y responde lo mismo. Sin el lock la segunda no espera, no ve la fila sin confirmar, inserta y choca con el índice: `23505` crudo.

### Una salida de la IA (C3)

Una generación escribe en etapas: el texto del ejercicio, sus preguntas de mirada y las instrucciones. Cada etapa sube la revisión de lo que toca, así que comparar solo contra la revisión inicial haría que la segunda etapa encontrara obsoleta la primera. La procedencia lo resuelve:

- `version_exercises.written_by_generation_id` (y `versions.instructions_written_by` para las instrucciones) dice qué generación escribió la revisión actual; nulo si la escribió una persona. Una FK compuesta impide que apunte a una generación de otra versión.
- Una salida aplica si la generación sigue `running`, es la vigente de su recurso (`current_generation_id` de la versión o del ejercicio) y el destino tiene la revisión con la que arrancó la generación (`target_revision`, o `inputs.exerciseRevisions[id]` e `inputs.instructionsRevision` en una generación de versión) o una posterior que escribió esa misma generación.
- Una edición manual pone la procedencia en nulo: cualquier salida posterior de esa generación queda `obsolete`. La persona gana siempre.
- Un reintento del mismo trabajo encuentra la salida única por generación, tipo y ejercicio y devuelve el resultado ya guardado, sin aplicarlo dos veces.

```sql
perform app.rpc_begin();  -- primera línea de toda RPC: rechaza el modo supresión y reinicia los locks
select g.version_id into v_version_id from app.generations g where g.id = p_generation_id;  -- sin lock
perform app.lock_version_tree(v_version_id, p_generation_id, array_remove(array[p_version_exercise_id], null));
-- Reintento: la salida ya está, se devuelve lo que se decidió entonces.
select o.id, o.outcome into v_existing from app.generation_outputs o
 where o.generation_id = p_generation_id and o.kind = p_kind
   and o.version_exercise_id is not distinct from p_version_exercise_id;
if found then
  return jsonb_build_object('outputId', v_existing.id, 'outcome', v_existing.outcome);
end if;
-- Releer con lock.
v_in_force := <la generación sigue running y es la current_generation_id del recurso>;
v_fresh := <revisión del destino = la de arranque> or <written_by_generation_id = p_generation_id>;
v_outcome := case when v_in_force and v_fresh then 'applied' else 'obsolete' end;
insert into app.generation_outputs (..., outcome) values (..., v_outcome);
if v_outcome = 'applied' then
  update app.version_exercises
     set body = ..., changes = ..., status = 'ready', revision = revision + 1,
         written_by_generation_id = p_generation_id
   where id = p_version_exercise_id;
  update app.versions set revision = revision + 1 where id = v_version_id;
end if;
```

El estado de la versión (C19) nunca se pone a mano: toda RPC que cambia el contenido de una versión o sus generaciones llama, bajo el lock, a `app.refresh_version_status(versión)`. Da `generating` si corre una generación de versión o de ejercicio, `error` si algún ejercicio está en error, `ready` si tiene ejercicios y todos están `ready` con texto, y `empty` en otro caso. Así una versión escrita a mano, sin ninguna generación, llega a `ready` y se puede aprobar.

Crear una generación nueva bloquea la versión, pasa a `superseded` las generaciones `running` que reemplaza (las filas de `generations`, antes que cualquier ejercicio) y recién después bloquea los ejercicios. Guarda en `inputs` las revisiones de arranque de cada ejercicio, pregunta e instrucciones. Cerrar una generación (`internal_finish_generation`) toma versión y generación, no hace nada si ya no está `running` y, si termina `done` y sigue vigente, pasa la versión a `ready` y escribe el único evento `generated` con `op_id` igual al id de la generación.

## Intentos y entrega

Estados: `opened`, `started` y `submitted`. Solo avanzan. Un intento reemplazado guarda `superseded_at` y sigue existiendo, con sus respuestas. Lo que se puede hacer en cada momento está en `lib/domain/delivery/attempt-rules.ts` (C13): empezar es un paso propio; un intento `opened` se lee y se empieza, y solo uno `started` tiene borrador para guardar y entregar. La prueba cruza cada estado con cada momento (antes de `publish_at`, en fecha, vencido, retirado y reemplazado), y las RPC aplican la misma tabla.

Publicar (`publish_version`, T1.5a), en una transacción:

- toma, en este orden, el grupo y el práctico (`FOR NO KEY UPDATE`, ver «Decisiones que cambian el spec», T1.F5) y el árbol de la versión;
- exige `approved_revision = revision = p_revision`;
- exige el contenido completo (C17): la versión en `ready` y cada ejercicio adaptado en `ready` con texto; si no, `CONFLICT content_incomplete`. Aprobar exige lo mismo, así no se aprueba una versión a medio hacer;
- en mirada, exige preguntas y una revisión de la clave que corresponda (ver «Clave»); en escritura y dictado la clave es opcional;
- exige que cada destinatario esté inscripto y tenga el consentimiento `ai_adaptation` vigente, si la versión tiene una generación;
- copia la revisión a `publications`: las instrucciones de la versión, los ejercicios y las preguntas, sin la opción correcta, sin `changes` y con `answer_mode` y `aids` (`readAloud` siempre `true`). Las opciones se copian por una proyección cerrada (`id`, `text` y `graph` con sus claves permitidas), nunca el `jsonb` guardado;
- si es la primera publicación, pasa el práctico a `published` (la revisión del práctico no se mueve);
- crea las asignaciones que falten y las bloquea por id;
- por asignación: sin intento crea el 1 en `opened`; con uno `opened` lo pasa a la publicación nueva, con su clave; con uno empezado o entregado no lo toca.

Un intento usa siempre la revisión de la clave de su publicación (C8): lo exige `app.attempts_key_matches` al crearlo y en cada cambio, y la guardia lo congela con la publicación desde que empieza.

Las RPC de un intento resuelven ids sin lock y después llaman a `app.lock_attempt_tree`, que bloquea asignación, intento y borrador en ese orden (C4). Publicar bloquea las asignaciones antes de tocar sus intentos. Así no se cruzan.

Abrir (`student_open_attempt`): el estudiante ve su intento vigente si la tabla lo deja leer, y la primera vez se guarda `first_viewed_at`. No toma locks de escritura más allá de esa marca.

Empezar (`student_start_attempt`): pasa `opened` a `started` y crea la fila de `submissions` con revisión 1. Si ya empezó, devuelve lo mismo.

Guardar (`student_save_draft`): exige `started` y que la tabla deje guardar; valida que cada id de ejercicio y de pregunta sea de la publicación del intento; compara `p_revision` con la del borrador (`CONFLICT revision_mismatch`) y la sube.

Entregar (`student_submit_attempt`), lo que pide R3-4:

```sql
perform app.rpc_begin();  -- primera línea de toda RPC: rechaza el modo supresión y reinicia los locks
-- Autorizar sin lock: el intento es del estudiante que llama.
select t.assignment_id into v_assignment_id from app.assignment_attempts t
  join app.assignments a on a.id = t.assignment_id
 where t.id = p_attempt_id and app.is_student_self(a.student_id);
if not found then perform app.raise_error('NOT_FOUND', 'not_found'); end if;

perform app.lock_attempt_tree(p_attempt_id);  -- asignación -> intento -> borrador

select ... into t from app.assignment_attempts where id = p_attempt_id;  -- releer bajo lock
if t.status = 'submitted' then
  return jsonb_build_object('submittedAt', t.submitted_at, 'late', t.late, 'alreadySubmitted', true);
end if;
if t.status <> 'started' then perform app.raise_error('CONFLICT', 'attempt_not_started'); end if;
<la tabla deja entregar: no retirada, no reemplazado, después de publish_at>
select s.revision into v_draft from app.submissions s where s.attempt_id = p_attempt_id;
if v_draft <> p_revision then perform app.raise_error('CONFLICT', 'draft_outdated'); end if;
update app.submissions set submitted_at = now() where attempt_id = p_attempt_id;
update app.assignment_attempts set status = 'submitted', submitted_at = now(), late = <now() > due_at>,
       revision = revision + 1 where id = p_attempt_id;
update app.assignments set status = 'submitted', revision = revision + 1 where id = v_assignment_id;
```

- El segundo clic espera el lock, encuentra `submitted` y no cambia nada.
- Si otra pestaña guardó algo más nuevo, la respuesta es `draft_outdated` y la pantalla muestra lo último antes de entregar.
- Después de entregar, el trigger de `submissions` rechaza cualquier cambio con `CONFLICT already_submitted`.
- Corregir (`grade_attempt`, T1.5c) se puede desde que hay entrega, también en una publicación retirada o un intento reemplazado. Toma `app.lock_attempt_tree` y después la fila de `grades`.

## Clave

Lo que pide R3-3, con C1:

- `answer_key_revisions` es solo agregar. Cada revisión guarda su contenido, `version_revision`, `exercise_revisions` (`{ id del ejercicio adaptado: revisión }`), `question_revisions` (`{ id de la pregunta: revisión }`) e `instructions_revision`: las instrucciones también cambian qué es una respuesta correcta («expresalo en metros»).
- Editar una pregunta, sus opciones o su opción correcta (`question_keys`) sube la revisión de la pregunta, la de su ejercicio y la de la versión. Intercambiar las opciones A y B, aunque los ids queden iguales, ya cambia la revisión.
- Una revisión R corresponde a la versión V si `R.exercise_revisions` es igual al mapa de revisiones de los ejercicios de V de hoy, `R.question_revisions` es igual al de sus preguntas de hoy y `R.instructions_revision` es la de V de hoy (C1). Vale igual para claves generadas, editadas y confirmadas. `version_revision` queda para trazar, no para comparar: cambiar destinatarios sube la revisión de la versión pero no toca la clave. T1.4e escribe esa comparación como `app.answer_key_matches(revisión, versión)`.
- Una clave generada (`internal_record_answer_key_revision`) guarda el snapshot de las entradas de su generación (incluida `inputs.instructionsRevision`), no el de hoy. Se vuelve la actual solo si la generación sigue vigente y ese snapshot todavía corresponde; si no, queda guardada como `obsolete`, visible para el profe.
- Editar (`edit_answer_key`) guarda el contenido que manda el profe con las revisiones de hoy. Confirmar (`confirm_answer_key`) crea una revisión nueva con el contenido de la base, las opciones correctas de `question_keys` de hoy y las revisiones de hoy; en mirada exige una opción para cada pregunta. Los dos mandan la revisión de la que partieron (`p_base_revision_id`); si no es la vigente, `CONFLICT`.
- `answer_keys.stale` lo prende toda edición de un ejercicio, una pregunta, una opción correcta o las instrucciones (T1.4c). Publicar no confía en el flag: compara.
- Cada intento apunta a la revisión de la clave de su publicación, y no cambia (C8).
- Opciones y clave válidas (C15): cada pregunta tiene de 2 a 4 opciones con ids de una letra sin repetir (`app.is_option_list`, CHECK), y la opción correcta es siempre una de ellas. Las RPC lo comprueban antes de escribir: `set_question_key` con una opción que no existe da `INVALID unknown_option`; `update_version_question` que saca la opción correcta da `INVALID correct_option_removed` (primero se cambia la correcta). Dos triggers son el respaldo.
- Editar la opción correcta con su revisión (C14): `get_version`, la lectura auditada de la revisión del profe, devuelve `keys` con cada `QuestionKey` (pregunta, opción correcta y revisión). Es lo que `set_question_key` necesita después de recargar. Nunca llega a un estudiante.

## Seudónimos y supresiones

Lo que pide R3-7, y lo que el esquema garantiza:

- El seudónimo es el id de su fila en `student_pseudonyms`. `feedback_events` y `group_analyses` usan el seudónimo, no el id del estudiante. A la IA no le llega ninguno de los dos: el análisis usa etiquetas (E1, E2) y el mapa queda en `group_analyses.pseudonym_map`.
- Un estudiante con su seudónimo vinculado no se puede borrar: la FK no tiene `ON DELETE`. Primero se desvincula (`student_id` nulo y `unlinked_at`).
- Una cuenta que no está marcada `deleted` tampoco deja borrar al estudiante, y la marca sobrevive a la fila del estudiante. Así `reconcile_accounts` nunca recrea la cuenta.
- Los archivos frenan el borrado de su dueño: primero se borran los objetos de Storage y después las filas.
- `erasures` guarda solo el seudónimo, ya desvinculado, y fechas. Se marca antes de borrar nada. Se copia afuera de la base en la misma acción (`external_copied_at`).
- Borrar la cuenta de un profe no reescribe el historial: los actores son ids sin FK (ver «Triggers»).

Qué pasa con cada tabla (C9): `lib/domain/permissions/erasure.ts` da una regla y su porqué a cada tabla con datos de un estudiante, también los derivados de su perfil (ejercicios adaptados, preguntas, claves, salidas de la IA, operaciones y el original si lo nombra). Las reglas son `delete`, `unlink`, `redact`, `keep` y `by_version`. Una versión es individual si en toda su historia solo la recibió él: todas sus filas de `version_recipients` y todos los intentos sobre sus publicaciones son suyos. Esa se borra con todo lo que cuelga de ella, y ninguna entrega de otro estudiante se va con ella. Cualquier otra es compartida: se conserva sin él como destinatario y se redacta el texto libre que lo nombre. T1.9 la desarrolla campo por campo en el inventario y su prueba comprueba que coinciden. T9.5 la ejecuta.

Cómo se redacta lo inmutable (C9). Las filas de una versión compartida (eventos, salidas de la IA, revisiones de la clave, la publicación y las entradas de la generación) rechazan `UPDATE`. La supresión no las esquiva: abre un modo propio.

- `app.begin_erasure(<supresión>)` abre, solo para la transacción, el modo supresión. Exige que la fila de `erasures` exista en `marked`: la marca va siempre primero. Lo ata a esa supresión, a su institución y al id de la transacción (`txid_current()`), así una marca copiada a otra transacción no abre nada (C18). La marca da vínculo con la transacción, no autenticidad: SQL con privilegios de dueño podría fabricarla. Contra los usuarios de la API protegen los privilegios cerrados: no pueden ejecutar funciones de `app` ni llegar a SQL directo.
- Con el modo abierto, `app.redaction_allowed` deja cambiar solo los campos redactables de cada tabla, y solo en filas de la institución de la supresión: `version_events.data` y `.result`, `generation_outputs.output`, `answer_key_revisions.content`, `publications.content` y `generations.inputs`. `audit_log` nunca. Cualquier otro cambio sigue rechazado: una generación terminada no se reabre y un evento no cambia de tipo.
- Mientras el modo está abierto no corre ninguna RPC: `app.rpc_begin()` las rechaza. La RPC interna de supresión llama a `rpc_begin` primero y abre el modo después.
- El modo se cierra con la transacción, y pasar la supresión a `done` lo cierra aunque la transacción siga.
- Solo lo llama la RPC interna de supresión (T9.5, `service_role`). Ningún usuario puede fijar la marca de la transacción, y nadie tiene `EXECUTE` sobre las funciones de `app`.
- `004_contract_redaction` lo prueba: fuera del modo no se reescribe nada; dentro, el evento compartido pierde al estudiante borrado y conserva al otro; una publicación solo cambia su contenido; un evento no cambia de tipo; `audit_log` no se toca; otra institución queda afuera; una RPC llamada como `authenticated` se niega a correr; `authenticated` no puede abrir el modo; una marca con otra transacción no abre nada; con la supresión terminada se vuelve a cerrar.

La identidad de una alta (T1.F4). `op_key` y `op_identity` de `assessments`, `assessment_exercises` y `versions` son un hash del texto tal como se creó («Para Paula» editado a «Repaso» conserva el hash de «Para Paula»): con SHA256 se comprueban nombres candidatos. Regla: al suprimir a un estudiante se ponen en nulo `op_key` y `op_identity` de todos los prácticos, ejercicios y versiones de los grupos donde estuvo inscripto alguna vez, y de las versiones de las que fue destinatario, sin mirar el contenido actual. T9.5 lo hace dentro de `app.begin_erasure`, antes de borrar las inscripciones (son lo que dice en qué grupos estuvo), y `app.op_key_frozen` lo deja solo ahí. `groups` conserva la suya: el nombre del grupo no es de una persona. Las pruebas 015 y 016 recorren crear, editar y suprimir.

En una versión compartida, T9.5 redacta además `data.recipients` de los eventos `recipients_changed`, no solo `added` y `removed`: la lista de destinatarios nombra (por id) al estudiante suprimido.

Orden de una supresión (T9.5), para que lo que queda nunca sea personal:

- se marca (`erasures` en `marked`) y se desvincula el seudónimo;
- se borran los objetos de Storage del estudiante y después las filas según las reglas, con las redacciones dentro de `app.begin_erasure`;
- se borra la cuenta de Auth con la API de administración: eso borra en cascada `app_users` y `memberships`, y deja `account_provisioning.auth_user_id` apuntando a ninguna cuenta;
- recién entonces la supresión pasa a `done` y se copia afuera de la base.

Las reglas cubren también `app_users` y `memberships` (se borran, en ese paso), `assessments` (tema e instrucciones del profe: se redactan si lo nombran) y `presets` (nombre y configuración, texto libre del profe: se redactan si lo nombran). En `version_events` se redactan `data` y `result`; además, el `result` de `set_version_recipients` es solo `{ id, revision }` de la versión y nunca lleva ids de estudiantes.

Lo que no garantiza:

- Desvincular no anonimiza. El texto libre, las fechas y las combinaciones raras pueden identificar. Lo que queda atado a un seudónimo desvinculado es dato personal salvo que el inventario diga, campo por campo, que se borró o se redactó. Por eso `feedback_events` se borra.
- `audit_log` guarda ids de estudiantes que, después de la supresión, ya no se resuelven a nadie. El registro de accesos se conserva por su plazo de retención; el inventario lo justifica.
- Los respaldos conservan los datos hasta que vencen (30 días). Al restaurar se vuelven a aplicar las supresiones del registro externo.

## Prueba de fugas (C10)

Decisión (cambia el spec, ver «Decisiones que cambian el spec»): la prueba automática de fugas garantiza solo lo estructural y demostrable. Si un texto libre aprobado por el profe dice la solución es una cuestión de contenido, y se trata con un aviso, no con la prueba. Perseguir frases («la respuesta correcta es la A», «**A**», «1/2») no tiene fin y da falsos positivos.

Lo que la prueba garantiza, y con qué:

- La estructura: cada DTO valida contra su esquema estricto (`checkStudentDto`), así un campo que falta o sobra falla.
- Ningún campo puede llevar la clave, la rúbrica ni una respuesta esperada: no existe un campo así en la lista de claves permitidas, y una clave fuera de la lista es fuga.
- Un id prohibido (otro estudiante, un seudónimo, un perfil, una clave, una versión no asignada) no aparece en ningún lado: ni como valor, ni como clave, ni metido en un texto («Referencia: <id>»), tampoco en lo que escribió el estudiante (`forbiddenIds`).
- Ninguna palabra de perfil (`PROFILE_WORDS`, sin importar mayúsculas ni tildes) aparece en texto que escribió el servidor. Lo que escribió el estudiante (`ownContent`) queda exento solo de esta búsqueda.
- La opción correcta no aparece en ningún campo de id fuera de la lista de opciones (`questions.*.options.*.id`) y de la elección propia del estudiante (`draft.choices.*`) (`correctOptionIds`).
- Las RPC del estudiante nunca leen la clave ni los perfiles. La garantía es el rol `tiza_student` y sus privilegios (ver «El rol del estudiante»), que Postgres hace cumplir por cualquier camino. Además, como señal rápida, `001_contract` calcula, con un CTE recursivo, el cierre de llamadas de cada RPC `student_*` (toda función de `app` o `api` que su cuerpo nombra, a cualquier profundidad) y falla si alguna nombra `question_keys`, `answer_keys` o `answer_key_revisions`, o usa SQL dinámico (`EXECUTE`, `format(`), que ningún chequeo estático puede seguir. La misma prueba crea una cadena de dos saltos y una RPC con SQL dinámico, y comprueba que el chequeo las atrapa.

El aviso, aparte (`lib/domain/delivery/reveal.ts`):

- `revealsSolution(texto, soluciones)` y `revealWarnings(textos, soluciones)` detectan un texto que parece decir la solución: una palabra que la anuncia (correcta, respuesta, solución, clave, pista), un «correcta» opcional, un separador («:», «=», «es», «era»), un artículo opcional («la», «el», «opción») y el valor. Ignora el énfasis de Markdown («**A**») y no toma parte de un número como el valor («1» en «1/2» o «1,5»).
- Mira todo texto que va a leer el estudiante: títulos, instrucciones, enunciados, etiquetas y textos de opciones. Nunca las respuestas del propio estudiante.
- Devuelve avisos, nunca fugas, y nunca bloquea. Cada texto libre lo aprueba un profe antes de publicar, y los prompts de generación prohíben decir las respuestas. El servicio que aprueba (T4.3) y el que publica (T4.7) corren `revealWarnings` sobre los textos de `get_version` con las soluciones de `get_answer_key`, y le muestran al profe los avisos junto con el resultado. Las RPC de T1.4c y T1.5a no cambian por esto: solo garantizan que esas lecturas traen todo lo que el aviso necesita.

La prueba de T1.5d usa `checkStudentDto` sobre los cuatro DTO, con dos estudiantes de perfiles distintos en el mismo grupo: los ids del otro estudiante, los seudónimos y los ids de versión como `forbiddenIds`; `PROFILE_WORDS` como palabras; y las opciones correctas como `correctOptionIds`.

## Matriz de permisos

`lib/domain/permissions/matrix.ts` tiene una fila por RPC y una columna por rol, con la fase desde la que rige y el ticket. Lo que no está permitido se niega. Las decisiones que no estaban en el spec:

- El admin administra la institución: grupos, staff, estudiantes y consentimientos. No lee perfiles, notas, prácticos ni entregas de grupos donde no es staff. Es lo mínimo para datos de salud. Si también enseña, entra como profe del grupo.
- Inclusión lee y edita perfiles de toda la institución, y lee grupos, estudiantes y consentimientos. Nunca notas, prácticos ni entregas.
- Admin e inclusión leen grupos sin enseñar en ellos: en `GroupSummary` y `GroupDetail`, `myRole` es nulo para ellos (C6).
- El visitante del sandbox es profe dentro de su sandbox, menos lo que tiene efectos reales: no suma staff y `create_student` no crea cuenta real.
- El estudiante solo actúa sobre lo suyo (`own`).
- Sin sesión, todo se niega. Las RPC `internal_*` se niegan a todos los roles de usuario.

## Tickets de la fase 1

Tandas. Cada tanda tiene a lo sumo un ticket con migraciones (turno de base). Los tickets de base van en fila; los de repos corren al lado, sobre lo ya mergeado. Ningún ticket depende de otro de su misma tanda (C11).

| Tanda | Turno de base | En paralelo |
|---|---|---|
| 1 | T1.2a | T1.9 |
| 2 | T1.2b | T1.6a |
| 3 | T1.3a | T1.6b |
| 4 | T1.3b | |
| 5 | T1.4a | T1.6c |
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

- Una migración nueva con el nombre de su ticket, que reemplaza los stubs de `api` con `CREATE OR REPLACE FUNCTION`, misma firma, y concede `EXECUTE` como dice «Nombres». Se aplica con `supabase migration up`, nunca con `db reset`.
- Toda RPC empieza con `perform app.rpc_begin();` y sigue «Errores», «Quién llama» y «Orden de locks y revisión». La idempotencia por `op_id` u `op_key` se comprueba bajo el lock, con su identidad.
- Toda RPC auditada llama a `app.audit_disclosure` una vez por pedido, con el conjunto de estudiantes que muestra.
- pgTAP por RPC: el caso feliz; cada rol de la matriz que la niega; un usuario de otra institución; la revisión vieja (`CONFLICT`); el `op_key` o `op_id` repetido sobre el mismo recurso (devuelve lo mismo) y sobre otro (`CONFLICT op_key_reused`); y la fila de `audit_log` donde corresponde. Los usuarios se simulan con `set_config('request.jwt.claims', ...)` y `set local role authenticated` para probar el privilegio.
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
    con EXECUTE solo para service_role.
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
    esquema. Admin e inclusión ven los grupos de la institución con myRole nulo; un profe, los suyos con su rol.
Pruebas obligatorias: 011_students.test.sql con las reglas comunes; las proyecciones no tienen ninguna clave
  fuera de su esquema; un admin y un integrante de inclusión leen un grupo con myRole nulo.
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
  - set_student_needs crea o edita con revisión bajo el lock del estudiante, rechaza perfiles y apoyos fuera del
    catálogo (unknown_profile, unknown_support) y escribe student_need_events con op_id, comprobado bajo el lock.
  - get_student_needs, get_group_needs y list_student_need_events escriben una fila de audit_log por pedido,
    con el conjunto de estudiantes sin repetir; ninguna fila si no mostró a nadie.
  - Inclusión lee y edita perfiles de toda la institución; el admin no.
  - set_student_needs mantiene students.interface: gaze si el perfil incluye motor, voice si incluye
    dysgraphia, standard si no. Es lo que lee student_home, que no puede leer student_needs.
Pruebas obligatorias: 012_needs.test.sql con las reglas comunes. 013_reconstruction.test.sql: como profe del
  grupo, llama a todas las RPC no auditadas que existan y comprueba que ninguna respuesta contiene un perfil, un
  apoyo, un interés, la configuración de una versión ni sus destinatarios. Cada ticket posterior que agrega una
  lectura no auditada para el staff suma su llamada a esta prueba. Las lecturas del estudiante (student_*) no
  van acá: un profe no puede llamarlas, y las cubren 023_student_dto y la prueba de fugas (C22).
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
  - Editar o sacar un ejercicio, o cambiar las instrucciones generales, marca stale las versiones afectadas,
    tomando los locks en orden. Nunca cambia el texto de una versión.
  - list_assessments y get_assessment solo para staff del grupo.
Pruebas obligatorias: 015_assessments.test.sql con las reglas comunes; cambiar las instrucciones marca stale
  las versiones y deja intacta su copia.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: leer un documento (T3.4), publicar fechas (T8.1).
Dependencias nuevas: ninguna.
```

```
T1.4b · Versiones, configuración y destinatarios
Agente: backend          Tanda: 6        Depende de: T1.4a, T1.3a
Turno de base: sí
Objetivo: versiones con su configuración, sus instrucciones y sus destinatarios en el tiempo, leídas por RPC
  auditada.
Archivos que puede crear o cambiar: supabase/migrations/20261112150000_t1_4b_versions.sql,
  supabase/tests/016_versions.test.sql, supabase/tests/013_reconstruction.test.sql (sumar list_versions).
Contratos que usa (solo lectura): lib/domain/assessments/versions.ts, lib/domain/assessments/rpc-versions.ts.
Criterios de aceptación:
  - create_version asigna la posición siguiente, copia las instrucciones generales del práctico y crea un
    version_exercise pending por cada ejercicio conservado (config.keep, o todos). Toma la fila del práctico
    antes de copiar ejercicios (si no, una versión hecha en el medio no recibe la marca stale).
  - create_version(p_assessment_id, p_config, p_answer_mode, p_op_key, p_base_version_id) es idempotente
    según «Idempotencia de las altas» (T1.F3): op_identity es el sha256 de jsonb_build_array('create_version',
    práctico, config, answer_mode, versión base), guardado en versions.op_key y versions.op_identity en el
    mismo insert; la repetición responde { id, revision: 1, position } de la versión creada; p_op_key nulo es
    INVALID invalid_op_key. La guardia de versions que escriba congela position.
  - set_version_recipients cierra las filas vigentes (valid_to) y abre las nuevas, sube la revisión, escribe
    recipients_changed con op_id (bajo el lock) y exige, con un trigger, que cada destinatario esté inscripto.
    Quién se sumó o salió va solo en data; el result que se guarda es { id, revision } de la versión.
  - list_versions no devuelve config, answer_mode ni destinatarios. get_version es auditada con los
    destinatarios que muestra, e incluye las instrucciones de la versión.
Pruebas obligatorias: 016_versions.test.sql con las reglas comunes; un estudiante no inscripto como
  destinatario falla; un estudiante con dos versiones del mismo práctico falla.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: vista previa (T7.2), generar (T1.4d y T5.1).
Dependencias nuevas: ninguna.
```

```
T1.4c · Contenido de la versión y aprobación
Agente: backend          Tanda: 7        Depende de: T1.4b, T1.6a
Turno de base: sí
Objetivo: editar instrucciones, ejercicios adaptados y preguntas, y aprobar o rechazar una revisión concreta.
Archivos que puede crear o cambiar: supabase/migrations/20261112160000_t1_4c_version_content.sql,
  supabase/tests/017_version_content.test.sql, tests/integration/version-ops-concurrency.test.ts.
Contratos que usa (solo lectura): lib/domain/assessments/rpc-versions.ts, 20261111130900_lock_order.sql,
  app.claim_version_op, tests/factories/**.
Criterios de aceptación:
  - Cada edición sigue el protocolo CAS de este documento: lock_version_tree, claim_version_op bajo el lock,
    revisión, procedencia en nulo, revisión de la versión, answer_keys.stale y evento edited.
  - update_version_instructions con instructions_revision.
  - update_version_question y set_question_key suben la revisión de la pregunta, la de su ejercicio y la de la
    versión; la opción correcta tiene que existir (unknown_option) y no se puede sacar con una edición
    (correct_option_removed).
  - set_question_key sin clave previa (p_revision nulo) repetido con la misma opción responde lo mismo; con
    otra, revision_mismatch (no lleva op_key: ver «Idempotencia de las altas»).
  - claim_version_op con la RPC y el destino concreto (la pregunta, el ejercicio o la versión); el evento guarda
    operation, target_id y el resultado, que se devuelve tal cual en una repetición.
  - Una edición manual con texto pasa el ejercicio a ready (vacía, a pending), y toda edición termina con
    app.refresh_version_status.
  - approve_version exige p_revision = revision y el contenido completo (content_incomplete), y deja
    approved_revision; cualquier cambio posterior la deja atrás. reject_version escribe rejected con sus motivos.
  - Un texto que parece decir la solución no bloquea la aprobación: es un aviso que calcula el servicio (T4.3)
    con revealWarnings sobre get_version y get_answer_key (ver «Prueba de fugas»).
  - get_version devuelve keys (QuestionKey con su revisión).
Pruebas obligatorias: 017_version_content.test.sql con las reglas comunes; aprobar una revisión vieja es
  CONFLICT; editar instrucciones, un ejercicio, una opción o la opción correcta después de aprobar deja la
  versión sin aprobar. En integración, con dos clientes a la vez: dos copias de la misma edición aplican una vez
  y la segunda devuelve el mismo resultado; el mismo op_id sobre dos ejercicios distintos, sobre dos preguntas
  del mismo ejercicio o sobre una pregunta y su ejercicio da CONFLICT en uno. En pgTAP: opciones repetidas y una
  opción correcta inexistente se rechazan; aprobar una versión con un ejercicio pending es content_incomplete;
  una versión typed sin ninguna generación, completada a mano ejercicio por ejercicio, queda ready y se aprueba.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: regenerar un ejercicio (T7.4), checklist (T7.5).
Dependencias nuevas: ninguna.
```

```
T1.4d · Generaciones (internas)
Agente: backend          Tanda: 8        Depende de: T1.4c, T1.6a
Turno de base: sí
Objetivo: crear, completar y cerrar generaciones con vigencia por recurso y procedencia por etapa, sin que un
  resultado tardío pise nada.
Archivos que puede crear o cambiar: supabase/migrations/20261112170000_t1_4d_generations.sql,
  supabase/tests/018_generations.test.sql, tests/integration/generations-concurrency.test.ts.
Contratos que usa (solo lectura): lib/domain/assessments/generations.ts, lib/domain/assessments/rpc-generations.ts,
  «Vigencia» del spec, «Una salida de la IA» de este documento, tests/factories/**.
Criterios de aceptación:
  - internal_create_generation es idempotente por op_key (created false), comprobado bajo el lock; reemplaza las
    generaciones vigentes según «Vigencia» y guarda en inputs las revisiones de arranque.
  - internal_record_generation_output guarda siempre la salida y la aplica según «Una salida de la IA»
    (vigencia, revisión de arranque o procedencia propia), para exercise, gaze_questions e instructions.
  - internal_finish_generation cierra una sola vez y escribe un único evento generated.
  - Solo service_role.
Pruebas obligatorias: 018_generations.test.sql: texto y después preguntas, y preguntas y después texto, aplican
  los dos; cada uno repetido devuelve el resultado guardado sin aplicar dos veces; una edición manual entre los
  dos deja obsoleto el segundo. En integración, con dos clientes a la vez: los dos últimos ejercicios que
  terminan juntos (un solo generated), una salida que llega después de cerrar (obsolete), una edición manual que
  gana a una salida y dos regeneraciones de ejercicios distintos.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: trabajos y presupuesto (fase 3), request_generation (T5.1).
Dependencias nuevas: ninguna.
```

```
T1.4e · Clave de respuestas
Agente: backend          Tanda: 9        Depende de: T1.4d
Turno de base: sí
Objetivo: revisiones inmutables de la clave, con su correspondencia a ejercicios y preguntas.
Archivos que puede crear o cambiar: supabase/migrations/20261112180000_t1_4e_answer_keys.sql,
  supabase/tests/019_answer_keys.test.sql, supabase/tests/013_reconstruction.test.sql (sumar get_answer_key:
  no es auditada, y su respuesta no puede traer perfiles ni destinatarios).
Contratos que usa (solo lectura): sección «Clave» de este documento, lib/domain/assessments/rpc-generations.ts.
Criterios de aceptación:
  - app.answer_key_matches(revisión, versión) compara exercise_revisions, question_revisions e
    instructions_revision con los de hoy.
  - edit y confirm agregan una revisión numerada con las revisiones de hoy; CAS con p_base_revision_id.
    confirm toma las opciones correctas de question_keys y en mirada exige una para cada pregunta.
  - internal_record_answer_key_revision guarda el snapshot de las entradas de su generación y solo la vuelve
    actual si la generación sigue vigente y el snapshot corresponde. Una revisión por generación
    (answer_key_revisions_generation_key, T1.F3): un reintento del mismo trabajo devuelve la guardada.
  - get_answer_key solo staff del grupo; nunca un estudiante.
Pruebas obligatorias: 019_answer_keys.test.sql con las reglas comunes; intercambiar dos opciones o cambiar la
  correcta, o cambiar las instrucciones, deja la clave sin corresponder hasta confirmarla; una clave generada
  que llega después de una edición
  queda obsolete y no es la actual; una revisión no se puede modificar.
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
Criterios de aceptación: los puntos de «Publicar», cada uno con su error (not_approved, content_incomplete,
  missing_questions, stale_answer_key, missing_consent, not_enrolled); el op_key repetido devuelve la misma
  publicación según «Idempotencia de las altas» (T1.F3): op_identity es el sha256 de
  jsonb_build_array('publish_version', versión, p_revision, p_answer_key_revision_id), y publications guarda
  op_key, op_identity y op_attempts (los intentos que creó o movió) en el mismo insert, para repetir
  { publicationId, attempts } tal cual aunque una publicación posterior mueva esos intentos; la copia
  lleva las instrucciones de la versión y no lleva opción correcta, changes ni config; los avisos de
  revealWarnings no bloquean la publicación (los muestra el servicio, T4.7); cada intento lleva la
  revisión de la clave de su publicación.
Pruebas obligatorias: 020_publish.test.sql con las reglas comunes; volver a publicar mueve solo intentos sin
  empezar, con la clave nueva; crear una versión typed, asignarle un destinatario y publicarla con ejercicios
  pending se rechaza con content_incomplete; cambiar las instrucciones después de aprobar la clave obliga a
  confirmarla.
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: fechas, retirar y reasignar (T8.1).
Dependencias nuevas: ninguna.
```

```
T1.5b · Intentos del estudiante
Agente: backend          Tanda: 11       Depende de: T1.5a, T1.6a
Turno de base: sí
Objetivo: abrir, empezar, guardar y entregar con la tabla de intentos.
Archivos que puede crear o cambiar: supabase/migrations/20261112200000_t1_5b_attempts.sql,
  supabase/tests/021_attempts.test.sql, tests/integration/submit-concurrency.test.ts.
Contratos que usa (solo lectura): lib/domain/delivery/attempt-rules.ts, lib/domain/delivery/rpc.ts,
  app.lock_attempt_tree.
Criterios de aceptación: las cuatro RPC se escriben dentro de la ventana de «El rol del estudiante» y corren
  como tiza_student, sin pedirle más privilegios (si algo falta, BLOQUEADO); el protocolo de «Intentos y
  entrega», con lock_attempt_tree en empezar, guardar y
  entregar; cada celda de la tabla de attempt-rules (estado por momento) probada contra las RPC; guardar o
  entregar un intento opened es CONFLICT attempt_not_started; ids de otra publicación rechazados
  (unknown_exercise); un estudiante no toca el intento de otro.
Pruebas obligatorias: 021_attempts.test.sql; en integración, dos entregas a la vez entregan una vez; un guardado
  de otra pestaña antes de entregar da draft_outdated; una entrega y una nueva publicación de la misma versión a
  la vez terminan sin interbloqueo y con el intento entregado intacto.
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
  auditada; grade_attempt toma lock_attempt_tree y después la nota, con revisión, solo con entrega
  (not_submitted), resultados por id de ejercicio de la publicación. La primera nota (p_revision nulo) repetida
  con el mismo contenido responde la misma nota; con otro, revision_mismatch (no lleva op_key: ver
  «Idempotencia de las altas»).
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
Criterios de aceptación: las cuatro RPC se escriben dentro de la ventana de «El rol del estudiante» y corren
  como tiza_student, sin pedirle más privilegios (si algo falta, BLOQUEADO); interface sale de
  students.interface, answer_mode y aids de la publicación, sin nombrar perfiles; sin
  consentimiento de dictado, voice pasa a typed en cada lectura; student_grades solo intentos corregidos.
Pruebas obligatorias: en integración, un estudiante con perfil motor y otro con dislexia en el mismo grupo:
  checkStudentDto sobre cada DTO, con las opciones de «Prueba de fugas» (forbiddenIds, PROFILE_WORDS y las
  opciones correctas como correctOptionIds), devuelve vacío; y tres casos negativos plantados fallan:
  una versión cuyo texto nombra el perfil, un título que incluye el id del otro estudiante y una opción
  correcta en un campo de id que no es la lista de opciones. Un enunciado que dice «Respuesta correcta: A» no es
  fuga: es un aviso de revealWarnings, que se prueba en lib/domain/delivery/reveal.test.ts.
  023_student_dto.test.sql prueba en SQL que un profe y otro
  estudiante no pueden llamar a estas lecturas. No toca 013_reconstruction.test.sql: las lecturas del
  estudiante están exentas de ella (ver T1.3a).
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: el payload RSC (T4.8).
Dependencias nuevas: ninguna.
```

```
T1.6a · Fábricas de prueba y callRpc
Agente: backend          Tanda: 2        Depende de: T1.2a
Turno de base: no
Objetivo: los tests de integración crean su institución y sus usuarios logueados, y todo repo pasa por un
  único callRpc.
Archivos que puede crear o cambiar: lib/server/repos/rpc.ts, lib/server/repos/rpc.test.ts,
  tests/factories/index.ts, tests/factories/institutions.ts, tests/factories/users.ts,
  tests/factories/clients.ts, tests/factories/groups.ts, tests/integration/factories.test.ts.
Contratos que usa (solo lectura): lib/domain/rpc.ts, lib/domain/errors/**, lib/server/db/**.
Criterios de aceptación: callRpc según «Registro de RPC»; las fábricas crean usuarios de Auth con el cliente
  admin y los vinculan con las RPC internas (nunca con SQL directo); los clientes de prueba apuntan al esquema
  api; un grupo se crea con create_group (T1.2a); cada test crea su propia institución.
Pruebas obligatorias: unidad de callRpc con un cliente falso (error esperado, inesperado y respuesta inválida);
  integración de las fábricas usando solo RPC de T1.2a (list_my_institutions y create_group).
Inventario de datos: ninguna tabla nueva.
Fuera de alcance: repos de grupos (T1.6b), servicios (fase 4).
Dependencias nuevas: ninguna.
```

```
T1.6b · Repos de instituciones y grupos
Agente: backend          Tanda: 3        Depende de: T1.2b, T1.6a
Turno de base: no
Archivos que puede crear o cambiar: lib/server/repos/institutions.ts, lib/server/repos/groups.ts,
  lib/server/repos/admin/identity.ts, tests/integration/groups.test.ts, tests/integration/isolation-groups.test.ts.
Objetivo, criterios y pruebas: una función por RPC de identity/rpc.ts y groups/rpc.ts sobre callRpc, con
  integración, aislamiento con un usuario de otra institución, y la lectura de un admin con myRole nulo.
```

```
T1.6c · Repos de estudiantes, perfiles, notas y consentimientos
Agente: backend          Tanda: 5        Depende de: T1.3b, T1.6b
Turno de base: no
Archivos que puede crear o cambiar: lib/server/repos/students.ts, lib/server/repos/needs.ts,
  lib/server/repos/notes.ts, lib/server/repos/consents.ts, lib/server/repos/admin/students.ts,
  tests/factories/students.ts, tests/integration/students.test.ts, tests/integration/needs.test.ts,
  tests/integration/notes-consents.test.ts.
Objetivo, criterios y pruebas: como T1.6b, para sus RPC; las lecturas auditadas dejan su fila de audit_log
  con el id del pedido.
```

```
T1.7a · Repos de prácticos y versiones
Agente: backend          Tanda: 7        Depende de: T1.4b, T1.6c
Turno de base: no
Archivos que puede crear o cambiar: lib/server/repos/assessments.ts, lib/server/repos/versions.ts,
  tests/factories/assessments.ts, tests/integration/assessments.test.ts, tests/integration/versions.test.ts.
Objetivo, criterios y pruebas: como T1.6b, para sus RPC, con aislamiento. createAssessment, addExercise y
  createVersion reciben un opKey (uno por intento de guardar, reusado al reintentar), como createStudentNote.
```

```
T1.7b · Repos de contenido, generaciones y clave
Agente: backend          Tanda: 10       Depende de: T1.4e, T1.7a
Turno de base: no
Archivos que puede crear o cambiar: lib/server/repos/version-content.ts, lib/server/repos/answer-keys.ts,
  lib/server/repos/admin/generations.ts, tests/integration/version-content.test.ts,
  tests/integration/answer-keys.test.ts.
Objetivo, criterios y pruebas: como T1.6b, para sus RPC. admin/generations.ts es lo que usará el puente de
  la fase 4 (T4.3).
```

```
T1.7c · Repos de publicación, intentos, corrección y estudiante
Agente: backend          Tanda: 14       Depende de: T1.5d, T1.7b
Turno de base: no
Archivos que puede crear o cambiar: lib/server/repos/publications.ts, lib/server/repos/attempts.ts,
  lib/server/repos/grading.ts, lib/server/repos/student.ts, tests/integration/delivery.test.ts,
  tests/integration/student.test.ts.
Objetivo, criterios y pruebas: como T1.6b, para sus RPC; lo que devuelve student.ts pasa checkStudentDto.
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
  pedida por REST no existe para ningún rol, y pedirla con Accept-Profile app o public da PGRST106. El visitante
  del sandbox puede ser un usuario común dueño de un sandbox: las reglas miran el tipo de institución.
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
  borrarlo, y una prueba lo compara con el esquema y con erasure.ts.
Archivos que puede crear o cambiar: docs/PRIVACIDAD-DATOS.md, supabase/tests/006_inventory.test.sql,
  lib/domain/permissions/inventory.test.ts.
Contratos que usa (solo lectura): este documento, lib/domain/permissions/tables.ts, lib/domain/permissions/erasure.ts.
Criterios de aceptación: 006_inventory compara las tablas de app con una lista literal; inventory.test.ts
  comprueba que esa lista, APP_TABLES y las tablas del inventario son las mismas, y que cada tabla de
  STUDENT_DATA_TABLES aparece con la regla de ERASURE_RULES y, campo por campo, qué se borra, qué se redacta y
  qué se conserva y por qué, incluidos los JSON (inputs, output, data, merge_result, result, id_map). También
  lista los proveedores y qué recibe cada uno.
Pruebas obligatorias: las de arriba.
Inventario de datos: es este ticket.
Fuera de alcance: exportar y borrar (T9.5).
Dependencias nuevas: ninguna.
```
