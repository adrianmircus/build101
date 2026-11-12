# Tiza.ai: de demo a plataforma

Spec para llevar Tiza.ai de la demo de la hackathon a una plataforma que un colegio pueda usar todos los días. Cubre la base técnica, la gestión de grupos, la creación de adaptaciones, la entrega a estudiantes, la colaboración, la privacidad y el paso a producción.

Estado: borrador para aprobar, con las rondas 1 y 2 de revisión incorporadas (`docs/revisiones/plataforma-codex-1.md` y `-2.md`). Fecha: 11/11/2026. Hosting: Netlify. Datos, cuentas y archivos: Supabase.

La implementación la hacen subagentes con Sonnet 5.5 y la orquesta una sesión con Opus 5.5 (ver «Cómo se orquesta»). Este documento fija decisiones, invariantes y el orden de trabajo. El SQL exacto de cada protocolo (máquina de estados, locks, privilegios) se escribe en el contrato de su fase y pasa por revisión antes de repartir tickets. Si el código y el spec no coinciden, se para y se decide cuál cambia.

## Qué cambia para el profe y el estudiante

- Los datos dejan de vivir en el navegador. El profe entra desde cualquier compu y ve lo mismo. El estudiante resuelve desde su casa y el profe lo ve en el momento.
- Hay cuentas reales: cada colegio es una institución con sus profes, su equipo de inclusión y sus estudiantes. Los estudiantes entran con el código del colegio, su usuario y la contraseña de una tarjeta que imprime el profe, sin necesitar email.
- La generación corre en el servidor. El profe puede cerrar la pestaña y volver cuando esté lista.
- Cargar un grupo lleva un minuto: se pega la lista o se sube el Excel.
- Revisar una adaptación lleva minutos: original y adaptado lado a lado, con los cambios marcados, y se edita o regenera un solo ejercicio.
- Las versiones se imprimen, o se publican a los estudiantes con fecha. Lo que recibe cada estudiante queda fijo aunque el profe siga editando.
- Un grupo se comparte con otro profe y con el equipo de inclusión, con registro de quién vio cada perfil.

## Relación con el roadmap a marzo de 2027

Este spec no construye el motor que aprende, la versión por estudiante, la gamificación nueva, la práctica periódica, el agente investigador ni la vista de evolución (`docs/ROADMAP.md`). Pero deja listos los datos y contratos que esas piezas necesitan, para no migrar después:

- **Feedback que no se pierde.** Se guarda:
  - la salida original de la IA de cada ejercicio, antes de cualquier edición;
  - cada edición del profe, con su revisión;
  - la aprobación de una revisión concreta y el rechazo con motivo;
  - los destinatarios de cada versión en cada momento;
  - una tabla de feedback y señales del estudiante, que se empieza a escribir en la fase 8.
  
  Todo con seudónimos.
- **Una versión por estudiante.** Una versión puede tener un solo destinatario y apuntar a una versión base (`base_version_id`).
- **Materia como parámetro.** Grupo, práctico y generación llevan `subject_id`. El prompt, la notación, el catálogo de errores y los verificadores se eligen por materia en el servidor.
- **Lo aprendido es un dato personal.** Toda tabla futura del motor (preferencias, dominio por tema, decisiones con su evidencia) entra en el inventario de datos personales: se exporta, se audita y se borra igual que el resto.
- **Lotes fuera de hora.** Los trabajos tienen clase (`interactive`, `maintenance` o `batch`). La práctica periódica y la investigación van como `batch`, con ventana horaria y seguimiento de lotes del proveedor, separado del worker interactivo.
- **Conocimiento versionado.** Cada generación guarda el hash y la revisión de los `data/profiles/*.md` aprobados que usó, así se puede explicar por qué una adaptación vieja aplicó cierta regla.

## Decisiones tomadas

| Tema | Decisión | Por qué |
|---|---|---|
| Hosting | Netlify, con el adaptador oficial de Next.js, funciones en `gru` (São Paulo) | Decisión del equipo. Su documentación declara soporte de `after()` y Cache Components; se prueba en T0.6. |
| Base de datos | Supabase Postgres en `sa-east-1`, con PITR en producción | Postgres administrado con RLS, Auth, Storage y Cron, cerca de Uruguay. |
| Cuentas | Supabase Auth con `@supabase/ssr`, con alta pública desactivada | Todas las cuentas las crea el servidor: invitación o aprovisionamiento. |
| Estudiantes sin email | Entran con código de institución, usuario y contraseña. Por detrás, un email sintético global, `<student_id>@estudiantes.usetiza.app`, de un subdominio propio que no recibe correo | Supabase Auth necesita un email único; muchos estudiantes son menores sin email. |
| Autoridad de permisos | La base. RLS en lecturas no sensibles. Todas las escrituras y todas las lecturas sensibles van por RPC que autorizan con la sesión | Nadie escribe ni lee datos de salud salteándose las reglas, ni siquiera por la Data API. |
| Acceso a datos | `supabase-js` con tipos generados | Tipos de punta a punta. Las RPC hacen atómico lo que `supabase-js` no puede. |
| Ejercicios | Tabla propia (`version_exercises`) con id estable y `revision` por ejercicio | Dos trabajos o dos ediciones de ejercicios distintos nunca se pisan. |
| Migraciones | Supabase CLI. Una sola autoridad: CI aplica a staging y producción, y recién después publica Netlify el mismo commit | Netlify no puede publicar código contra una base que todavía no tiene la migración. |
| Archivos | Storage privado, sin acceso directo para ningún usuario. Se sube con URL firmada sobre un archivo reservado y se lee con URL firmada que emite el servidor después de autorizar | Una sola puerta, auditable, para archivos que pueden ser consentimientos firmados. |
| Trabajos largos | Tabla `jobs`, un trabajo por invocación del worker, un despachador que llena las plazas libres y Supabase Cron como respaldo | Netlify corta las funciones a los 60 s. |
| Generación | Generaciones con entradas guardadas tal cual y vigencia por recurso. Un trabajo por ejercicio | Cada llamada entra en el tiempo, un error se reintenta solo, y se edita o regenera un ejercicio sin afectar a los demás. Pasa por una prueba de calidad antes (T3.0). |
| Gasto de IA | Reserva conservadora por intento de proveedor, en toda llamada paga (también dictado, comandos y voz), con concurrencia por institución y global | El tope es duro aunque cien trabajos arranquen a la vez o una respuesta se pierda. |
| Entregas | Asignación por práctico y estudiante, con intentos. Cada intento apunta a una publicación inmutable y a la revisión de la clave con que se corrige | Las respuestas y la corrección siempre corresponden al enunciado que el estudiante vio. |
| Avance en pantalla | Polling cada 2 s a una Route Handler mientras haya trabajos activos | Next encola las Server Actions de un mismo cliente. |
| IA | Anthropic directo y OpenRouter de respaldo, detrás de `AiProvider` | No se cambia de proveedor. La interfaz permite la demo y los tests sin IA real. |
| Límites de intentos | Tabla en Postgres con una RPC atómica. Se va Upstash | Un proveedor menos. |
| Demo | Institución sandbox por visitante, que vence a las 24 h, con la IA del fixture | La demo usa el mismo código que la app real. |
| Accesibilidad | WCAG 2.2 AA como criterio de aceptación de cada flujo, no solo axe | Lo pide `CLAUDE.md` y la usan estudiantes con discapacidad. |
| Pruebas | Vitest (unidad e integración contra Supabase local), pgTAP y Playwright | Cada capa se prueba con la herramienta que mejor la cubre. |

## Decisiones a confirmar

Cada una tiene un valor por defecto. Si nadie dice lo contrario, se sigue con ese valor.

- **Planes.** Netlify Pro (región `gru`). Supabase Pro con PITR en producción, Free en staging.
- **Previews.** Si se contrata Supabase Branching, cada preview de una rama con migraciones tiene su base. Sin Branching, esas ramas no generan preview: se prueban en CI con Supabase local.
- **Respaldos.** Por defecto:
  - PITR de 7 días en producción. Con PITR prendido, Supabase deja de tomar los backups diarios: no se cuentan como un respaldo aparte;
  - un `pg_dump` cifrado por semana a Cloudflare R2, que se guarda 30 días. Si hace falta una copia lógica diaria, se programa aparte;
  - una foto diaria de los buckets con manifiesto y hashes, en prefijos que no se sobrescriben, también 30 días.
- **Errores en producción.** Sentry con su integración de Netlify.
- **Email.** Resend como SMTP de Supabase Auth.
- **Captcha en «Probar la demo».** Cloudflare Turnstile.
- **Importar desde GURÚ o CREA.** Cualquier planilla con una columna de nombre, hasta que Producto confirme las columnas.
- **Consentimiento.** Por defecto:
  - es por finalidad: adaptar con IA, dictado con IA y análisis con IA;
  - sin consentimiento para adaptar, el estudiante recibe el original, marcado para el profe;
  - sin consentimiento para dictado, no ve el dictado, y se chequea cada vez que abre la tarea.
  - el dictado del navegador (Web Speech) también manda audio a un tercero: pide el mismo consentimiento antes de prender el micrófono. Sin él, el estudiante escribe o elige, nunca se queda sin forma de responder.
  - guardar el perfil (dato de salud) es una finalidad aparte de las de IA, con su propio consentimiento expreso y por escrito.
  
  Lo definen Producto y la revisión legal.
- **Compuerta legal antes del primer dato real.** Antes de cargar el primer dato de un estudiante real tienen que estar aprobados:
  - la evaluación de impacto (Decreto 64/020, art. 6: datos de menores y de personas con discapacidad);
  - el consentimiento expreso y por escrito para datos sensibles (Ley 18.331, art. 18), y quién lo da por el menor;
  - quién es responsable y quién encargado del tratamiento (la institución y Tiza), y la información que pide el art. 13;
  - las transferencias a cada destino real (Supabase y Netlify en Brasil, Anthropic, OpenRouter, ElevenLabs, el proveedor del dictado del navegador; art. 23).
  
  Esto es T10.6, y ningún dato real entra antes de cerrarlo, aunque las fases 9 y T10.5 ya estén.
- **Retención.** Por defecto:
  - perfiles, notas y consentimientos: mientras esté en la institución y un año más;
  - entregas y notas: tres años;
  - registro de accesos: cinco años;
  - respaldos: 30 días.

## Qué entra y qué no

Entra:

- Base técnica: Supabase, cuentas, permisos, trabajos en segundo plano, pruebas y CI.
- Gestión de grupos: importar estudiantes, editar en lote, página del estudiante, archivar y deshacer, panel del grupo, cierre de año, búsqueda.
- Creación de adaptaciones: borrador que se guarda solo, vista previa de versiones, lado a lado, edición y regeneración por ejercicio, aprobación con checklist, clave de respuestas y rúbrica, versiones desactualizadas, reutilizar.
- Entrega: publicar con fechas, intentos, estado por estudiante, impresión con QR y avisos dentro de la app.
- Colaboración y privacidad: co-docentes, rol de inclusión, consentimientos, registro de accesos, exportar y borrar datos de un estudiante, retención, baja de una institución y panel de la institución.
- Producción: staging, producción, monitoreo, respaldos de base y archivos, revisión de seguridad y salida.

No entra (queda en `docs/ROADMAP.md`, con sus datos ya previstos):

- El motor que aprende, la versión por estudiante, la gamificación nueva, la práctica periódica, el agente investigador y la vista de evolución.
- Pasar la IA a Amazon Bedrock. El README se actualiza en T0.7 con Netlify y Supabase.
- Exportar a Word. La impresión del navegador ya da un PDF.
- Integración en vivo con CREA o GURÚ.
- App móvil nativa y cobros.

## Arquitectura

### Capas

Cada capa solo importa de las que están debajo. ESLint lo hace cumplir (T0.2).

| Capa | Dónde | Qué hace | Qué no hace |
|---|---|---|---|
| Páginas y componentes | `app/`, `components/` | Mostrar y capturar. Los Server Components leen llamando a servicios; los Client Components mutan con Server Actions | No tienen reglas de negocio ni consultas |
| Entradas al servidor | `app/**/actions.ts`, `app/api/**/route.ts` | Validar la entrada con zod, llamar a un servicio, traducir el resultado | No tienen lógica: cada una ocupa unas pocas líneas |
| Servicios | `lib/server/services/` | Casos de uso: orquestar repos, trabajos, Auth Admin y Storage, y convertir errores en mensajes | No deciden permisos por su cuenta: la autoridad es la base |
| Repos | `lib/server/repos/` (con la sesión del usuario) y `lib/server/repos/admin/` (con la clave secreta) | El único lugar que habla con Supabase. Una función por consulta o RPC, y devuelve tipos del dominio | No arman reglas de negocio |
| Base | `supabase/migrations/` | Tablas, RLS, privilegios, RPC y triggers. Acá viven los permisos | |
| Dominio | `lib/domain/` | Tipos, esquemas zod y reglas puras: armar versiones, notas, chequeo de números, parsear listas, la matriz de permisos para la UI | No hace IO ni usa React, Next o Supabase |
| IA | `lib/server/ai/` | Proveedores, presupuesto, prompts y esquemas por materia (lo que hoy está en `lib/agent/`) | No sabe de la base ni de quién es el estudiante |

Reglas de dependencia que chequea ESLint:

- `components/**` y `lib/client/**` no importan `lib/server/**`, y todo `lib/server/**` arranca con `import "server-only"`.
- `lib/domain/**` no importa `next`, `react`, `@supabase/*`, `lib/server/**` ni `lib/client/**`.
- `lib/server/db/client.ts` solo lo importan `lib/server/repos/*.ts`. `lib/server/db/admin.ts` solo lo importan `lib/server/repos/admin/**` y `tests/**`.
- `lib/server/repos/admin/**` solo lo importan `lib/server/jobs/**` y `lib/server/services/admin/**`.
- `app/**` importa servicios, nunca repos.

### Carpetas

```
supabase/
  migrations/          SQL versionado; nunca se edita una migración ya mergeada
  tests/               pgTAP: RLS, privilegios, RPC, triggers y concurrencia
  seed.sql             datos para desarrollo local
lib/
  domain/              tipos y reglas puras, por tema (groups/, assessments/, students/, grading/, permissions/)
  server/
    db/                client.ts (sesión del usuario), admin.ts (clave secreta) y tipos generados
    repos/             un archivo por tabla o agregado; admin/ para los privilegiados
    services/          un archivo por caso de uso o grupo chico de casos; admin/ para lo privilegiado
    auth/              getActor()
    jobs/              enqueue, dispatch, worker, handlers/ (uno por tipo de trabajo)
    ai/                proveedores, presupuesto, subjects/<id>/ (prompt, notación, errores, verificadores)
    storage/           reservar, firmar, confirmar y leer archivos
    log.ts             logger estructurado
  client/              hooks de cliente (polling, deshacer, borrador) y helpers de formularios
  errors.ts            AppError y Result, compartidos
app/                   rutas; actions.ts al lado de la página que lo usa
components/            UI por tema; components/ui/ para piezas genéricas
tests/
  integration/         Vitest contra Supabase local
  e2e/                 Playwright
  factories/           crear institución, usuarios y clientes logueados para tests
```

### Reglas de código

Tamaños, chequeados por ESLint:

| Qué | Máximo |
|---|---|
| Archivo | 200 líneas |
| Componente | 150 líneas |
| Función | 40 líneas, sin contar comentarios y líneas en blanco |
| Complejidad ciclomática | 10 |
| Anidamiento | 3 niveles |
| Parámetros | 3; con más, un objeto |

- Los archivos de hoy que pasan el límite van en una lista de excepciones que solo achica. El ticket que toca uno de esos archivos lo parte.
- Un componente por archivo, con el mismo nombre. Los hooks van en `useAlgo.ts`.
- Exports con nombre. `export default` solo donde Next lo pide.
- TypeScript estricto. `noUncheckedIndexedAccess` se adopta de a poco: rige para el código nuevo (`lib/errors.ts`, `lib/domain`, `lib/server`, `lib/client`, `tests` y sus pruebas) por `tsconfig.strict.json`, y `npm run typecheck` corre los dos chequeos. Prenderlo en todo el repo daba unos 600 errores en archivos que se van a reescribir. El código nuevo no importa código viejo (regla de ESLint), porque lo importado entraría al chequeo estricto; para reutilizar algo viejo, se mueve a la capa nueva. Nada de `any` ni de `as` para tapar errores de tipos.
- zod en todo borde: el input de Server Actions y Route Handlers, la salida de la IA, el `jsonb` que se lee de la base y la respuesta de cada RPC.
- Errores esperados: `AppError(code, mensaje)`, con `code` en `NOT_FOUND | FORBIDDEN | INVALID | CONFLICT | RATE_LIMITED | UNAVAILABLE`. Las RPC levantan excepciones con esos códigos y el repo las traduce.
- `defineAction(schema, handler)` y `defineRoute(schema, handler)` envuelven todo. Devuelven `Result<T>`, loguean lo inesperado con un id de pedido y muestran un mensaje genérico. Una Server Action vieja después de un deploy no llega a `defineAction`: Next la rechaza antes. Por eso lo resuelve el cliente: `callAction` (`lib/client/`) la reconoce y la convierte en «Se actualizó Tiza. Recargá la página.». El formulario guarda su borrador antes de ofrecer recargar, así no se pierde lo escrito. Se prueba entre dos builds reales en la fase 4.
- Concurrencia: las filas editables tienen `revision`. Toda edición manda la que leyó. Si cambió, la respuesta es `CONFLICT` con «Alguien cambió esto mientras lo editabas. Recargá para ver lo último.».
- Fechas en `timestamptz` UTC. Se muestran en `America/Montevideo`, que también define el «día» de los topes.
- La UI va en español rioplatense. El código, los nombres y los comentarios, en inglés, como hoy. Los comentarios explican el porqué.
- No entra una dependencia nueva sin que el ticket la nombre.
- Las Server Actions aceptan hasta 1 MB. Lo que pueda pasar de eso va a Storage, o se manda en partes.
- Ningún texto fijo de una materia en el código nuevo: la materia es un parámetro.

### Seguridad y aislamiento

**Privilegios.**

- La primera migración revoca lo que Postgres y Supabase conceden por defecto:
  - `ALTER DEFAULT PRIVILEGES … REVOKE ALL` sobre tablas, secuencias y funciones a `anon`, `authenticated` **y `PUBLIC`**, para cada rol que crea objetos (`postgres` y `supabase_admin`);
  - lo ya concedido a esos roles.
  
  Cada migración concede solo lo que nombra.
- `authenticated` recibe `SELECT` solo en tablas y columnas no sensibles, filtrado por RLS, y `EXECUTE` en las RPC públicas. Ninguna escritura directa.
- **RPC públicas.** Son `security definer`, con `search_path = ''`. El actor y la hora salen siempre de `auth.uid()` y `now()`. La institución sale del recurso (un grupo, un práctico) o, si la operación es de la institución (crear un grupo), se recibe como selector y se valida contra las membresías del actor.
- **RPC internas.** Las de jobs, presupuesto, purga y aprovisionamiento solo se conceden a `service_role`. Cuando un usuario necesita una de esas operaciones (por ejemplo, cancelar una generación), hay una RPC pública que autoriza y después llama a la interna.
- Todo efecto en Auth o Storage parte de una intención guardada antes por una RPC autorizada: la fila de aprovisionamiento, la reserva del archivo, el sandbox. El código privilegiado ejecuta intenciones; nunca actúa sobre un id que manda el navegador.
- **Pruebas de privilegios.** pgTAP revisa los privilegios efectivos y falla si:
  - alguna tabla no tiene RLS;
  - `anon`, `authenticated` o `PUBLIC` pueden escribir o ejecutar algo interno;
  - una función `security definer` no fija `search_path`.
  
  Además, cada RPC interna se llama como `anon` y como `authenticated` esperando el rechazo.

**Aislamiento.**

- Toda tabla institucional tiene `institution_id`, y los padres tienen `UNIQUE (id, institution_id)`. Las hijas usan FK compuesta.
- `app_users` es global: la pertenencia va en `memberships`, y una profe puede estar en varios colegios.
- Triggers verifican, dentro de la institución, que un estudiante asignado a una versión esté inscripto en el grupo del práctico.
- Las políticas se escriben sobre conjuntos: joins a `memberships` y `group_staff`, con índices en `(user_id, institution_id)` y `(user_id, group_id)`. No se asume que una función por fila se evalúe una sola vez. Los planes se miden con datos de tamaño real en T10.5 (200 grupos y 6000 estudiantes por institución).

**Datos sensibles.**

- **La sensibilidad es por campo, no por tabla.** Son sensibles:
  - los perfiles, apoyos e intereses, estén donde estén: `student_needs`, sus eventos, la configuración de `versions`, `version_recipients` (que junto con la configuración revela el perfil) y las entradas guardadas de `generations`;
  - las notas privadas, los consentimientos y el registro de accesos.
- Ninguno de esos campos tiene `SELECT` directo. Se leen con RPC que devuelven lo que el rol puede ver y registran en `audit_log` a qué estudiantes se les mostraron datos sensibles.
- **El registro es por divulgación.** Una fila por pedido con el conjunto de estudiantes, sin duplicar dentro del mismo pedido. Esas lecturas no se cachean en el servidor.
- **Listados sin datos sensibles.** Los listados que no necesitan el perfil (grupos, prácticos, estado de versiones) usan proyecciones sin esos campos, paginadas.
- Una prueba intenta reconstruir un perfil combinando todas las tablas legibles por un profe, y espera que no se pueda sin pasar por una lectura auditada.

**Lo que ve el estudiante.**

No tiene `SELECT` sobre ninguna tabla de versiones, generaciones, claves ni perfiles. Lee por RPC, con un DTO por contexto:

| DTO | Contexto | Contiene |
|---|---|---|
| `StudentHome` | Al entrar | Su nombre, sus grupos y `interface`: `standard`, `gaze` o `voice`. Reemplaza lo que hoy `StudentGaze` y `StudentVoice` deducen de `student.profiles` |
| `StudentTaskList` | Mis tareas | Título, fechas y estado de cada asignación |
| `StudentTask` | Al resolver | Ejercicios con id y texto, preguntas sin la opción correcta, `answer_mode`, `aids` (por ejemplo `{ readAloud: true }`) y el borrador guardado (respuestas, elecciones y su `revision`) |
| `StudentGrades` | Mis calificaciones | Nota, devolución y resultado por ejercicio de los intentos corregidos |

- `interface`, `answer_mode` y `aids` se calculan en el servidor y no nombran perfiles. El consentimiento de dictado se chequea en cada lectura: sin consentimiento, `voice` pasa a `typed`.
- **Prueba de fugas.** Cada DTO tiene una lista de claves permitidas, y la prueba recorre de forma recursiva el JSON y el payload RSC que reciben las pantallas del estudiante. Falla si aparece una clave fuera de la lista, la opción correcta, un perfil o un id de otro estudiante. Las respuestas del propio estudiante sí pueden ir.
- **Consumidores.** Cambian: `lib/solve/steps.ts`, `SolveAssessment`, `StudentGaze`, `StudentVoice`, `MyAssignments`, `MyGrades` y `GazeAssignments`. `Question` se parte en `StudentQuestion` (sin `answer`) y `QuestionKey`.

**Lo demás.**

- **A la IA nunca le llegan nombres ni ids de estudiantes.** Solo ejercicios, perfiles, apoyos e intereses agregados. El análisis usa seudónimos (E1, E2), y el mapeo queda en el servidor junto al resultado.
- Toda Server Action y Route Handler vuelve a leer la sesión. El `proxy.ts` solo refresca la cookie y redirige rápido.
- Las acciones destructivas archivan; el borrado definitivo es una acción aparte del admin. Las claves de caché y los tags llevan ids, nunca datos personales.
- Sacar a un profe de una institución revoca su membresía y cierra sus sesiones con la API de administración.

### Modelo de datos

Las tablas tienen `id uuid` y `created_at`, y las editables, `updated_at` y `revision`. Todas tienen `institution_id`, salvo las globales.

**Identidad y pertenencia**

| Tabla | Qué guarda |
|---|---|
| `institutions` (global) | Nombre, código corto para el login, `kind` (`school` o `sandbox`), `expires_at` y `owner_user_id` (sandbox) |
| `app_users` (global) | Uno por cuenta de Auth: nombre visible |
| `memberships` | Usuario, institución y rol (`admin`, `teacher`, `inclusion` o `student`) |
| `invitations` | Email, rol, hash del token, estado y vencimiento |
| `account_provisioning` | Una fila por cuenta de estudiante: estado (`pending`, `active`, `failed` o `deleted`), intentos e id de Auth |
| `student_pseudonyms` | El seudónimo de cada estudiante. Feedback y eventos usan el seudónimo. Borrar esta fila no alcanza para anonimizar: el texto libre, las fechas y las combinaciones raras pueden identificar, así que lo que queda se trata como dato personal salvo que el inventario diga, campo por campo, que se borró o se redactó |

**Grupos y estudiantes**

| Tabla | Qué guarda |
|---|---|
| `subjects` (global) | Materias habilitadas (`math` hoy; `physics` y `chemistry` después) |
| `groups` | Nombre, `subject_id`, año lectivo y `archived_at` |
| `group_staff` | Profes del grupo: `owner` o `co_teacher` |
| `students` | Nombre visible, usuario (único por institución), `user_id` y `archived_at` |
| `enrollments` | Estudiante en grupo, con `started_at` y `ended_at`. Una sola activa por grupo y estudiante |
| `student_needs` | Perfiles, apoyos, intereses, fecha de revisión y `revision` |
| `student_need_events` | Historial de cambios del perfil |
| `student_notes` | Notas privadas del profe |
| `consents` | Estudiante, finalidad, versión del texto, estado, vigencia, `revoked_at`, archivo y quién lo cargó |

**Prácticos, versiones y generaciones**

| Tabla | Qué guarda |
|---|---|
| `files` | Bucket, ruta inmutable, finalidad, la entidad dueña (FK según la finalidad), tamaño y tipo comprobados y estado (`reserved`, `ready` o `rejected`) |
| `syllabi` | Programa del grupo: unidades con id estable (los temas), PDF y `revision` |
| `assessments` | Tipo, tema, `subject_id`, instrucciones generales (lo que va antes del primer ejercicio, como «Elegí dos y justificá»), estado (`draft`, `ready`, `published` o `archived`), `publish_at`, `due_at`, `source_id` y `revision` |
| `assessment_exercises` | Ejercicios del original: id estable, número, orden, texto, `topic_id` opcional y `revision` |
| `versions` | Configuración (perfiles, apoyos, intereses, `keep`), estado, `stale`, `base_version_id`, `current_generation_id` (la generación completa vigente), `revision` y la revisión aprobada |
| `version_exercises` | Ejercicio adaptado: id del ejercicio original, texto, cambios, `revision`, `current_generation_id` (vigente para ese ejercicio) y estado |
| `version_questions` | Preguntas de mirada sin la respuesta, por id |
| `question_keys` | La opción correcta de cada pregunta. Solo la leen el profe y la corrección |
| `version_recipients` | Estudiante, versión, `valid_from` y `valid_to`. Así se sabe para quién era cada versión en cada momento |
| `generations` | Tipo (`version`, `exercise` o `answer_key`), recurso objetivo, revisión objetivo, `op_key` (ver «Idempotencia»), entradas guardadas tal cual (ejercicios, configuración, programa, `subject_id`, hash y revisión de los perfiles aprobados, versión del prompt), trabajos requeridos y estado (`running`, `done`, `failed`, `cancelled` o `superseded`) |
| `operations` | Las operaciones con partes que no son una versión: leer un documento, leer el programa y analizar un grupo. Tipo, recurso, `op_key`, las partes requeridas (fijas al crearla), estado (`running`, `merging`, `done`, `failed` o `cancelled`) y el resultado del merge |
| `generation_outputs` | La salida de la IA de cada ejercicio, tal cual llegó y antes de cualquier edición |
| `version_events` | Solo agrega. Id propio y `op_id` único por operación. Tipos: `generated`, `edited` (con la revisión y el texto), `approved` (de una revisión concreta), `rejected` (con motivos), `regenerated` (con la instrucción) y `recipients_changed`. Única solo la combinación `generated` y `generation_id` |
| `answer_keys` | Clave de respuestas y rúbrica por versión, con su generación vigente y su aprobación |
| `answer_key_revisions` | Solo agrega. Cada revisión de la clave, inmutable, atada a la revisión de los ejercicios y a los ids de pregunta con que se generó o editó. Los intentos apuntan acá |

**Entrega y resultados**

| Tabla | Qué guarda |
|---|---|
| `publications` | Copia inmutable de una revisión aprobada: ejercicios, preguntas sin respuesta, `answer_mode` y `aids`. Con `published_at` y `withdrawn_at` |
| `assignments` | Una por práctico y estudiante, con su estado general |
| `assignment_attempts` | Cada intento: publicación, revisión de la clave con que se corrige, estado (`opened`, `started` o `submitted`) y fechas |
| `submissions` | Por intento: respuestas por id de ejercicio, elecciones por id de pregunta, `revision` del borrador y `submitted_at` |
| `grades` | Por intento: nota, devolución, resultado por id de ejercicio y quién corrigió |
| `group_analyses` | Resultado, mapeo de seudónimos, hash de entradas y versión del analizador |
| `feedback_events` | Solo agrega: seudónimo, tipo, referencia (publicación, ejercicio) y datos. Para el feedback del estudiante y las señales de uso del roadmap |

**Lo demás**

| Tabla | Qué guarda |
|---|---|
| `presets` | Configuraciones guardadas por el profe |
| `notifications` | Avisos dentro de la app, con `read_at` |
| `jobs` y `job_schedule` | Ver «Trabajos en segundo plano» |
| `batch_runs` | Lotes enviados a un proveedor (práctica periódica e investigación, más adelante), con su id externo |
| `ai_budgets`, `ai_reservations` y `ai_usage` | Tope diario, reservas por intento de proveedor y uso real. Sin datos de estudiantes |
| `audit_log` | Quién vio o cambió datos sensibles: actor, acción, entidad, estudiantes y fecha |
| `erasures` | Registro de supresiones (seudónimo y fecha, sin datos personales). Tiene una copia fuera de la base, que una restauración no puede volver atrás (ver «Respaldos») |
| `sandbox_sessions` | Sesión guardada del profe anónimo mientras mira como Paula |
| `rate_limits` | Contadores por clave y ventana |
| `import_runs` | Importaciones desde el navegador, con el mapeo de ids |

**Formato.** El original y cada versión son unas instrucciones generales y una lista de ejercicios con id estable. El texto entero desaparece. Las respuestas, la corrección y los eventos apuntan a ids, no a posiciones. El parser de hoy (`lib/results/exercises.ts`) parte los originales, pero descarta lo que va antes del primer ejercicio: el parser nuevo lo guarda como instrucciones generales. El profe confirma el corte en «Lo que leyó la IA» sin perder texto. Las instrucciones viajan en la versión, la publicación, la revisión del profe y la impresión.

**Orden de locks.** Toda operación que toca una versión toma los locks siempre en el mismo orden: la fila de `versions`, después la de `generations` y después las de `version_exercises`, por id. Así lo hacen iniciar, cancelar, editar, aprobar y completar.

**Vigencia.**

- Una versión tiene a lo sumo una generación `version` activa. Pedir una nueva reemplaza la anterior (`superseded`) y también las de ejercicio activas.
- Regenerar ejercicios distintos convive. Regenerar el mismo ejercicio reemplaza la generación anterior de ese ejercicio.
- La clave tiene su propia vigencia, y generarla no toca la de la adaptación.
- Un resultado escribe solo si su generación es la vigente de su recurso y la `revision` del ejercicio es la que la generación esperaba. Una edición manual a mitad de camino gana, y el resultado queda como `generation_outputs` sin aplicar, visible para el profe.
- **Estados terminales.** `done`, `failed`, `cancelled` y `superseded` no se reabren. Al llegar a uno, la generación cancela sus trabajos pendientes. Todo cambio de estado del recurso (`ready`, `error`) exige que esa generación siga siendo la vigente: un trabajo que sobrevive a una generación ya cerrada guarda su salida como `obsolete` y no toca el recurso.

**Aprobar y publicar.**

- **Aprobar.** Se aprueba una revisión concreta de la versión. Cualquier cambio posterior (texto, preguntas, destinatarios) deja la versión sin aprobar. Una versión compartida vuelve a aprobarse si cambia.
- **Publicar.** `publish_version` verifica, en una transacción:
  - que la revisión vigente esté aprobada;
  - que estén las partes que su `answer_mode` necesita (preguntas, si es mirada) y que ninguna esté desactualizada respecto de esa revisión;
  - que la revisión de la clave corresponda a la revisión aprobada de los ejercicios y a sus ids de pregunta. Si cambia un ejercicio, su clave queda desactualizada y hay que regenerarla o confirmarla antes de publicar;
  - el consentimiento de cada destinatario;
  - las fechas.
  
  Copia la revisión a `publications` y crea los intentos, cada uno atado a esa publicación y a esa revisión de la clave.
- **Qué clave hace falta.** En mirada, la opción correcta de cada pregunta es obligatoria. En escritura y dictado, la clave es opcional hasta la fase 7: la publicación mínima de la fase 4 no depende de la rúbrica, y el profe corrige a mano.
- **Volver a publicar después de corregir.**
  - Un intento sin empezar pasa a la publicación nueva.
  - Uno empezado sigue con la vieja. El profe puede reasignar: eso crea un intento nuevo y deja el viejo guardado, con sus respuestas.
  - Publicar y empezar bloquean la misma fila de `assignments`, así no se cruzan.

Qué se puede hacer con cada intento:

| Situación | Leer | Guardar borrador | Entregar | Corregir |
|---|---|---|---|---|
| Antes de `publish_at` | No | No | No | No |
| Publicado y en fecha, sin entregar | Sí | Sí | Sí | No |
| Después de `due_at`, sin entregar | Sí | Sí | Sí, marcada tarde | No |
| Entregado | Sí, solo lectura | No | No (repetir no hace nada) | Sí |
| Publicación retirada | Solo lo entregado | No | No | Sí, lo entregado |
| Intento reemplazado | Solo lo entregado | No | No | Sí, lo entregado |

- Cada guardado del borrador valida que los ids de ejercicio y pregunta sean de su publicación, y manda la `revision` del borrador.
- **Entregar** manda la `revision` del borrador que el estudiante vio guardada. Si el servidor tiene una más nueva (otra pestaña), responde `CONFLICT` y muestra lo último antes de entregar. Entregar congela las respuestas y es idempotente: dos clics entregan una vez.
- Hoy `updateSubmission` (`lib/groups/store.ts`) ya rechaza cambios después de entregar; la base mantiene esa garantía.

### Trabajos en segundo plano

Toda llamada a la IA que pueda tardar más de 20 s es un trabajo. El resto tiene un tope explícito y pasa igual por el presupuesto.

| Hoy | Cómo queda |
|---|---|
| `/api/generate` | Trabajos `generate_exercise` y `generate_gaze_questions` |
| `/api/assessments/read-pdf` (300 s) | `read_page` por página o foto, y `merge_document` al final |
| `/api/syllabus/units` (300 s) | `extract_syllabus_part` por bloque de páginas, y `merge_syllabus` |
| `/api/results/analyze` (120 s) | `analyze_group_part` por bloque de estudiantes, y `summarize_analysis` |
| `/api/answers/transcribe` | Sincrónica, hasta 20 s, audio limitado |
| `/api/voice/command` | Sincrónica, hasta 10 s |
| `/api/tts` | Sincrónica, hasta 20 s, texto limitado |
| `/api/syllabus/pdf` | Desaparece: el PDF va a Storage |

- **Dividir en partes.** Cada parte tiene límites verificables (páginas, caracteres de entrada, tokens de salida) que la hacen entrar en 40 s. T3.0 mide la latencia real de cada tipo con documentos de tamaño real. Si una operación no se puede partir y no entra, se ejecuta en una Background Function de Netlify (si el plan la incluye) y se reescribe su fila de esta tabla.
- **Mantenimiento.** Además hay `regenerate_exercise`, `answer_key`, `purge_sandboxes`, `purge_orphan_anonymous`, `cleanup_files`, `reconcile_accounts`, `expire_reservations` y `apply_retention`.

**La tabla `jobs`** guarda:

- `kind`, `class` (`interactive`, `maintenance` o `batch`), `payload` (solo ids), `status` (`queued`, `running`, `done`, `failed` o `cancelled`) y `outcome` (`applied`, `obsolete` o `discarded`);
- `attempts`, `max_attempts`, `run_after`, `locked_until`, `lock_token` y `last_error`;
- `idempotency_key`, `institution_id`, `generation_id`, `created_by` y `finished_at`.

`job_schedule` guarda, por institución, cuándo se le reclamó un trabajo por última vez.

**Máquina de estados.** Es la misma para todos los tipos, y solo la implementan RPC internas. El SQL exacto va en el contrato de la fase 3.

- **Reclamar (`claim_job`).**
  - Se serializa con un advisory lock de transacción global, así el conteo de plazas es exacto. Reclamar dura milisegundos, así que el lock global no es un cuello de botella.
  - Cuenta como ocupado solo un trabajo en `running` con el lock vigente.
  - Un trabajo con el lock vencido se recupera primero, sin necesitar una plaza nueva: vuelve a `running` con lock nuevo si le quedan intentos, o pasa a `failed` («Se cortó tres veces»).
  - Después elige entre los listos:
    - respeta 4 plazas por institución, 20 en total, y 2 reservadas para `maintenance`;
    - toma primero la institución reclamada hace más tiempo (`job_schedule`).
  - El trabajo elegido pasa a `running`, con `attempts + 1`, un `lock_token` nuevo y `locked_until = now() + 90 s`.
- **Aplazar (`defer_job`).** Sin presupuesto, o fuera de su ventana horaria, el trabajo vuelve a `queued` con un `run_after` nuevo, y el intento se devuelve.
- **Terminar o fallar.** `complete_job` y `fail_job` exigen `running` y el `lock_token` vigente; si no, no escriben nada.
  - Un fallo reintentable vuelve a `queued` con espera de 30 s, 2 min y 8 min, más un ±20% al azar.
  - Uno no reintentable, o el último intento, pasa a `failed`.
- **Efecto en la generación.** Con el lock de su generación tomado, y solo si la generación sigue en `running`:
  - **Éxito.** Escribe el resultado si sigue vigente (`applied`) o lo guarda sin aplicar (`obsolete`).
  - **Fallo terminal.** Pasa la generación a `failed`, cancela sus trabajos hermanos pendientes y pasa el ejercicio o la versión a `error` con el mensaje para el profe, si esa generación sigue siendo la vigente del recurso.
  - **Cancelar o reemplazar.** Pasa los trabajos pendientes a `cancelled` y borra sus tokens.
  - **Cierre.** Cuando terminan todos los trabajos requeridos, la generación pasa a `done` y su recurso a `ready` una sola vez, con un único evento `generated`, si sigue siendo la vigente.
  - **Reservas.** Fallar, cancelar o reemplazar libera solo las reservas de intentos que nunca se enviaron. Una reserva `uncertain` no se libera nunca por estos caminos (ver «Presupuesto»).
  - **Generación ya cerrada.** Un trabajo que termina cuando su generación ya está en un estado terminal guarda la salida como `obsolete` y no toca ni la generación ni el recurso.
- **Operaciones con partes** (`operations`: leer un documento, leer el programa, analizar un grupo). Siguen la misma máquina. Las partes requeridas se fijan al crear la operación. El merge se encola una sola vez, cuando todas las partes terminaron bien, y consume exactamente ese conjunto. Si una parte falla del todo, la operación pasa a `failed` y cancela las que quedan.
  
  `/progress` no cuenta como activo ningún trabajo en estado terminal.
- **Pruebas.** pgTAP con conexiones simultáneas:
  - el mismo trabajo reclamado dos veces;
  - plazas llenas a nivel institución y global;
  - la recuperación con las plazas llenas;
  - el lock vencido en el último intento;
  - los dos últimos ejercicios que terminan juntos;
  - la cancelación con un resultado tardío;
  - dos regeneraciones de ejercicios distintos;
  - una regeneración y una clave al mismo tiempo;
  - un fallo terminal con un trabajo hermano que termina después;
  - el merge de una operación con dos partes que terminan juntas.

**Idempotencia.** Hay dos niveles:

- **La operación.** El navegador manda un `op_key` (uuid) al pedir generar, regenerar, leer o analizar. La base lo hace único por institución y recurso, y lo guarda en `generations` u `operations` antes de crear nada. Un doble clic manda el mismo `op_key` y encuentra la misma generación. «Reintentar» manda uno nuevo.
- **El trabajo.** Dentro de una operación, cada trabajo tiene su clave: `gen:<generation_id>:<exercise_id>`, `key:<generation_id>`, `part:<operation_id>:<n>` y `merge:<operation_id>`.
- **El análisis.** Su identidad incluye la institución, el grupo, el hash de las entradas, la versión del analizador y la foto de qué seudónimo es cada estudiante (`lib/results/analyze.ts` los asigna hoy por posición). Esa foto no viaja a la IA. Si cambia la lista del grupo, es otro análisis.

**Despachador y worker.**

- **`POST /api/jobs/dispatch`.** Lo protege `JOBS_SECRET` y lo llaman la Server Action que encola y Supabase Cron. Calcula las plazas libres y hace una llamada al worker por plaza, hasta 20.
- **`POST /api/jobs/worker`.** Lo protege `JOBS_SECRET` y toma **un** trabajo con `claim_job`. Lo corre con un plazo global de 50 s, que cubre la descarga, la IA (40 s, con su respaldo), la validación y la escritura. Si no hay trabajo, responde 204.
- **Cron.** Supabase Cron llama al despachador cada 10 s si hay trabajos listos o con el lock vencido (cada minuto si la versión de Postgres no soporta segundos).
- **Monitor.** `pg_net` no espera respuesta, así que un monitor alerta si el trabajo listo más viejo de clase `interactive` pasa de 2 minutos, o si hay trabajos en `failed`.
- **Proxy.** Las rutas de `/api/jobs/` quedan fuera del matcher de `proxy.ts` y autentican dentro del handler.

**Cómo responde el worker.** Lo decide T0.6.

- **Si `after()` corre en Netlify.** El worker responde 202 enseguida y trabaja dentro de `after()`.
- **Si no (plan B).**
  - El worker responde 200 con un stream que manda un espacio cada 5 s, como hace hoy `/api/generate`, y termina al cerrar el trabajo. Así nunca pasa el límite de 40 s para empezar a responder.
  - El despachador y Cron no esperan el cuerpo.
  - Mientras la pantalla de avance está abierta, el navegador del profe llama a `POST /api/jobs/kick` (autenticado y con límite), que solo llama al despachador y respeta la misma política.

**Presupuesto.**

- **Una puerta para toda llamada paga.** `withBudget()` envuelve cada llamada a un proveedor, también el dictado, los comandos de voz y ElevenLabs.
- **Sin reintentos ocultos.** Los clientes del SDK se crean con `maxRetries: 0` (hoy `lib/agent/client.ts` usa el valor por defecto, 2). Cada envío HTTP que se pueda cobrar es un intento con su propia reserva, y los reintentos los decide `withBudget()`, no el SDK.
- **Reserva por intento.** Antes de cada intento reserva una cota conservadora en la unidad de ese proveedor:
  - para un modelo: tokens de entrada contados, más `max_tokens` de salida, al precio del modelo más caro de esa llamada;
  - para ElevenLabs: los caracteres del texto, a su tarifa.
  
  El respaldo por OpenRouter es otro intento con su propia reserva.
- **Concurrencia de lo sincrónico.** Dictado, comandos de voz y lectura en voz alta no pasan por `jobs`, así que tienen su propio tope de llamadas simultáneas por institución, además del presupuesto.
- **Liquidar.** Con la respuesta, liquida con el uso real, de forma idempotente por id de intento.
- **Respuesta perdida.** Si el pedido salió y no hay respuesta, la reserva queda como `uncertain` y se cobra la cota: nunca se libera sola. Un resultado tardío la liquida.
- **El día.** La reserva cuenta en el día en que se creó.
- **Sin presupuesto.** Sin presupuesto, el trabajo se aplaza hasta el día siguiente y el profe ve «Llegaste al tope de hoy».

**Consentimiento.**

- En los trabajos se chequea al encolar y en el worker antes de mandar nada a la IA. Revocarlo cancela, en la misma transacción, las generaciones pendientes que lo necesitaban.
- En las llamadas sincrónicas (dictado, comandos de voz, lectura en voz alta) se chequea en cada llamada, no solo al abrir la tarea: una pestaña abierta después de revocar recibe `FORBIDDEN` y la UI pasa a escribir o elegir.
- Esas rutas tampoco confían en el contenido que manda el navegador. Reciben el id del intento y del ejercicio. El servidor comprueba que el intento sea del estudiante y esté abierto, y lee él mismo el texto que hay que leer o el contexto del comando.

**Lotes (para el roadmap).**

- Los trabajos `batch` tienen ventana horaria y prioridad más baja.
- No usan el worker interactivo para esperar a un proveedor: el envío y la consulta de un lote son trabajos cortos, y el estado del lote vive en `batch_runs`.
- Sus reservas acompañan al lote. Este spec deja el tipo y la tabla; los handlers llegan con el roadmap.

**Avance en pantalla.** `GET /api/assessments/[id]/progress` devuelve el estado de cada versión y ejercicio. `useAssessmentProgress` consulta cada 2 s mientras haya algo activo y para cuando todo termina o la pestaña queda oculta.

### IA

- `lib/agent/` pasa a `lib/server/ai/`.
- **Por materia.** Cada materia tiene su carpeta `subjects/<id>/` con el prompt, la notación, el catálogo de errores y los verificadores. Hoy el `SYSTEM` de `lib/agent/prompt.ts` y el chequeo de números son de Matemática: pasan a `subjects/math/`. El servidor elige la materia por el `subject_id` del práctico, nunca por lo que manda el navegador.
- **Proveedores.** `AiProvider` tiene dos implementaciones: `live` (Anthropic y OpenRouter de respaldo) y `fixture`. Para una institución `sandbox` el proveedor siempre es `fixture`, y lo decide el servidor por el tipo de institución. Los tests también usan `fixture`.
- **Generar un ejercicio.** Va el original completo y el programa en el prefijo cacheado, y se pide adaptar solo el ejercicio N.
- **Nombres dentro del contenido.** Sacar columnas no alcanza: un PDF, una foto, los intereses, una instrucción de regeneración o un dictado pueden traer un nombre («Adaptación para Paula»). Por eso a la IA nunca va el archivo crudo ni texto libre sin pasar por `prepareForProvider()`, que corre en el servidor antes de la primera llamada:
  - quita los nombres de los estudiantes de esa institución y los encabezados típicos (nombre, fecha, grupo), con una redacción local que no usa IA;
  - de un PDF o una foto, solo manda las páginas o el recorte que el profe confirmó;
  - en texto libre (intereses, instrucciones, dictados) aplica la misma redacción, y avisa al profe si quitó algo.
  
  El original queda en Storage, separado de lo que se mandó, y `generations` guarda la versión redactada. La prueba usa documentos con nombres de la lista y comprueba que no llegan al `fixture`.
- **Lo que guarda cada generación.** Las entradas tal cual, el hash y la revisión de los `data/profiles/*.md` aprobados y la versión del prompt. El agente investigador del roadmap va a proponer borradores aparte, que no cambian lo aprobado hasta que lo valide un especialista.

### Archivos

Hay dos buckets privados, `uploads` y `consents`, con límite de tamaño y tipos permitidos en el bucket mismo. La ruta es `<institution_id>/<file_id>` y no cambia nunca.

Storage no tiene políticas para usuarios: nadie lista, lee, sube ni borra directo.

**Subida:**

1. **Reservar.** Una RPC autorizada crea la fila en `files` como `reserved`, con finalidad, dueño y tamaño máximo. El servidor pide la URL de subida firmada, sin sobrescritura, y el navegador sube directo.
2. **Confirmar.** Otra acción, idempotente, comprueba que el objeto existe, su tamaño real y sus primeros bytes (`%PDF`, JPEG, PNG). Si coincide, lo pasa a `ready`; si no, lo borra y lo pasa a `rejected`.
3. **Limpiar.** `cleanup_files` borra las reservas de más de 3 horas y sus objetos.

**Lectura:**

- El servidor autoriza contra la entidad dueña, y para un consentimiento registra el acceso en `audit_log`. Después emite una URL firmada de 5 minutos.
- Solo se usan archivos `ready`.

### Cuentas

**Estudiantes.**

1. Crear un estudiante (una RPC) inserta `students` y `account_provisioning` como `pending`, con un id de operación.
2. El servicio de admin crea la cuenta con el email sintético, `email_confirm: true`, una contraseña inicial y `app_metadata.provisioning_id`, que el usuario no puede cambiar. Guarda el id de Auth y después vincula.
3. **Reintento.** Si el email ya existe, solo vincula si `app_metadata.provisioning_id` coincide. Si no coincide, marca `failed` y alerta.
4. **Reconciliación.** `reconcile_accounts` repara lo que quedó a medias y nunca toca un estudiante en `deleted`. Borrar bloquea la fila del estudiante y deja la marca, así no se recrea la cuenta.

- **Contraseña inicial.** Se muestra una vez en la tarjeta y no se guarda en ningún lado. Si se pierde, el profe genera otra, y queda registrado.
- **Login.** Pide el código de la institución, el usuario y la contraseña, normalizados. El servidor resuelve el email sintético y hace `signInWithPassword`, con límite de intentos.

**Profes.**

- Las invitaciones son de la institución, no de la identidad.
- Aceptar exige que el email de la sesión sea el de la invitación.
- Con una cuenta que ya existe, aceptar suma la membresía. Sin cuenta, el link lleva al alta por invitación y después acepta.
- El token va hasheado y vence a los 7 días.
- La primera institución y su admin los crea el equipo de Tiza con un comando de administración. No hay alta pública.

### Demo

**Crear el sandbox.**

- «Probar la demo» pide Turnstile y hace el login anónimo de Supabase.
- Supabase Auth limita los logins anónimos por IP. La app agrega contadores por IP en `rate_limits`, tomando la IP de la cabecera que pone Netlify y nunca de lo que manda el cliente.
- `create_sandbox()` es idempotente por usuario. Crea una institución `sandbox` que vence a las 24 h, con el grupo, los estudiantes y el práctico de `scripts/demo-fixture.ts`.
- Topes: 1 sandbox por usuario, 5 por IP por día y 500 por día en total.

**Qué se puede hacer adentro.**

- Las restricciones dependen del tipo de institución, no de que la cuenta sea anónima, así valen también para Paula. Dentro de un sandbox no se pueden crear instituciones, invitar, crear cuentas reales ni subir archivos.
- Después de `expires_at`, `app.role_in()` devuelve nulo y no se ve nada.
- La IA responde con el fixture, con las mismas demoras de hoy. El tour (`lib/demo/steps.ts`) sigue anclado a los mismos `data-tour`.

**«Ver como Paula».**

1. **Entrar.**
   1. La acción verifica que quien llama es el dueño anónimo de un sandbox vigente. No acepta ids como parámetro.
   2. Guarda la sesión del profe en `sandbox_sessions`: el refresh token cifrado, ligado al sandbox y al dueño, de un solo uso y con vencimiento. La cookie solo lleva un id opaco.
   3. Un cliente de administración sin sesión persistente genera el `magiclink` de Paula, y el cliente SSR del pedido lo verifica con `verifyOtp` (por `token_hash`), que deja las cookies de Paula.
2. **Volver.** Reclama la fila guardada (sin consumirla), renueva la sesión del profe con `refreshSession({ refresh_token })`, la deja en las cookies SSR y borra las de Paula. Recién con eso hecho consume la fila. Si Auth falla, la fila sigue y se puede reintentar. Solo la pestaña que reclamó puede renovar.
3. **Prueba previa.** Se prueba con dos pestañas y con un refresco en el medio. T4.9 arranca con una prueba corta de este mecanismo; si no anda, se elige otro antes de seguir.

**Purgas.**

- `purge_sandboxes` corre cada hora y borra las instituciones vencidas, sus objetos y sus cuentas de Auth (la anónima y la de Paula).
- `purge_orphan_anonymous` borra las cuentas anónimas de más de una hora que no tienen sandbox.

### Privacidad y operación

- **Antes de guardar datos reales en el servidor**, `/privacidad` y `/terminos` se actualizan: hoy prometen que los datos no salen del navegador. La importación desde el navegador muestra el texto nuevo y pide aceptarlo.
- **Inventario.** `docs/PRIVACIDAD-DATOS.md` lista cada tabla, archivo y derivado con datos de un estudiante, y qué pasa con cada uno al borrarlo. También lista qué recibe cada proveedor y para qué: Supabase, Netlify, Anthropic, OpenRouter, ElevenLabs, Resend, Sentry y Cloudflare. Toda tabla nueva entra al inventario en el mismo ticket que la crea, y una prueba compara el inventario con el esquema.
- **Borrar un estudiante** (admin). Se recorre el inventario:
  - **Se borra:** perfil y su historial, notas, consentimientos, asignaciones, intentos, entregas, notas, archivos, cuenta de Auth, sus entradas en análisis de grupo y los datos que aprenda el motor.
  - **Se desvincula:** el seudónimo. Eso no basta para que lo que queda sea anónimo: el inventario dice, campo por campo, qué se borra, qué se redacta (por ejemplo, una instrucción del profe que nombra al estudiante) y qué se conserva y por qué. Lo que no está justificado como disociado se borra.
  - **Versiones individuales:** se borran, porque siguen siendo atribuibles. Las compartidas se conservan sin él como destinatario.
  - **Registro:** queda una fila en `erasures`, que se copia enseguida fuera de la base (ver «Respaldos»).
  - **Primero la marca.** La baja se marca antes de borrar. Todo efecto pendiente (un trabajo de IA, una subida, un análisis) comprueba la marca al terminar y no escribe nada de esa persona.
- **Exportar** no incluye datos de otros estudiantes: un análisis de grupo sale solo con la parte de ese estudiante.
- **Exportar un estudiante** da un JSON con el mismo recorrido.
- **Baja de una institución.** Exportación completa, después borrado con el mismo procedimiento y cierre de todas las sesiones.
- **Incidentes.** `docs/INCIDENTES.md` dice cómo rotar claves, cerrar sesiones, revisar `audit_log` y a quién avisar.

### Next.js 16 y Netlify

- **Next 16.4.** Antes de escribir código, leer la guía que corresponda en `node_modules/next/dist/docs/`. El middleware se llama `proxy.ts`.
- **`cacheComponents` está activo.** Leer la sesión o datos del pedido fuera de un `<Suspense>` es un error de build, y la sesión no se lee al tope de un layout.
- `getActor()` usa `'use cache: private'`, como en `authentication-with-cache-components.md`.
- **Lecturas sin caché de servidor.** Arrancan sin `use cache`, y las sensibles nunca se cachean en el servidor. Se agrega caché con `cacheTag` (por id) y `updateTag` en las acciones solo donde se mida que hace falta.
- Los links a rutas con parámetros usan `prefetch={true}`, como ya hacen `GroupCard` y `GroupDetail`.
- **Límites de Netlify.** Las funciones cortan a los 60 s, una respuesta que pasa por Edge corta a los 40 s si no empezó, y el cuerpo del pedido a los 6 MB (unos 4,5 MB en binario).
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` queda fija y compartida entre instancias.

### Despliegue y migraciones

- **Una sola autoridad para staging y producción: CI.**
  - Al mergear a `main`, aplica las migraciones a staging, corre las pruebas, aplica a producción y recién entonces publica en Netlify el build de ese mismo checkout, con `netlify deploy --build --prod` desde CI. Un build hook no sirve: construye la punta de la rama, que puede haber avanzado.
  - Antes de publicar, CI comprueba que el SHA del build sea el de las migraciones aplicadas. El flujo de migrar y publicar no se cancela a mitad por un push nuevo: el siguiente espera.
  - La publicación automática de producción en Netlify queda apagada.
  - Dos despliegues no corren a la vez (`concurrency` de GitHub Actions, sin `cancel-in-progress`).
- **Expandir y contraer.** Un cambio incompatible va en cuatro pasos, cada uno en su deploy:
  1. migración que agrega, y código que escribe lo viejo y lo nuevo;
  2. trabajo de backfill;
  3. lectores pasados a lo nuevo;
  4. migración que saca lo viejo.
  
  El cuarto paso va recién cuando ningún código viejo, worker ni rollback posible use lo viejo: como mínimo un día después.
- **Previews.**
  - Con Branching, cada rama con migraciones tiene su base, que Branching migra con su propio flujo y sus credenciales. Las previews nunca apuntan a producción.
  - Sin Branching, una rama con migraciones no genera preview; las demás usan staging.

### Respaldos

- **Base.**
  - PITR en producción: se pierden como mucho minutos de datos y el servicio vuelve en 4 horas.
  - Con PITR, Supabase no toma backups diarios aparte: producción queda con PITR de 7 días y un `pg_dump` cifrado semanal a R2 (30 días).
- **Supresiones.** Cada fila de `erasures` se copia, en la misma acción que borra, a un registro fuera de la base (un objeto en R2 por supresión, sin datos personales). Ese registro cubre la ventana de todos los respaldos restaurables, también la baja de una institución, y una restauración no lo vuelve atrás.
- **Archivos.**
  - Foto diaria de los buckets en R2: un prefijo por día que no se sobrescribe, con manifiesto de ruta, tamaño y hash, guardado 30 días. Se pierde como mucho un día.
  - Un script compara `files` con los objetos de la foto elegida y marca `missing` lo que falta.
- **El runbook** incluye la configuración de Auth, las políticas de Storage, los secretos y los jobs de Cron, que no viven en la base.
- **Al restaurar:**
  1. se pausan Cron y el worker con la bandera `jobs_paused`;
  2. se vuelven a aplicar las supresiones del registro externo, no las de la base restaurada;
  3. se reconcilian los archivos;
  4. se revisan los trabajos en `running`;
  5. recién después se abre el acceso y se reanuda.
- **Simulacro** antes de salir: restaurar en un proyecto aparte y recuperar un consentimiento firmado y un PDF.

## Pruebas

| Tipo | Herramienta | Qué cubre | Dónde |
|---|---|---|---|
| Unidad | Vitest | Todo `lib/domain/`, los esquemas zod y los handlers con la IA en `fixture` | Al lado del código (`*.test.ts`) |
| Integración | Vitest con Supabase local | Servicios y repos con usuarios reales logueados: la RLS y las RPC se ejercitan de verdad | `tests/integration/` |
| Base | pgTAP (`supabase test db`) | RLS de cada tabla, privilegios efectivos, RPC, triggers y concurrencia | `supabase/tests/` |
| Punta a punta | Playwright con build de producción y Supabase local | Los flujos de abajo, en escritorio y celular, con teclado y con axe | `tests/e2e/` |
| IA en vivo | Script opcional `npm run ai:smoke` | Que los prompts sigan devolviendo el formato esperado | Fuera de CI |

Reglas:

- Cada test de integración crea su propia institución con `tests/factories/`.
- **Matriz de permisos.** Vive en `lib/domain/permissions/`, con la fase desde la que rige cada operación. Un test la recorre llamando a las RPC y a la API REST directo, rol por rol: admin, profe del grupo, profe de otro grupo, inclusión, estudiante, anónimo de sandbox y sin sesión. Solo prueba lo ya implementado, y crece en cada fase. La misma matriz decide qué botones muestra la UI.
- **Aislamiento.** Para cada lectura hay una prueba con un usuario de otra institución que espera vacío o `FORBIDDEN`.
- **Fugas y reconstrucción.** La prueba de fugas recorre los DTO del estudiante y la de reconstrucción combina las tablas que puede leer un profe (ver «Seguridad»).
- Ningún test automático llama a la IA real.
- Cobertura mínima del 80% en `lib/domain/` y `lib/server/services/`.

**Accesibilidad.** Cada flujo cumple WCAG 2.2 AA. Además de axe, el ticket que lo toca revisa a mano:

- foco visible y no tapado (2.4.7, 2.4.11);
- login accesible sin pruebas cognitivas: se puede pegar y usar un gestor de contraseñas, y el estudiante tiene el QR de la tarjeta (3.3.8);
- reflow a 320 px y zoom al 200% (1.4.10, 1.4.4);
- alternativa a arrastrar (2.5.7) y objetivos de al menos 24 px (2.5.8);
- errores y estados anunciados al lector de pantalla (3.3.1, 4.1.3);
- que una sesión vencida no pierda lo escrito: el borrador se guarda solo y se recupera al volver a entrar (2.2.6).

La mirada y la voz son formas extra de responder, nunca la única.

Flujos punta a punta, con la fase en que cada uno se vuelve obligatorio:

| Flujo | Desde la fase |
|---|---|
| El camino de la demo de hoy | 0 (hasta que lo reemplaza el siguiente) |
| Demo sobre sandbox: tour completo y «Ver como Paula» | 4 |
| El profe entra, crea un grupo, agrega estudiantes con perfiles y crea un práctico desde un PDF | 4 |
| El profe aprueba y publica (versión mínima). El estudiante entra con su tarjeta, resuelve y entrega. El profe corrige y ve el análisis | 4 |
| Generar con el profe que cierra la pestaña y vuelve | 5 |
| Importar una lista, editar en lote, archivar y deshacer | 6 |
| Vista previa, regenerar un ejercicio, aprobar con checklist | 7 |
| Publicar con fechas, corregir lo publicado y reasignar a un estudiante que ya empezó | 8 |
| Un profe de otro colegio y un estudiante no ven nada que no les toca, ni navegando ni llamando a las rutas | 2, y crece en cada fase |

CI en GitHub Actions, en cada push y PR:

- `tsc --noEmit`, lint y Vitest de unidad (desde T0.4);
- con Supabase local (desde T1.1): integración y `supabase test db`;
- `next build` y Playwright;
- que los tipos generados no tengan diferencias con la base.

## Cómo se orquesta

### Roles

| Rol | Quién | Hace | No hace |
|---|---|---|---|
| Orquestador | Esta sesión (Opus 5.5) | Escribe los contratos de cada fase, parte en tickets, lanza subagentes, revisa diffs, mergea, corre las compuertas, recorre la app en el navegador y habla con el usuario | No escribe features (solo contratos, pegamento y arreglos de merge) |
| Implementador back | Agente `backend` con `model: "sonnet"` (Sonnet 5.5) | Migraciones, RLS, RPC, repos, servicios, trabajos e IA | No toca `components/` ni contratos |
| Implementador front | Agente `frontend` con `model: "sonnet"` | Páginas, componentes, hooks de cliente y Server Actions finas | No toca `lib/server/` ni `supabase/` |
| Revisor | Agente nuevo que no vio la implementación (Codex con `codex:codex-rescue`, o `general-purpose` con Opus si Codex no está) | Revisa el diff contra el ticket y el anexo B, y revisa cada contrato de fase antes de repartir | No arregla: reporta hallazgos con archivo y línea |
| QA | Agente `qa` con `model: "sonnet"` | Corre todas las compuertas y los flujos punta a punta, y busca fugas de datos | No refactoriza |

### Ciclo de cada fase

1. **Diseño (fases 2, 4, 6, 7 y 8).** El orquestador muestra dos o tres opciones de las pantallas nuevas. El usuario elige y la sección de la fase se actualiza en este spec.
2. **Contratos.** El orquestador escribe en la rama de la fase:
   - **migraciones de contrato** que crean las tablas con RLS activado y sin ningún privilegio: nacen cerradas;
   - el SQL de los protocolos de esa fase (máquina de estados, locks, privilegios);
   - los tipos y esquemas zod de `lib/domain/`;
   - las firmas de servicios, Server Actions y RPC (con cuerpos que levantan `NotImplemented`);
   - las rutas con su forma de request y response.
   
   El revisor revisa el contrato y, con los hallazgos resueltos, se commitea. Los tickets nunca editan una migración de contrato: suman migraciones nuevas.
3. **Tandas.** Los tickets se agrupan en tandas cuyos archivos no se pisan, con un máximo de 4 implementadores a la vez. Cada uno corre en su worktree (`isolation: "worktree"`), que sale de la rama de la fase.
   - **Turno de base.** Solo un ticket por tanda puede tener migraciones nuevas. Todos comparten el Supabase local y aíslan sus datos con las factories. Ningún implementador corre `db reset`.
4. **Revisión por ticket.** Cuando un ticket termina, el orquestador lee el diff y corre sus compuertas, y después pasa el diff al revisor. Hay como máximo dos rondas de arreglos; si sigue mal, el orquestador vuelve a partir el ticket o lo termina él.
5. **Cierre de la tanda.** Cuando ya no corre ningún ticket de la tanda, el orquestador hace esto en orden:
   1. mergea los tickets aprobados a la rama de la fase, con `--no-ff` y uno por vez;
   2. corre `db reset`;
   3. corre las compuertas de todo lo mergeado;
   4. recién entonces lanza la tanda siguiente.
   
   Ningún reset ocurre con un ticket corriendo. Cada reporte de pruebas anota el hash del conjunto de migraciones con que corrió.
6. **Cierre de la fase:**
   - el QA completo con los flujos obligatorios de esa fase;
   - el recorrido del orquestador en el navegador: cada link y botón, escritorio y celular, teclado, build de producción y la lista de accesibilidad;
   - la revisión de Codex sobre la rama entera, en rondas hasta que no quede ningún hallazgo importante;
   - la demo al usuario.
   
   El push y el PR a `main` van con el OK del usuario.

El avance se anota en `docs/PLATAFORMA-AVANCE.md`: ticket, estado, rama, quién lo hizo, hash de migraciones de su última prueba y hallazgos abiertos. Así una sesión nueva retoma sin perder el hilo.

### Formato de ticket

```
T<fase>.<n> · <título corto>
Agente: backend | frontend          Tanda: <n>        Depende de: T…
Turno de base: sí | no
Objetivo: una o dos oraciones con el resultado visible o verificable.
Archivos que puede crear o cambiar: lista cerrada (nadie más los toca en esta tanda).
Contratos que usa (solo lectura): rutas a tipos, esquemas, firmas y migraciones.
Criterios de aceptación: lista verificable, cada uno con su prueba (incluida la de accesibilidad si toca UI).
Pruebas obligatorias: cuáles y dónde.
Inventario de datos: tablas nuevas con datos de estudiantes y qué pasa con ellas al borrar.
Fuera de alcance: lo que no tiene que hacer aunque parezca relacionado.
Dependencias nuevas: ninguna | <paquete> y por qué.
```

Un ticket cambia como mucho unas 400 líneas en 12 archivos. Si da más, se parte. Las filas marcadas **Macro** en las fases son paquetes: el contrato de su fase las parte en tickets con sus dependencias antes de repartir.

### Reglas para los implementadores

Van en el prompt de cada subagente (anexo A) y en `AGENTS.md` (T0.7), que todo agente lee al arrancar:

- **Leer antes de escribir.** Leer el ticket, las secciones del spec que nombra, los contratos y la guía de Next que corresponda.
- **Archivos cerrados.** Solo tocar los archivos del ticket. Si hace falta otro, o cambiar un contrato, parar y responder `BLOQUEADO: <qué y por qué>`.
- **Pruebas primero.** Escribir las pruebas del ticket antes del código, o junto con él.
- **Compuertas del ticket en verde.** Correr `npm run check:ticket`: tsc, lint, Vitest de lo tocado y pgTAP si tocó `supabase/`. Los stubs de otros tickets pueden seguir levantando `NotImplemented`.
- **Base compartida.** No correr `db reset`. Con turno de base, aplicar las migraciones propias con `supabase migration up`.
- **Un commit por ticket** en su worktree, con un mensaje en español que diga qué cambia para el usuario.
- **Resumen.** Al terminar, responder:
  - qué hizo;
  - qué probó, y con qué hash de migraciones;
  - qué no pudo probar;
  - cualquier decisión que tomó y que no estaba en el ticket.

### Compuertas

Un ticket está terminado cuando cumple todo esto:

- tsc, lint (con los límites de tamaño), sus pruebas de Vitest y pgTAP en verde;
- las pruebas obligatorias existen y pasan;
- `next build` pasa;
- el revisor no dejó hallazgos abiertos de corrección ni de seguridad;
- si cambió la UI, pasó la lista de accesibilidad, y el orquestador la recorrió en el navegador, en escritorio y en celular.

Una fase está terminada cuando, además, todo `npm run check` y los flujos obligatorios de la fase pasan sobre la rama mergeada.

### Ramas

- `main` queda protegida.
- Cada fase tiene su rama, `plataforma/fase-<n>`. Cada ticket, la suya en su worktree: `plataforma/t<fase>-<n>-<slug>`.
- Los commits locales en las ramas de fase y de ticket entran en este plan. El push, los PR y los merges a `main` necesitan el OK del usuario en cada fase.

## Fases y tickets

### Orden

```
0 Cimientos → 1 Base → 2 Cuentas → 3 Motor de trabajos → 4 La app sobre el servidor → 5 Generación
5 → 6 Grupos ┐
5 → 7 Adaptaciones → 8 Entrega ├→ 9 Colaboración y privacidad → 10 Producción
6 ───────────────────────────┘
```

- Las fases 6 y 7 pueden solaparse en tickets de front; sus tickets de back comparten tablas y van por turno de base.
- La fase 4 incluye una publicación mínima (publicar una versión aprobada a sus destinatarios, sin fechas), que la fase 8 completa.
- Staging (T1.0) y la región de Netlify (T0.6) necesitan al usuario y arrancan al principio.
- No se cargan datos reales hasta cerrar la fase 9, T10.5 y la compuerta legal de T10.6.
- La revisión legal de T10.6 arranca ya, en paralelo, porque depende de terceros.

### Fase 0 · Cimientos (sin cambios visibles)

| Ticket | Agente | Qué |
|---|---|---|
| T0.1 | backend | Vitest, pasando los 7 tests de `scripts/tests/` sin perder casos. `npm test`, `npm run check` y `npm run check:ticket` |
| T0.2 | backend | ESLint: límites de tamaño y complejidad, reglas de dependencia entre capas, la frontera entre código nuevo y viejo y la lista de excepciones |
| T0.3 | frontend | Playwright con el camino de la demo de hoy, como red de seguridad |
| T0.4 | backend | GitHub Actions: tsc, lint, Vitest de unidad, build y Playwright (Supabase entra en T1.1) |
| T0.5 | orquestador | Esqueleto de capas: carpetas, `lib/errors.ts`, `defineAction`, `defineRoute` y `lib/server/log.ts` |
| T0.6 | orquestador y usuario | **Compuerta de Netlify.** En un deploy preview, una ruta de prueba hace un trabajo simulado de 45 a 50 s. Se prueban dos formas: respondiendo 202 y trabajando en `after()` con el cliente ya cerrado, y respondiendo con stream (plan B). Cada una llamada desde un servidor que corta enseguida (como hará `pg_net`) y desde el navegador, en frío y en caliente, y verificando la escritura final en Netlify Blobs. También se prueban `cacheComponents`, `proxy.ts` y Partial Prefetching. El resultado elige cómo responde el worker. La llamada real desde Supabase Cron se prueba en T3.3, cuando existe |
| T0.7 | orquestador | Sumar a `AGENTS.md` una sección de arquitectura con las reglas de este spec, sin tocar lo que ya dice `CLAUDE.md` sobre producto y roadmap. Actualizar la infraestructura del README |

### Fase 1 · Base: esquema, privilegios, RLS y acceso a datos

| Ticket | Agente | Qué |
|---|---|---|
| T1.0 | usuario | Crear los proyectos de Supabase de staging y producción en `sa-east-1` y pasar las variables de staging |
| Contratos | orquestador | Migración que revoca todo por defecto (incluido `PUBLIC`), migraciones de contrato de las tablas de identidad a entregas, funciones auxiliares y orden de locks. Lo revisa Codex |
| T1.1 | backend | Supabase local, scripts `db:start`, `db:reset`, `db:types` y `db:test`, clientes, `seed.sql`, `tests/factories/` y Supabase en CI |
| T1.2 | backend | Privilegios, RLS, RPC de escritura y pgTAP de identidad, grupos, estudiantes, inscripciones y seudónimos |
| T1.3 | backend | Lecturas sensibles por RPC con `audit_log`, proyecciones sin datos sensibles y la prueba de reconstrucción |
| T1.4 | backend | **Macro.** Prácticos, ejercicios, versiones, ejercicios adaptados, destinatarios, generaciones, salidas y eventos: RPC, triggers y pgTAP |
| T1.5 | backend | Publicaciones, asignaciones, intentos, entregas y notas; las RPC y DTO del estudiante; pgTAP y la prueba de fugas |
| T1.6 | backend | Repos de grupos, estudiantes y perfiles, con integración y aislamiento |
| T1.7 | backend | Repos de prácticos, versiones, publicaciones, entregas y notas, con integración y aislamiento |
| T1.8 | backend | La matriz de permisos en `lib/domain/permissions/` y su test contra RPC y REST (solo lo implementado) |
| T1.9 | orquestador | `docs/PRIVACIDAD-DATOS.md` con el inventario de las tablas de la fase, y su prueba contra el esquema |

Tandas: primero T1.1. Después T1.2 (con turno de base) junto con T1.8 y T1.9. Después T1.4 (con turno) y luego T1.3 y T1.5 (cada uno con su turno). Al final, T1.6 y T1.7 en paralelo.

### Fase 2 · Cuentas reales

| Ticket | Agente | Qué |
|---|---|---|
| Diseño | orquestador | Elegido el 12/11/2026: login del profe A, invitación A, login del estudiante A con escaneo, tarjetas B grandes y panel de la institución B (`docs/diseno/fase-2/`, detalle en `docs/contratos/fase-2.md`). Suma T2.9, el panel de la institución |
| T2.1 | backend | Refresco de sesión en `proxy.ts` (sin las rutas de jobs) y `getActor()` con `'use cache: private'` |
| T2.2 | backend | Alta pública desactivada en Auth y comando de administración para dar de alta una institución con su primer admin |
| T2.3 | backend | Invitaciones de profes: crear, mandar, aceptar con o sin cuenta (exigiendo el mismo email) y vencer |
| T2.4 | frontend | Pantallas de login del profe, reseteo, alta desde invitación y salir |
| T2.5 | backend | Aprovisionamiento de cuentas de estudiante con `provisioning_id`, la marca de borrado y la contraseña nueva por el profe. `reconcile_accounts` corre a mano hasta la fase 3 |
| T2.6 | frontend | Login del estudiante con código de institución, y tarjetas de acceso imprimibles por grupo con QR al login |
| T2.7 | backend | Límite de intentos en Postgres (sale Upstash) y límites de Supabase Auth configurados |
| T2.8 | backend | Pasar a Supabase todo lo que usa la sesión vieja (`/api/tts`, `app/demo/*`, `app/estudiante/*`, `LoginScreen` y `lib/demo/steps.ts`). Recién entonces se borra `lib/auth/accounts.ts`. **Puente:** la demo de hoy sigue con su cookie firmada (`signing.ts` y `session.ts`), que desde este ticket solo puede abrir la demo y nunca da acceso a datos del servidor. Se borra en T4.15, cuando la demo corre sobre el sandbox. El Playwright de la demo de hoy tiene que seguir en verde al cerrar la fase 2 |

### Fase 3 · Motor de trabajos

| Ticket | Agente | Qué |
|---|---|---|
| T3.0 | backend y usuario | **Compuerta de calidad y tiempos.** Con un script fuera de la app: generar 5 prácticos reales por ejercicio y completos, y que el usuario compare a ciegas. Además, medir cuánto tardan una página de PDF, un bloque de programa y un bloque de análisis. Si por ejercicio sale peor, o algo no entra en 40 s, se reescribe la parte del spec que corresponde antes de seguir |
| Contratos | orquestador | Tablas `jobs`, `job_schedule`, `batch_runs`, `ai_budgets`, `ai_reservations` y `ai_usage`, y el SQL de la máquina de estados y del presupuesto. Lo revisa Codex |
| T3.1 | backend | `claim_job`, `defer_job`, `complete_job` y `fail_job`, y el efecto en la generación. Con la lista de pruebas concurrentes de «Máquina de estados» |
| T3.2 | backend | `withBudget()`, reservas por intento, `uncertain`, liquidación idempotente y `expire_reservations`, con pgTAP de cien reservas a la vez |
| T3.3 | backend | `/api/jobs/dispatch`, `/api/jobs/worker` y `/api/jobs/kick` según lo que decidió T0.6, Supabase Cron con `pg_net` y el secreto en Vault |
| T3.4 | backend | `read_page`, `merge_document`, `extract_syllabus_part` y `merge_syllabus`, con pruebas de capacidad |
| T3.5 | backend | `analyze_group_part` y `summarize_analysis`, con clave por hash de entradas y mapeo de seudónimos |
| T3.6 | backend | **Macro, un ticket por tarea.** Mantenimiento: `purge_sandboxes`, `purge_orphan_anonymous`, `cleanup_files`, `reconcile_accounts` y `expire_reservations` |
| T3.7 | backend | Monitor de la cola y alertas de trabajos fallados |

### Fase 4 · La app sobre el servidor (misma UI, otra fuente de datos)

| Ticket | Agente | Qué |
|---|---|---|
| Diseño | orquestador | Opciones para «Traer mis datos de este navegador», los textos nuevos de privacidad y la publicación mínima |
| Contratos | orquestador | Firmas de servicios y Server Actions para todo lo que hoy exportan `lib/groups/store.ts` y `lib/syllabus/store.ts`, y la publicación mínima |
| T4.1 | backend | Servicios y acciones de grupos, estudiantes y perfiles |
| T4.2 | frontend | `GroupsPanel`, `GroupDetail` y `Students` leen con Server Components y mutan con acciones |
| T4.3 | backend | Servicios y acciones de prácticos y versiones con ejercicios en tabla. **Puente:** mientras no llega la fase 5, la generación sigue por `/api/generate`, pero un pedido por ejercicio con plazo de 50 s (hoy admite 300 s y corta a los 280, que en Netlify no existen). El resultado se guarda como generación |
| T4.4 | frontend | **Macro.** Primero partir `NewAssessment` (441 líneas) y `AssessmentDetail` (619) en componentes de menos de 150, sin cambiar de dónde leen; después, en otro ticket, pasarlos al servidor |
| T4.5 | backend | Storage: buckets, reserva, firma, confirmación y lectura. «Leer el PDF» y «Programa» pasan a encolar sus trabajos |
| T4.6 | frontend | Subida directa y avance de la lectura en `NewAssessment` y `SyllabusEditor` |
| T4.7 | backend | Publicación mínima: `publish_version` sin fechas, con aprobación y consentimiento chequeados |
| T4.8 | frontend | Estudiante: `StudentHome`, tareas, resolver y entregar con los DTO, y `stepsOf`, `StudentGaze` y `StudentVoice` sin perfiles |
| T4.9 | backend | Demo: prueba corta de «Ver como Paula» y después `create_sandbox()`, login anónimo con Turnstile, topes y proveedor `fixture` |
| T4.10 | frontend | El tour y «Probar la demo» sobre el sandbox |
| T4.11 | backend y frontend | Resultados: corrección por id de ejercicio y análisis con sus trabajos (dos tickets) |
| T4.12 | frontend | `/privacidad` y `/terminos` con el texto nuevo (lo aprueba Producto) |
| T4.13 | backend | `import_local_data`: idempotente por `import_runs`, en partes de menos de 1 MB, con mapeo de ids, versión de formato y el historial de eventos. Los PDF del programa se piden de nuevo |
| T4.14 | frontend | «Traer mis datos de este navegador», con el texto nuevo y reanudable si se corta |
| T4.15 | orquestador | Borrar `lib/groups/store.ts`, `lib/syllabus/store.ts`, `/api/syllabus/pdf` y la demo vieja, con los flujos de la fase en verde |

### Fase 5 · Generación en segundo plano

| Ticket | Agente | Qué |
|---|---|---|
| Contratos | orquestador | Firmas de `request_generation` y `request_cancel_generation`, y forma de `/progress` |
| T5.1 | backend | `request_generation`: crea la generación con sus entradas guardadas, encola por ejercicio con consentimiento chequeado y dispara |
| T5.2 | backend | `generate_exercise` y `generate_gaze_questions` con el prompt por ejercicio y la materia, y el cierre con su prueba concurrente |
| T5.3 | backend | `GET /api/assessments/[id]/progress` |
| T5.4 | frontend | `useAssessmentProgress`, `AiProgress` conectado, «Te avisamos cuando esté» y volver a la pantalla sin perder el avance |
| T5.5 | frontend | Cancelar y reintentar por versión y por ejercicio, el aviso de tope diario y el resultado `obsolete` |
| T5.6 | orquestador | Sacar `/api/generate`, su stream y el bucle del cliente (`lib/groups/generate.ts`) |

### Fase 6 · Gestión de grupos

| Ticket | Agente | Qué |
|---|---|---|
| Diseño | orquestador | Opciones para importar, el panel del grupo y la página del estudiante |
| T6.1 | backend | Parser puro en `lib/domain/` para lista pegada (un nombre por línea, o «Apellido, Nombre»), CSV y XLSX: detecta la columna de nombre, limpia y marca repetidos. Con muchas pruebas |
| T6.2 | frontend | Importar: pegar o subir, vista previa editable con repetidos marcados, y confirmar (crea estudiantes y sus cuentas) |
| T6.3 | frontend | Elegir varios estudiantes y cambiarles perfiles, apoyos o intereses de una |
| T6.4 | backend y frontend | Página del estudiante: perfil con historial, notas privadas, informe del especialista, fecha de revisión y versiones que recibió |
| T6.5 | backend y frontend | Archivar y restaurar grupos, estudiantes y prácticos, con aviso de «Deshacer» (sale `confirm()`) |
| T6.6 | frontend | Panel del grupo: qué falta revisar, quién no entregó, quién viene bajando y perfiles con la revisión vencida |
| T6.7 | backend y frontend | Cierre de año: archivar grupos, pasar un grupo al año siguiente con sus perfiles y mover un estudiante de grupo |
| T6.8 | frontend | Buscar y filtrar grupos y estudiantes, con paginación |

### Fase 7 · Creación de adaptaciones

| Ticket | Agente | Qué |
|---|---|---|
| Diseño | orquestador | Opciones para la vista previa de versiones y para el lado a lado |
| T7.1 | backend y frontend | Borrador que se guarda solo mientras se escribe y se retoma desde el grupo |
| T7.2 | frontend | Vista previa antes de generar: qué versiones salen y para quién, juntar versiones o separar a un estudiante, y tiempo estimado |
| T7.3 | frontend | Original y adaptado lado a lado por ejercicio, con los cambios marcados, su porqué y las salidas de la IA sin aplicar |
| T7.4 | backend y frontend | Editar un ejercicio y regenerarlo con una instrucción («más corto», «sin ejemplo resuelto»), con su generación de tipo `exercise` |
| T7.5 | frontend | Checklist de lo que marcó el chequeo de números, que se tilda antes de aprobar, y «Aprobar todas» |
| T7.6 | backend y frontend | Clave de respuestas y rúbrica por versión, con su generación de tipo `answer_key` |
| T7.7 | backend y frontend | Si cambia el original, las versiones quedan desactualizadas, con «Regenerar las desactualizadas» |
| T7.8 | backend y frontend | Duplicar un práctico a otro grupo, la biblioteca del profe y configuraciones guardadas |

### Fase 8 · Entrega a estudiantes y exportación

| Ticket | Agente | Qué |
|---|---|---|
| Diseño | orquestador | Opciones para publicar, el estado por estudiante, reasignar y la hoja impresa |
| T8.1 | backend | `publish_version` completo: fechas, retirar, volver a publicar, reasignar con intentos y la tabla de qué se puede hacer con cada intento |
| T8.2 | frontend | Publicar con fecha de inicio y de entrega; estado por estudiante; reasignar |
| T8.3 | frontend | Vista de impresión por versión y «Imprimir todas»: KaTeX, saltos de página, nombre del estudiante y QR a su tarea |
| T8.4 | backend y frontend | Avisos dentro de la app: versiones listas, tarea nueva y entrega recibida |
| T8.5 | backend | Empezar a escribir `feedback_events`: abrir, empezar, entregar, tiempo por ejercicio y uso de apoyos, con seudónimo |

### Fase 9 · Colaboración, roles y privacidad

| Ticket | Agente | Qué |
|---|---|---|
| T9.1 | backend y frontend | Co-docentes por grupo: invitar, aceptar y sacar |
| T9.2 | backend y frontend | Rol de inclusión: ve y edita perfiles y apoyos de toda la institución, sin notas ni entregas |
| T9.3 | backend y frontend | Consentimientos por finalidad: cargar el formulario firmado, estado por estudiante, revocar (cancela lo pendiente) y el efecto en versiones, publicaciones, dictado y análisis |
| T9.4 | frontend | Vista del registro de accesos para el admin |
| T9.5 | backend | **Macro: exportar, borrar, baja de institución y retención van en tickets separados.** Exportar y borrar un estudiante recorriendo el inventario, `erasures`, baja de institución y `apply_retention` |
| T9.6 | frontend | Panel de la institución: miembros, roles, invitaciones pendientes y sacar a alguien (cierra sus sesiones) |
| T9.7 | orquestador | `docs/INCIDENTES.md` y el inventario completo en `docs/PRIVACIDAD-DATOS.md` |

### Fase 10 · Producción

| Ticket | Agente | Qué |
|---|---|---|
| T10.1 | orquestador y usuario | CI como autoridad de migraciones, deploy de producción por build hook, publicación automática apagada, PITR y Branching o la regla de previews |
| T10.2 | orquestador y usuario | Netlify: variables por contexto, región `gru` y los secretos (`JOBS_SECRET`, la clave secreta de Supabase y las de IA, ElevenLabs y Resend), con cómo rotarlos |
| T10.3 | backend | Sentry, alertas de errores, de la cola y de gasto de IA |
| T10.4 | backend | `pg_dump` semanal y foto diaria de los buckets a R2 con manifiesto, la reconciliación y la bandera `jobs_paused` |
| T10.5 | revisor y QA | `/security-review`, auditoría de privilegios y RLS, planes de consulta con datos de tamaño real, prueba de carga de 100 versiones a la vez y simulacro de restauración con archivos y supresiones |
| T10.6 | orquestador y usuario | Checklist de salida, compuerta legal (ver «Decisiones a confirmar»: evaluación de impacto, consentimiento escrito, responsable y encargado, transferencias por destino) y piloto con un colegio |

En total son unos 95 tickets.

## Riesgos

- **El adaptador de Netlify y Next 16.4.** T0.6 lo prueba con un trabajo de duración real antes de construir encima, y el worker tiene un plan B.
- **Calidad y tiempos.** T3.0 mide la generación por ejercicio y la duración de cada tipo de trabajo antes de las fases 3 a 5.
- **Permisos mal escritos.** Es la causa más común de fugas en Supabase. Se mitiga así:
  - nada se escribe directo;
  - los datos sensibles se marcan por campo;
  - pgTAP revisa los privilegios efectivos;
  - la matriz se prueba contra la API directa;
  - la prueba de reconstrucción;
  - Codex revisa cada contrato.
- **Concurrencia.** Los protocolos de trabajos y versiones son lo más delicado. Tienen un orden de locks único, SQL escrito en el contrato y pruebas con conexiones simultáneas.
- **Alcance.** Son once fases. Cada una deja la app andando y se puede mostrar, así que se puede frenar en cualquiera.
- **Subagentes que se desvían.** Se mitiga con contratos revisados, archivos cerrados, el turno de base, las tandas que cierran juntas, el revisor que no vio la implementación y las compuertas automáticas.
- **Datos de menores.** No se cargan datos reales hasta cerrar la fase 9, T10.5 y la compuerta legal de T10.6.

## Anexo A · Prompt base del implementador

```
Sos el implementador del ticket {ID} de Tiza.ai. Trabajás en un worktree propio.

Leé primero, en este orden:
1. docs/PLATAFORMA.md: «Arquitectura», «Reglas de código», «Seguridad y aislamiento» y la sección de tu fase.
2. El ticket (abajo) y los archivos de contrato que nombra. No los cambies.
3. La guía de Next en node_modules/next/dist/docs/ que corresponda a lo que vas a hacer.

Ticket:
{TICKET}

Reglas:
- Tocá solo los archivos del ticket. Si necesitás otro o cambiar un contrato, pará y respondé
  «BLOQUEADO: <qué y por qué>».
- Nunca edites una migración existente. Con turno de base, sumá migraciones nuevas y aplicalas con
  supabase migration up. Nunca corras db reset.
- Escrituras y lecturas sensibles solo por RPC con autorización adentro. Actor y hora de la sesión.
- Respetá el orden de locks: versión, generación, ejercicios.
- Escribí las pruebas obligatorias primero o junto con el código.
- Archivos de hasta 200 líneas, componentes de hasta 150, funciones de hasta 40, sin any.
- zod en todo borde. Errores esperados con AppError. Entradas con defineAction o defineRoute.
- A la IA nunca le mandes nombres ni ids de estudiantes. Al estudiante nunca le llegan perfiles ni la clave.
- Ningún texto fijo de una materia: la materia es un parámetro.
- Si tocás UI: WCAG 2.2 AA y la lista de accesibilidad del spec.
- UI en español rioplatense. Código y comentarios en inglés; los comentarios dicen el porqué.
- Antes de terminar: npm run check:ticket en verde. Un commit con un mensaje en español.

Respondé al final con: qué hiciste, qué probaste y con qué hash de migraciones, qué no pudiste
probar y cualquier decisión que tomaste que no estaba en el ticket.
```

## Anexo B · Checklist del revisor

- ¿Hace lo que dice el ticket, y nada más?
- ¿Algún camino deja leer o escribir datos de otra institución, o le muestra a un estudiante su perfil, la clave o algo que permita deducirlos?
- ¿Algún privilegio nuevo para `anon`, `authenticated` o `PUBLIC`? ¿Alguna escritura directa? ¿Alguna RPC interna ejecutable por usuarios?
- ¿Algún campo sensible legible sin pasar por una lectura auditada?
- ¿Las RPC sacan el actor de la sesión y validan la institución contra las membresías?
- ¿Toda Server Action y Route Handler vuelve a leer la sesión y valida con zod?
- ¿Algún dato de estudiante viaja a la IA, a los logs o a una clave de caché?
- En trabajos: ¿se respetan el `lock_token`, la vigencia, el orden de locks y el presupuesto? ¿Entra en 50 s?
- ¿Las pruebas fallarían si se rompe lo que dicen probar? ¿Cubren el caso de error, el de permisos y el concurrente?
- ¿Las tablas nuevas con datos de estudiantes están en el inventario de privacidad?
- ¿Respeta los límites de tamaño y las reglas de dependencia? ¿Hay lógica en componentes o rutas? ¿Texto fijo de una materia?
- En la UI: ¿estados de cargando, vacío y error? ¿Pasa la lista de accesibilidad?
- ¿Algún texto en un español que no sea rioplatense, o en inglés?

## Cambios por la revisión

**Ronda 1** (`docs/revisiones/plataforma-codex-1.md`, 23 hallazgos):

- **Privilegios y lecturas.** Se revoca todo por defecto, todas las escrituras van por RPC y las RPC internas son solo de `service_role`. Las lecturas sensibles se auditan.
- **Estudiantes.** DTO propio.
- **Storage.** Reserva y validación.
- **Trabajos.** Uno por invocación, con máquina de estados y `generation_id`.
- **Entregas.** Publicaciones inmutables.
- **Rutas largas.** Pasan a trabajos.
- **Topes.** Para la demo y la IA.
- **Consentimiento.** Se chequea al ejecutar.
- **Cuentas.** Email sintético por id, identidad global y aprovisionamiento con reconciliación.
- **Orden y orquestación.** Tickets reordenados y migraciones de contrato cerradas.
- **Operación.** Importación idempotente, migraciones compatibles, privacidad y respaldos de archivos.

**Ronda 2** (`docs/revisiones/plataforma-codex-2.md`). De los 23 de la ronda 1, 8 estaban cerrados y 15 a medias. Hubo 30 hallazgos nuevos:

- **N01 · Privilegios.** Se revoca también a `PUBLIC`, para cada rol que crea objetos, y se prueban las RPC internas como `anon` y `authenticated`.
- **N02 · Plazas.** `claim_job` se serializa con un advisory lock global: solo cuentan los locks vigentes y lo vencido se recupera primero.
- **N03 · Salidas de los trabajos.** `defer_job` devuelve el intento, y el fallo terminal y la cancelación cierran la generación.
- **N04 · Presupuesto.** Reserva por intento de proveedor con cota conservadora, `uncertain` sin liberación automática y `withBudget()` en toda llamada paga.
- **N05 y N06 · Vigencia.** Por recurso (versión, ejercicio, clave), con ejercicios en tabla, `revision` por ejercicio, entradas guardadas tal cual y orden de locks único.
- **N07 · Eventos.** Con id propio y `op_id`, única solo la combinación de `generated` y su generación, y `generation_outputs` antes de cualquier edición.
- **N08 · Destinatarios.** `version_recipients` con vigencia, seudónimos, `feedback_events` y `base_version_id`.
- **N09 y N10 · Intentos.** Cada intento fija su publicación y su clave, con una tabla de qué se puede hacer en cada caso y `publish_version` atómico.
- **N11 · Capas.** Repos privilegiados en `repos/admin/`, RPC pública que envuelve a la interna, institución como selector validado e intenciones antes de los efectos.
- **N12 · Storage.** Sin acceso directo de usuarios: todo por el servidor, con auditoría de consentimientos.
- **N13 y N22 · Sensibilidad.** Por campo, con proyecciones sin datos sensibles, auditoría por divulgación, políticas sobre conjuntos con índices y medición en T10.5.
- **N14 · Anónimos.** Límites de Auth para el login anónimo, IP de la cabecera de Netlify, `purge_orphan_anonymous` y restricciones por tipo de institución.
- **N15 · Aprovisionamiento.** Alta pública desactivada, `app_metadata.provisioning_id`, marca de borrado y contraseña inicial que no se guarda. La invitación exige el mismo email.
- **N16 · Borrado.** Inventario de datos personales con su prueba, desvinculación por seudónimo y `erasures`, que se vuelve a aplicar al restaurar.
- **N17 · Despliegue.** CI como única autoridad de migraciones, deploy del mismo commit (ver R3-10), cuatro pasos de expandir y contraer, y regla de previews.
- **N18 · Plan B.** Respuesta con stream, rutas de jobs fuera del proxy y T0.6 con un trabajo de 45 a 50 s.
- **N19 · DTO del estudiante.** Uno por contexto (incluido `interface`), lista de claves permitidas y consumidores nombrados.
- **N20 · Resets.** Solo al cerrar una tanda, sin tickets corriendo, y con hash de migraciones en cada reporte.
- **N21 · Orden.** T0.4 sin Supabase, publicación mínima en la fase 4 y matriz con fase de vigencia.
- **N23 · «Ver como Paula».** Protocolo de ida y vuelta con `sandbox_sessions`.
- **N24 · Análisis.** Clave por hash de entradas.
- **N25 · Trabajos largos.** Divididos en partes, y T3.0 mide sus tiempos.
- **N26 · Despachador.** Llena las plazas libres, con equidad entre instituciones y plazas reservadas para mantenimiento.
- **N27 · Respaldos.** PITR, `pg_dump` semanal, foto diaria de archivos con manifiesto y runbook con lo que no vive en la base.
- **N28 · Materia.** `subject_id` con carpeta por materia, y hash y revisión de los perfiles en cada generación.
- **N29 · Clases de trabajo.** `interactive`, `maintenance` y `batch`, con `batch_runs` para los lotes del roadmap.
- **N30 · Accesibilidad.** WCAG 2.2 AA como criterio, con una lista por flujo.

La sección de roadmap y la regla de no reescribir `CLAUDE.md` (T0.7) responden a la revisión contra el `CLAUDE.md` nuevo.

### Ronda 3

Los hallazgos están en `docs/revisiones/plataforma-codex-3.md`.

- **R3-1 · Cierre de generaciones.** Estados terminales que no se reabren, hermanos cancelados y todo cambio del recurso condicionado a que la generación siga vigente.
- **R3-2 · Presupuesto.** `maxRetries: 0` en el SDK, reserva por envío HTTP, unidades por proveedor (caracteres en ElevenLabs), lo incierto nunca se libera y tope de concurrencia para lo sincrónico.
- **R3-3 · Claves históricas.** `answer_key_revisions` inmutables atadas a la revisión de los ejercicios. Publicar comprueba la correspondencia. En la fase 4 la clave solo es obligatoria en mirada.
- **R3-4 · Entregas.** Fila «Entregado» en la matriz, entrega con la revisión del borrador e idempotente, y corrección desde que hay entrega.
- **R3-5 · Consentimiento sincrónico.** Chequeo en cada llamada de dictado, comandos y lectura, contenido resuelto en el servidor y consentimiento antes del micrófono del navegador.
- **R3-6 · Nombres en el contenido.** `prepareForProvider()` redacta localmente antes de la primera llamada, y se guarda el original aparte.
- **R3-7 · Anonimización.** Lo que queda después de borrar el seudónimo es personal salvo justificación por campo en el inventario. La exportación no lleva datos de otros.
- **R3-8 · Supresiones.** Registro fuera de la base, marca antes de borrar y efectos pendientes que la comprueban.
- **R3-9 · Compuerta legal.** Evaluación de impacto, consentimiento escrito, responsable y encargado, y transferencias por destino antes del primer dato real. La revisión arranca ya.
- **R3-10 · Despliegue.** `netlify deploy --build --prod` desde el checkout de CI con verificación del SHA, sin build hook y sin cancelar a mitad.
- **R3-11 · Puentes.** T0.6 sin Cron de Supabase (pasa a T3.3), la cookie de la demo de hoy hasta T4.15 y `/api/generate` por ejercicio con 50 s en la fase 4.
- **R3-12 · Idempotencia.** `op_key` del navegador con alcance por institución y recurso, y la identidad del análisis con la foto de seudónimos.
- **R3-13 · Operaciones compuestas.** Tabla `operations` con partes fijas y merge una sola vez.
- **R3-14 · Volver de Paula.** `refreshSession`, reclamar y consumir al final.
- **R3-15 · Acción vieja.** Lo resuelve el cliente (`callAction`) y el formulario guarda el borrador antes de recargar.
- **R3-16 · Respaldos.** PITR sin backups diarios aparte.
- **R3-17 · Tickets grandes.** T1.4, T3.6, T4.4 y T9.5 son macro y se parten en el contrato de su fase.
- **R3-18 · Instrucciones generales.** Campo en `assessments` y en todo el recorrido, y el parser ya no las descarta.
