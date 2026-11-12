# Inventario de datos personales

Este documento dice qué datos de un estudiante guarda Tiza.ai, dónde, y qué pasa con cada uno cuando se borra al estudiante. También dice qué recibe cada proveedor y para qué.

Los datos son de menores y los perfiles son datos de salud (datos sensibles según la Ley 18.331 de Uruguay). Por eso el criterio es conservador: lo que queda después de borrar el seudónimo se trata como dato personal, salvo que este documento justifique lo contrario campo por campo.

Lo comprueba una prueba (`lib/domain/permissions/inventory.test.ts`) y otra de base (`supabase/tests/006_inventory.test.sql`). Si una tabla o una columna nueva no está acá, la prueba falla. Toda tabla nueva entra a este inventario en el mismo ticket que la crea.

## Cómo leerlo

Cada tabla del esquema `app` tiene su sección. La regla es la de `lib/domain/permissions/erasure.ts`, que implementa T9.5:

- `delete`: se borran las filas del estudiante.
- `unlink`: la fila queda sin el vínculo con el estudiante.
- `redact`: la fila queda y se borra la parte que es del estudiante.
- `keep`: la fila queda tal cual, por el motivo que se da.
- `by_version`: sigue a la versión. Una versión es individual si en toda su historia solo la recibió ese estudiante. Se borra con todo lo que cuelga de ella. Cualquier otra es compartida: queda sin él como destinatario y se redacta el texto libre que lo nombre.

Cada campo tiene una acción:

- `borra`: el dato se va.
- `redacta`: se borra la parte que nombra o describe al estudiante y el resto queda.
- `conserva`: el dato queda, y el campo «Por qué» dice por qué.
- `desvincula`: el campo queda en nulo.

En las tablas `by_version` la acción tiene dos partes: `individual: X; compartida: Y`.

La columna «Después» describe lo que queda: `no queda`, `personal` (se sigue tratando como dato personal) o `no personal` (solo con justificación en «Por qué»). Un campo `conserva` o `redacta` nunca es `no queda`.

Para los campos de control de cada tabla (`id`, `institution_id`, `created_at`, `updated_at`, `revision`) rige lo mismo que para la fila: se van con ella y, si la fila queda, son identificadores técnicos sin dato propio.

La redacción de filas inmutables (eventos, salidas de la IA, revisiones de la clave, publicaciones y entradas de la generación) corre dentro del modo supresión de `app.begin_erasure`. Solo puede tocar un campo por tabla, salvo `version_events`, que deja dos: `version_events.data`, `version_events.result`, `generation_outputs.output`, `answer_key_revisions.content`, `publications.content` y `generations.inputs`.

## Tablas

### `app_users`

Regla: `delete`.

Una fila por cuenta de Auth. Para los estudiantes `display_name` es nulo y el nombre vive en `students`. La fila de la cuenta de un estudiante se va en cascada cuando T9.5 borra la cuenta de Auth (paso 3 del orden de la supresión).

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `display_name` | borra | no queda | Nombre de profes y admins; nulo en estudiantes. Se va con la cuenta. |
| `id`, `created_at`, `updated_at`, `revision` | borra | no queda | El id es el de la cuenta de Auth del estudiante, y se va por cascada al borrar esa cuenta. |

### `institutions`

Regla: `sin datos de estudiantes`.

Datos del colegio: nombre, código de login, tipo y vencimiento de la demo. `owner_user_id` es el profe dueño de una demo. No hay nada de estudiantes.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `id`, `name`, `code`, `kind`, `expires_at`, `owner_user_id`, `created_at`, `updated_at`, `revision` | conserva | no personal | Datos de la institución, no de un estudiante. |

### `subjects`

Regla: `sin datos de estudiantes`.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `id`, `enabled`, `created_at` | conserva | no personal | Catálogo de materias. |

### `memberships`

Regla: `delete`.

Pertenencia de una cuenta a una institución con su rol. Los estudiantes tienen una con rol `student`. Esa fila se va en cascada con `app_users` al borrar la cuenta de Auth.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `user_id`, `institution_id`, `role`, `revoked_at` | borra | no queda | En la membresía de un estudiante dicen en qué colegio estuvo. Se va con la cuenta. |
| `id`, `created_at`, `updated_at`, `revision` | borra | no queda | Identificadores y fechas de la fila, sin dato propio. |

### `invitations`

Regla: `sin datos de estudiantes`.

Invitaciones a profes, inclusión y admins. No se invita a estudiantes: se crean con usuario y clave.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `email`, `token_hash`, `role`, `status`, `expires_at`, `invited_by`, `accepted_by`, `accepted_at`, `op_key`, `op_identity`, `sent_at`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | conserva | no personal | Son datos de personal docente. El rol de una invitación nunca es `student`. |

### `groups`

Regla: `sin datos de estudiantes`.

Nombre del grupo, materia y año. El nombre es del grupo («3.º A»), no de una persona.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `name`, `subject_id`, `school_year`, `archived_at`, `created_by`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | conserva | no personal | Datos del grupo. |
| `op_key`, `op_identity` | conserva | no personal | Identidad del alta (T1.F3): el uuid del pedido y el sha256 de institución, materia, año y nombre del grupo. |

### `group_staff`

Regla: `sin datos de estudiantes`.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `group_id`, `user_id`, `role`, `removed_at`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | conserva | no personal | Qué profe da el grupo. |

### `students`

Regla: `delete`.

Es el estudiante. Nombre y usuario son personales; no son sensibles.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `display_name`, `username` | borra | no queda | Nombre y usuario de login: identifican. |
| `user_id` | borra | no queda | Apunta a su cuenta de Auth, que T9.5 borra aparte. |
| `interface` | borra | no queda | Ajuste de accesibilidad (estándar, mirada o voz) que elige el staff; ya no se deriva del perfil (T1.F8). Sigue siendo del estudiante: se borra con él. |
| `archived_at` | borra | no queda | Dice cuándo dejó de cursar. |
| `id`, `institution_id`, `created_at`, `updated_at`, `revision` | borra | no queda | Identificadores y fechas de la fila, sin dato propio. |

### `enrollments`

Regla: `delete`.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `group_id`, `student_id`, `started_at`, `ended_at` | borra | no queda | Dice en qué grupos estuvo y cuándo. |
| `id`, `institution_id`, `created_at`, `updated_at`, `revision` | borra | no queda | Identificadores y fechas de la fila, sin dato propio. |

### `student_pseudonyms`

Regla: `unlink`.

El seudónimo es el id de esta fila. Sin el vínculo no lleva a nadie. Lo que queda atado a él después de la supresión es solo `erasures`: `feedback_events` se borra y el mapa de `group_analyses` pierde su entrada.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `student_id` | desvincula | no queda | Es el vínculo. La clave foránea no tiene `ON DELETE`: primero se desvincula y después se borra al estudiante. |
| `id` | conserva | no personal | Es un uuid aleatorio sin relación con el estudiante. Después de la supresión solo lo referencia `erasures`, que no tiene datos personales. |
| `unlinked_at` | conserva | no personal | Fecha de la supresión. Está también en `erasures` y no identifica sin el vínculo. |
| `institution_id`, `created_at` | conserva | no personal | Colegio y fecha de alta de un uuid que ya no lleva a nadie. Se acepta porque ningún otro dato conservado lleva este seudónimo. |

### `account_provisioning`

Regla: `keep`.

Una fila por cuenta de estudiante, para que `reconcile_accounts` no recree una cuenta borrada.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `student_id` | desvincula | no queda | La clave foránea es `ON DELETE SET NULL`: al borrar al estudiante queda en nulo. |
| `auth_user_id` | conserva | no personal | Es el id de la cuenta de Auth. Es no personal solo por el orden de la supresión (ver «Orden de la supresión»): la cuenta de Auth se borra en el paso 3, antes de cerrarla en el paso 4, y sin la cuenta el id no lleva a nadie. |
| `status` | conserva | no personal | Pasa a `deleted`: es la marca que impide recrear la cuenta. |
| `op_identity` | desvincula | no queda | Es el sha256 de grupo y username de la creación. Deja de ser «no personal»: los grupos y sus uuid siguen existiendo después de la supresión, así que quien conozca un username candidato puede calcular `sha256(grupo + ':' + username)` y comprobar si coincide. Queda en nulo al borrar al estudiante; se conservan la marca `deleted` y el `op_key`, que bastan para que `reconcile_accounts` no recree la cuenta. |
| `op_key`, `attempts`, `error_code`, `lease_until`, `lease_holder` | conserva | no personal | Control técnico del aprovisionamiento, sin texto libre. `op_key` es un uuid que genera el cliente y no se deriva de ningún dato del estudiante. |
| `id`, `institution_id`, `created_at`, `updated_at`, `revision` | conserva | no personal | Identificadores y fechas de la fila, sin dato propio. |

### `access_card_issues`

Regla: `sin datos de estudiantes`.

Una emisión de tarjetas: la operación con plazo que cambia contraseñas en Auth. Es del grupo y no guarda ids de estudiantes: `op_identity` es el sha256 del grupo y del conjunto ordenado de estudiantes, solo para comparar repeticiones del mismo pedido. Se borra con el grupo.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `op_key`, `op_identity` | conserva | no personal | Identidad del pedido: un uuid del cliente y un resumen de grupo y conjunto de estudiantes. No contiene ningún id de estudiante y no permite recuperar la lista. |
| `institution_id`, `group_id`, `issued_by`, `status`, `finished_at`, `id`, `created_at` | conserva | no personal | Control técnico de la operación y quién la hizo (un adulto). |

### `access_cards`

Regla: `delete`.

La tarjeta de acceso de un estudiante: el QR que completa el colegio y el usuario. Estados: `pending`, `active`, `revoked`. El token no se guarda, solo su hash; el QR no alcanza para entrar, siempre pide la contraseña.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `student_id`, `institution_id`, `issue_id`, `token_hash`, `status`, `activated_at`, `revoked_at` | borra | no queda | Dicen de qué estudiante es la tarjeta y cuándo se usó o se revocó. La clave foránea es `ON DELETE CASCADE`: se va con el estudiante, y solo así (una guardia impide borrarla a mano). |
| `id`, `created_at` | borra | no queda | Identificador y fecha de la fila, sin dato propio. |

### `invitation_tokens`

Regla: `sin datos de estudiantes`.

El registro de todo hash de invitación que existió alguna vez, para que no vuelva a nacer. No se invita a estudiantes.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `token_hash`, `invitation_id`, `institution_id`, `id`, `created_at` | conserva | no personal | Un hash de 32 bytes, sin el token ni el correo, y la fecha en que nació. |

### `student_needs`

Regla: `delete`.

El perfil del estudiante: dato de salud. Nunca se lee directo; solo por RPC auditadas.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `profiles` | borra | no queda | Perfiles (TDAH, dislexia, TEA, motriz, disgrafía): dato de salud. |
| `supports` | borra | no queda | Apoyos elegidos: permiten deducir el perfil. |
| `interests` | borra | no queda | Texto libre del profe; puede traer un nombre. |
| `review_due_on` | borra | no queda | Fecha de revisión del perfil. |
| `student_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | borra | no queda | Identificadores y fechas de la fila, sin dato propio. |

### `student_need_events`

Regla: `delete`.

Historial de cambios del perfil.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `before`, `after` | borra | no queda | Foto del perfil antes y después: dato de salud. |
| `kind`, `need_revision` | borra | no queda | Qué cambió y en qué revisión. |
| `actor_user_id`, `op_id` | borra | no queda | Quién lo cambió: forma parte del historial de un dato de salud. |
| `student_id`, `id`, `institution_id`, `created_at` | borra | no queda | Identificadores y fechas de la fila, sin dato propio. |

### `student_notes`

Regla: `delete`.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `body` | borra | no queda | Texto libre del profe sobre el estudiante; sensible. |
| `author_user_id`, `archived_at` | borra | no queda | Quién la escribió y cuándo se archivó. |
| `op_key`, `op_identity` | borra | no queda | Identidad de la creación (T1.F2): el `op_key` del pedido y el sha256 de estudiante y texto, para que repetir el envío no cree otra nota. Se deriva del texto de la nota: vive y muere con la fila. |
| `student_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | borra | no queda | Identificadores y fechas de la fila, sin dato propio. |

### `files`

Regla: `delete`.

Aplica a las filas con `student_id`: formularios firmados e informes del estudiante. Los archivos de un grupo (originales y programas) no tienen `student_id` y no se tocan. Primero se borra el objeto de Storage y después la fila.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `bucket`, `path` | borra | no queda | Dónde está el objeto. El objeto de Storage se borra primero. |
| `purpose`, `mime_type`, `size_bytes`, `max_bytes`, `status` | borra | no queda | Dicen qué clase de documento era. |
| `student_id`, `group_id` | borra | no queda | Dueño del archivo. |
| `reserved_by`, `confirmed_at` | borra | no queda | Quién lo subió y cuándo. |
| `id`, `institution_id`, `created_at`, `updated_at`, `revision` | borra | no queda | Identificadores y fechas de la fila, sin dato propio. |

### `syllabi`

Regla: `sin datos de estudiantes`.

Programa del grupo: unidades y su PDF.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `units`, `group_id`, `file_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | conserva | no personal | Temas del programa del grupo. |

### `consents`

Regla: `delete`.

Se borran después de sus efectos: primero se cancela lo que dependía de ellos.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `student_id`, `purpose`, `text_version`, `status` | borra | no queda | Qué autorizó, con qué texto y si sigue vigente. |
| `valid_from`, `valid_until`, `revoked_at` | borra | no queda | Fechas de la autorización. |
| `revoked_by`, `recorded_by`, `file_id` | borra | no queda | Quién lo cargó o revocó y el formulario firmado (el archivo se borra en `files`). |
| `id`, `institution_id`, `created_at`, `updated_at`, `revision` | borra | no queda | Identificadores y fechas de la fila, sin dato propio. |

### `assessments`

Regla: `redact`.

El práctico original, del profe. `topic` y `general_instructions` son texto libre y pueden nombrar a un estudiante («Para Paula: ...»). Si nombran al estudiante, se redactan, igual que en `assessment_exercises`.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `topic`, `general_instructions` | redacta | personal | Texto libre del profe. Si nombra al estudiante, se redacta esa parte; si no, queda como estaba. |
| `group_id`, `subject_id`, `kind`, `status`, `publish_at`, `due_at`, `source_file_id`, `created_by` | conserva | no personal | Datos del práctico, no de un estudiante. |
| `op_key`, `op_identity` | desvincula | no queda | Identidad del alta (T1.F3), para que repetir el pedido no cree otro práctico: el `op_key` es un uuid del navegador. `op_identity` es el sha256 de grupo, tipo, tema e instrucciones tal como se crearon, así que sigue dependiendo del texto original aunque después se haya editado a algo neutro: con un nombre candidato se puede calcular el hash y comprobar si coincide («Para Paula» editado a «Repaso» conserva el hash de «Para Paula»). Por eso no se decide por el contenido actual: al suprimir a un estudiante se ponen en nulo `op_key` y `op_identity` de todo lo de los grupos donde estuvo inscripto alguna vez (la inscripción se mira antes de borrarla), y de las versiones de las que fue destinatario. La guardia lo deja solo dentro del modo supresión de la institución. Consecuencia: repetir después el pedido original crearía otra fila, algo aceptable tras una supresión. |
| `id`, `institution_id`, `created_at`, `updated_at`, `revision` | conserva | no personal | Identificadores y fechas de la fila, sin dato propio. |

### `assessment_exercises`

Regla: `redact`.

Ejercicios del original. El original es del profe; si su texto nombra al estudiante, se redacta.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `body`, `label` | redacta | personal | Texto libre. Si nombra al estudiante, se redacta esa parte; si no, queda como estaba. |
| `assessment_id`, `position`, `topic_id`, `removed_at` | conserva | no personal | Posición y referencias dentro del práctico: no dicen nada de un estudiante. |
| `op_key`, `op_identity` | desvincula | no queda | Identidad del alta (T1.F3), para que repetir el pedido no agregue otro ejercicio: el `op_key` es un uuid del navegador. `op_identity` es el sha256 de práctico, etiqueta, enunciado y tema tal como se crearon, así que sigue dependiendo del texto original aunque después se haya editado a algo neutro: con un nombre candidato se puede calcular el hash y comprobar si coincide («Para Paula» editado a «Repaso» conserva el hash de «Para Paula»). Por eso no se decide por el contenido actual: al suprimir a un estudiante se ponen en nulo `op_key` y `op_identity` de todo lo de los grupos donde estuvo inscripto alguna vez (la inscripción se mira antes de borrarla), y de las versiones de las que fue destinatario. La guardia lo deja solo dentro del modo supresión de la institución. Consecuencia: repetir después el pedido original crearía otra fila, algo aceptable tras una supresión. |
| `id`, `institution_id`, `created_at`, `updated_at`, `revision` | conserva | no personal | Identificadores y fechas de la fila, sin dato propio. |

### `versions`

Regla: `by_version`.

La configuración de una versión (`config`) tiene perfiles y apoyos: dato de salud.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `config` | individual: borra; compartida: redacta | personal | JSON con perfiles, apoyos e intereses de la combinación. En una compartida se redacta el texto libre que nombre al estudiante (los intereses y cualquier otro texto del JSON). Los perfiles y apoyos de los demás destinatarios se conservan: siguen siendo dato de salud. |
| `general_instructions` | individual: borra; compartida: redacta | personal | Instrucciones del profe; si nombran al estudiante, se redacta esa parte. |
| `answer_mode`, `status`, `stale`, `error_code`, `approved_revision`, `instructions_revision` | individual: borra; compartida: conserva | no personal | Estado de la versión. No identifican a nadie y no hay forma de atribuirlos a un destinatario. |
| `assessment_id`, `position`, `base_version_id`, `current_generation_id`, `archived_at` | individual: borra; compartida: conserva | no personal | Posición y referencias dentro del práctico: no dicen nada de un estudiante. |
| `created_by` | individual: borra; compartida: conserva | no personal | Id del profe que creó la versión. No es de un estudiante. |
| `op_key`, `op_identity` | individual: borra; compartida: desvincula | no queda | Identidad de la creación (T1.F3), para que repetir el pedido no cree otra versión: el `op_key` es un uuid del navegador. `op_identity` es el sha256 de práctico, configuración, modo de respuesta y versión base tal como se crearon, así que sigue dependiendo del texto original aunque después se haya editado a algo neutro: con un nombre candidato se puede calcular el hash y comprobar si coincide («Para Paula» editado a «Repaso» conserva el hash de «Para Paula»). Por eso no se decide por el contenido actual: al suprimir a un estudiante se ponen en nulo `op_key` y `op_identity` de todo lo de los grupos donde estuvo inscripto alguna vez (la inscripción se mira antes de borrarla), y de las versiones de las que fue destinatario. La guardia lo deja solo dentro del modo supresión de la institución. Consecuencia: repetir después el pedido original crearía otra fila, algo aceptable tras una supresión. La configuración es dato de salud. En una versión individual se borra con ella. |
| `instructions_written_by` | individual: borra; compartida: conserva | no personal | Id de la generación que escribió las instrucciones. Es nulo si las escribió el profe a mano. No es un id de profe ni de estudiante. |
| `id`, `institution_id`, `created_at`, `updated_at`, `revision` | individual: borra; compartida: conserva | no personal | Identificadores y fechas de la fila, sin dato propio. |

### `version_exercises`

Regla: `by_version`.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `body` | individual: borra; compartida: redacta | personal | Texto adaptado a los perfiles de los destinatarios: deja deducir el perfil. |
| `changes` | individual: borra; compartida: redacta | personal | JSON con la lista de adaptaciones aplicadas y su motivo en texto libre. En una compartida se redacta el motivo que nombre al estudiante. Las adaptaciones de los demás destinatarios se conservan: deducen su perfil. |
| `exercise_id`, `source_revision`, `status`, `error_code`, `current_generation_id`, `written_by_generation_id` | individual: borra; compartida: conserva | no personal | Referencias entre filas y estado de un conjunto cerrado: sin texto libre. |
| `assessment_id`, `version_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | individual: borra; compartida: conserva | no personal | Identificadores y fechas de la fila, sin dato propio. |

### `version_questions`

Regla: `by_version`.

Preguntas de mirada, sin la respuesta.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `stem`, `options` | individual: borra; compartida: redacta | personal | Texto de la pregunta y JSON con el texto de las opciones. En una compartida se redacta el texto que nombre al estudiante; el resto se conserva, porque dice que la versión es para mirada y deduce el perfil motriz de los demás. |
| `position`, `version_exercise_id`, `version_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | individual: borra; compartida: conserva | no personal | Estructura y control. |

### `question_keys`

Regla: `by_version`.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `correct_option_id`, `question_id` | individual: borra; compartida: conserva | no personal | Es la opción correcta de una pregunta: no dice nada del estudiante. Nunca llega a un estudiante. |
| `version_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | individual: borra; compartida: conserva | no personal | Identificadores y fechas de la fila, sin dato propio. |

### `version_recipients`

Regla: `delete`.

Quién recibió cada versión y cuándo. Junto con `versions.config` revela el perfil.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `student_id`, `valid_from`, `valid_to` | borra | no queda | Qué versión recibió y en qué período. |
| `assessment_id`, `version_id`, `id`, `institution_id`, `created_at` | borra | no queda | Identificadores y fechas de la fila, sin dato propio. |

### `generations`

Regla: `by_version`.

Un pedido a la IA. Guarda las entradas tal cual salieron, sin nombres.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `inputs` | individual: borra; compartida: redacta | personal | JSON con ejercicios, configuración (perfiles, apoyos, intereses), programa, instrucciones del profe y `instructionsRevision`. Los nombres no entran, pero un texto libre puede traer uno. Se redacta lo que lo nombre. El resto sigue siendo de los demás destinatarios. |
| `profiles_hash`, `profiles_revision` | individual: borra; compartida: conserva | no personal | Hash y revisión de los archivos `data/profiles/*.md` aprobados. Son iguales para todos los estudiantes. |
| `prompt_version`, `subject_id`, `kind`, `required_jobs`, `target_revision` | individual: borra; compartida: conserva | no personal | Versión del prompt y forma del trabajo. |
| `op_key` | individual: borra; compartida: conserva | no personal | uuid aleatorio generado por el navegador. |
| `status`, `error_code`, `finished_at` | individual: borra; compartida: conserva | no personal | Resultado técnico, con códigos y sin texto libre. |
| `version_id`, `target_exercise_id`, `requested_by`, `id`, `institution_id`, `created_at`, `updated_at` | individual: borra; compartida: conserva | no personal | Referencias, id del profe que lo pidió y control de la fila. |

### `operations`

Regla: `redact`.

Operaciones con partes que no son una versión: leer un documento, leer el programa y analizar un grupo.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `merge_result` | redacta | personal | JSON con el resultado del análisis de un grupo, que tiene la parte de cada estudiante por etiqueta (E1, E2), o el texto de un documento leído, que puede nombrarlo. Se saca su parte; el resto es del grupo. |
| `kind`, `status`, `required_parts`, `error_code`, `finished_at`, `op_key` | conserva | no personal | Control técnico sin datos de estudiantes. |
| `group_id`, `assessment_id`, `file_id`, `requested_by`, `id`, `institution_id`, `created_at`, `updated_at` | conserva | no personal | Referencias, id del profe y control de la fila. |

### `generation_outputs`

Regla: `by_version`.

Lo que devolvió la IA, tal cual y antes de cualquier edición. Se guarda como materia prima del motor que aprende.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `output` | individual: borra; compartida: redacta | personal | JSON con el ejercicio adaptado, las preguntas, las instrucciones o la clave. Si nombra al estudiante, se redacta esa parte. El resto es de los demás destinatarios. |
| `kind`, `outcome`, `expected_revision` | individual: borra; compartida: conserva | no personal | Clase y destino de la salida (aplicada, obsoleta o descartada). |
| `version_id`, `generation_id`, `version_exercise_id`, `id`, `institution_id`, `created_at` | individual: borra; compartida: conserva | no personal | Referencias y control de la fila. |

### `version_events`

Regla: `by_version`.

Historial de lo que hizo el profe con la salida de la IA: editó, aprobó, rechazó con motivos, regeneró o cambió destinatarios. Es el feedback que usa el motor.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `data` | individual: borra; compartida: redacta | personal | JSON según el tipo: `edited` trae el texto nuevo, `rejected` los motivos, `regenerated` la instrucción y `recipients_changed` los ids de estudiantes agregados y quitados. De `recipients_changed` se saca al estudiante y se redacta el texto que lo nombre. |
| `result` | individual: borra; compartida: redacta | personal | JSON con la respuesta exacta de la operación, que se repite si se reintenta. Solo lleva ids de objetos de la versión y revisiones: en `set_version_recipients`, el id de la versión y su revisión, nunca ids de estudiantes. Si algún texto lo nombrara, se redacta igual que `data`. |
| `kind`, `operation`, `target_id`, `op_id` | individual: borra; compartida: conserva | no personal | Nombre de la RPC y el id del objeto sobre el que actuó: no lleva ids de estudiantes. |
| `version_revision`, `exercise_revision` | individual: borra; compartida: conserva | no personal | Números de revisión del ejercicio y de la versión: contadores sin contenido. |
| `actor_user_id` | individual: borra; compartida: conserva | no personal | Id histórico del profe, sin clave foránea. No es de un estudiante. |
| `version_id`, `generation_id`, `version_exercise_id`, `id`, `institution_id`, `created_at` | individual: borra; compartida: conserva | no personal | Referencias y control de la fila. |

### `answer_keys`

Regla: `by_version`.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `status`, `stale`, `error_code` | individual: borra; compartida: conserva | no personal | Estado de la clave y código de error: valores de un conjunto cerrado. |
| `version_id`, `current_generation_id`, `current_revision_id`, `approved_revision_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | individual: borra; compartida: conserva | no personal | Referencias y control de la fila. |

### `answer_key_revisions`

Regla: `by_version`.

Solo agrega. Cada intento apunta a una revisión.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `content` | individual: borra; compartida: redacta | personal | JSON con la clave y la rúbrica. Puede citar texto del ejercicio adaptado. Si nombra al estudiante, se redacta esa parte. |
| `exercise_revisions`, `question_revisions` | individual: borra; compartida: conserva | no personal | Mapas de id a número de revisión. |
| `source`, `number`, `version_revision`, `instructions_revision` | individual: borra; compartida: conserva | no personal | Origen (IA o profe) y número de la revisión: sin contenido ni ids de estudiantes. |
| `author_user_id` | individual: borra; compartida: conserva | no personal | Id del profe que la editó: dato del personal, no de un estudiante. |
| `version_id`, `answer_key_id`, `generation_id`, `id`, `institution_id`, `created_at` | individual: borra; compartida: conserva | no personal | Referencias y control de la fila. |

### `publications`

Regla: `by_version`.

Copia inmutable de lo que vio el estudiante.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `content` | individual: borra; compartida: redacta | personal | JSON con los ejercicios adaptados y las preguntas sin respuesta. Es lo que resolvió cada destinatario. Solo se redacta si nombra al estudiante. |
| `aids` | individual: borra; compartida: conserva | personal | JSON con las ayudas activas (lectura en voz alta y similares). Se calculan desde los perfiles, así que dejan deducirlos. |
| `answer_mode` | individual: borra; compartida: conserva | personal | Mirada, dictado o escritura: deduce el perfil motriz o de disgrafía. |
| `version_revision`, `published_by`, `published_at`, `withdrawn_at` | individual: borra; compartida: conserva | no personal | Cuándo y quién publicó: dato del profe y de la versión, no de un destinatario. |
| `op_key`, `op_identity`, `op_attempts` | individual: borra; compartida: conserva | no personal | Identidad de la publicación (T1.F3), para que repetir el pedido no publique dos veces: el `op_key` es un uuid que genera el navegador; `op_identity` es el sha256 de la versión, la revisión aprobada y la revisión de la clave (solo ids y números, ningún texto); `op_attempts` es cuántos intentos creó o movió esa publicación, la respuesta que se repite. No se derivan de ningún dato de un estudiante. |
| `assessment_id`, `version_id`, `answer_key_revision_id`, `id`, `institution_id`, `created_at` | individual: borra; compartida: conserva | no personal | Referencias y control de la fila. |

### `assignments`

Regla: `delete`.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `student_id`, `status` | borra | no queda | Su tarea y cómo va. |
| `assessment_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | borra | no queda | Identificadores y fechas de la fila, sin dato propio. |

### `assignment_attempts`

Regla: `delete`.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `status`, `late`, `number` | borra | no queda | Cómo fue el intento. |
| `first_viewed_at`, `started_at`, `submitted_at`, `superseded_at` | borra | no queda | Señales de uso: cuándo abrió, empezó y entregó. |
| `assignment_id`, `assessment_id`, `version_id`, `publication_id`, `answer_key_revision_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | borra | no queda | Referencias y control de la fila. |

### `submissions`

Regla: `delete`.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `answers` | borra | no queda | JSON con lo que respondió por ejercicio: texto escrito o dictado. |
| `choices` | borra | no queda | JSON con las opciones que eligió por pregunta (mirada). |
| `submitted_at` | borra | no queda | Cuándo entregó. |
| `attempt_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | borra | no queda | Identificadores y fechas de la fila, sin dato propio. |

### `grades`

Regla: `delete`.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `score`, `feedback` | borra | no queda | La nota y la devolución del profe. |
| `exercise_results` | borra | no queda | JSON con el resultado por ejercicio. |
| `graded_by`, `graded_at` | borra | no queda | Quién corrigió y cuándo. |
| `attempt_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | borra | no queda | Identificadores y fechas de la fila, sin dato propio. |

### `group_analyses`

Regla: `redact`.

La lectura de la IA sobre un grupo. A la IA le llegan etiquetas (E1, E2), nunca ids ni nombres.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `pseudonym_map` | redacta | personal | JSON `{ "E1": <seudónimo> }`. Se saca la entrada del estudiante. Las demás son de otros estudiantes. |
| `result` | redacta | personal | JSON con el análisis. Se saca la parte de la etiqueta del estudiante; el resto es del grupo. |
| `inputs_hash` | conserva | no personal | Hash de las entradas, que incluyen el mapa de seudónimos. No se puede invertir sin las entradas, que no se guardan. |
| `analyzer_version` | conserva | no personal | Versión del código que analizó: igual para todos los estudiantes. |
| `group_id`, `assessment_id`, `operation_id`, `id`, `institution_id`, `created_at`, `updated_at` | conserva | no personal | Referencias y control de la fila. |

### `feedback_events`

Regla: `delete`.

Señales de uso y feedback del estudiante, por seudónimo. Que lleven seudónimo y no id no las vuelve anónimas: por eso no hay justificación para conservarlas.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `data` | borra | no queda | JSON con la señal: tiempo por ejercicio, ayuda usada o el feedback que escribió. Texto libre. |
| `kind`, `publication_id`, `exercise_id`, `occurred_at` | borra | no queda | Qué hizo, sobre qué y cuándo. |
| `pseudonym_id`, `id`, `institution_id`, `created_at` | borra | no queda | Control de la fila y el seudónimo. |

### `audit_log`

Regla: `keep`.

Registro de accesos a datos sensibles. Se conserva cinco años y solo lo borra la retención. Es la única tabla donde se acepta que queden ids de estudiantes.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `student_ids` | conserva | no personal | Ids de los estudiantes cuyos datos se leyeron. Después de la supresión no se resuelven a nadie: la fila de `students` ya no existe y el seudónimo no está acá. Se conservan para poder responder quién leyó qué en el plazo legal. |
| `entity`, `entity_id` | conserva | no personal | Qué recurso se leyó. Si era el estudiante, su id ya no resuelve a nadie. |
| `actor_user_id`, `action`, `request_id` | conserva | no personal | Quién y qué hizo: datos del personal, no del estudiante. |
| `id`, `institution_id`, `created_at` | conserva | no personal | Identificadores y fechas de la fila, sin dato propio. |

### `erasures`

Regla: `keep`.

El registro de la supresión. Se copia afuera de la base en la misma acción (`external_copied_at`).

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `pseudonym_id` | conserva | no personal | Seudónimo ya desvinculado. Es lo que permite reaplicar la supresión al restaurar un respaldo. |
| `kind`, `status`, `marked_at`, `completed_at`, `external_copied_at` | conserva | no personal | Tipo y fechas de la supresión: sin el vínculo, no identifican a nadie. |
| `id`, `institution_id`, `created_at`, `updated_at` | conserva | no personal | Identificadores y fechas de la fila, sin dato propio. |

### `rate_limits`

Regla: `sin datos de estudiantes`.

Contadores de uso. La clave es técnica.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `key`, `window_start`, `window_seconds`, `count`, `id`, `created_at`, `updated_at` | conserva | no personal | La clave no lleva nombres ni ids de estudiantes. Es una regla de diseño que debe cumplir quien escriba claves nuevas. |

### `presets`

Regla: `redact`.

Configuraciones que guarda un profe (perfiles, apoyos, intereses). No están atadas a un estudiante, pero `name` es texto libre y puede decir «Paula TDAH». Si nombran al estudiante, se redactan.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `name` | redacta | personal | Texto libre del profe. Si nombra al estudiante, se redacta esa parte. |
| `config` | redacta | personal | JSON con perfiles, apoyos e intereses. No está atado a un estudiante, pero los intereses son texto libre: si nombran al estudiante, se redacta esa parte. |
| `owner_user_id`, `archived_at`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | conserva | no personal | Dueño (el profe) e identificadores de la fila, sin dato propio. |

### `notifications`

Regla: `delete`.

Avisos a profes. Llevan ids, nunca nombres. Se borran los que apuntan a tareas y entregas del estudiante.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `entity`, `entity_id` | borra | no queda | Apuntan a la tarea o a la entrega del estudiante. |
| `data` | borra | no queda | JSON con ids relacionados al aviso. |
| `kind`, `read_at` | borra | no queda | Tipo de aviso y si el profe lo leyó. |
| `user_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | borra | no queda | El profe destinatario y el control de la fila. |

### `import_runs`

Regla: `redact`.

Importaciones desde el `localStorage` del navegador.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `id_map` | redacta | personal | JSON `{ id local: uuid nuevo }`. Se sacan las entradas que corresponden al estudiante o a lo suyo. El resto es de otros. |
| `format_version`, `status`, `parts_total`, `parts_done`, `error_code`, `op_key` | conserva | no personal | Control técnico de la importación. |
| `user_id`, `id`, `institution_id`, `created_at`, `updated_at`, `revision` | conserva | no personal | El profe que importó y el control de la fila. |

### `sandbox_sessions`

Regla: `sin datos de estudiantes`.

Sesión guardada de un profe en una demo.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `refresh_token_ciphertext`, `claim_token`, `claimed_at`, `consumed_at`, `expires_at`, `owner_user_id`, `id`, `institution_id`, `created_at`, `updated_at` | conserva | no personal | Credencial cifrada y de un solo uso de un profe en una institución de demo. No hay estudiantes reales. |

### `student_rpc_windows`

Regla: `sin datos de estudiantes`.

Marca de una ventana de RPC de estudiante dentro de una transacción. Vive lo que dura esa transacción y no lleva ids de estudiantes.

| Campo | Qué pasa | Después | Por qué |
|---|---|---|---|
| `txid`, `id`, `created_at` | conserva | no personal | Id de transacción de la base, uuid aleatorio y fecha. No hay ninguna referencia a un estudiante. |

## Orden de la supresión

Lo que se conserva es no personal solo porque la supresión sigue este orden, que fija `erasure.ts`:

- Primero se marca la supresión (`erasures`, estado `marked`) y se desvincula el seudónimo.
- Después se borran los objetos de Storage del estudiante y las filas según las reglas. Las redacciones corren dentro de `app.begin_erasure`.
- Después se borra la cuenta de Auth con la API de administración. Eso borra en cascada `app_users` y `memberships`, y deja `account_provisioning.auth_user_id` apuntando a una cuenta que ya no existe. Por eso ese campo es no personal.
- Recién entonces la supresión pasa a `done` y se copia afuera de la base.

Si la cuenta de Auth no se borró, `auth_user_id` sigue siendo dato personal y la supresión no se cierra.

## Proveedores

Cada proveedor recibe lo mínimo para su tarea. A la IA nunca le llegan nombres: antes de la primera llamada el texto pasa por `prepareForProvider()`. En los logs solo van números.

### Supabase

Recibe: todas las tablas de este documento, las cuentas de Auth (usuario y credenciales) y los archivos de Storage (originales, programas, formularios firmados e informes).

Para qué: base de datos, autenticación y almacenamiento. Es la fuente de verdad. La región es Brasil.

### Netlify

Recibe: los pedidos y las respuestas que pasan por las funciones y el servidor de Next.js. Pueden traer datos de estudiantes en tránsito. Recibe también los logs de funciones.

Para qué: hosting y ejecución del servidor. No guarda datos. Los logs no llevan contenido de estudiantes, solo números. La región es Brasil.

### Anthropic

Recibe: texto de ejercicios del profe pasado por `prepareForProvider()`, configuración de la adaptación (perfiles, apoyos, intereses), programa, instrucciones del profe y, en el análisis de grupo, resultados con etiquetas E1, E2. No recibe nombres, ids de estudiantes ni seudónimos.

Para qué: adaptar prácticos, generar claves y analizar grupos. Es el proveedor principal de IA.

### OpenRouter

Recibe: lo mismo que Anthropic, pero solo cuando el proveedor principal falla.

Para qué: respaldo de IA. Es un segundo destino real de los mismos datos y figura en la transferencia internacional (art. 23).

### ElevenLabs

Recibe: el texto de un ejercicio para leerlo en voz alta. No recibe nombres. Se cobra por caracteres.

Para qué: lectura en voz alta para los estudiantes que la tienen como apoyo. Se chequea el consentimiento de la finalidad en cada llamada.

### Resend

Recibe: el email y el contenido del mensaje de quien recibe una invitación o un correo de Auth (profes, inclusión y admins).

Para qué: SMTP de Supabase Auth. Los estudiantes entran con usuario y clave: no se les manda email.

### Sentry

Recibe: errores de producción con su traza, ids técnicos y el id del pedido. Debe recibir sin contenido de estudiantes, y se configura para que no capture cuerpos, nombres ni texto libre.

Para qué: detectar y arreglar fallas, con alertas de errores, de cola y de gasto de IA.

### Cloudflare

Recibe: dos cosas. R2 guarda el `pg_dump` cifrado semanal, que tiene todos los datos de este documento, y se conserva 30 días. Turnstile recibe el pedido del visitante de «Probar la demo» (IP y señales del navegador), sin datos de estudiantes.

Para qué: copias de seguridad cifradas y captcha de la demo. Al restaurar un respaldo se reaplican las supresiones del registro externo.

### Dictado del navegador

Recibe: el audio de la voz del estudiante, que el navegador manda a su propio proveedor de reconocimiento (en Chrome, Google). Tiza.ai no controla ese destino.

Para qué: dictar la respuesta (disgrafía). Se pide el consentimiento antes de prender el micrófono. Sin él, el estudiante escribe o elige.
