# Contrato de la fase 2 · Cuentas reales

Este documento fija cómo entran a Tiza los profes, los admins y los estudiantes con cuentas de verdad: las tablas y RPC nuevas, los servicios, las rutas, las pantallas y los tickets. Lo escribe el orquestador antes de repartir. Los tickets lo leen y no lo cambian: si algo no cierra, responden `BLOQUEADO`.

Fecha: 12/11/2026. Rama: `plataforma/fase-2`, desde `plataforma/fase-1`. Rige todo lo de `docs/contratos/fase-1.md` (esquemas, errores, nombres, locks, idempotencia, triggers de pertenencia) y `docs/contratos/fase-1-lecciones.md`.

Archivos del contrato (los escribe el orquestador, ningún ticket los edita):

- La migración `supabase/migrations/20261114100000_f2_contract.sql`: tablas y columnas nuevas, cerradas, y los stubs de las RPC nuevas, que levantan `UNAVAILABLE not_implemented`.
- La prueba `supabase/tests/040_f2_contract.test.sql`: existen las tablas y las firmas, nadie tiene privilegios, RLS forzado.
- Tipos y esquemas en `lib/domain/accounts/` y `lib/domain/identity/` y su registro en `lib/domain/rpc.ts`.
- Firmas de servicios en `lib/server/services/` y de entradas en `app/**/actions.ts`, con cuerpos que levantan `AppError("UNAVAILABLE", …)`.

## Diseño elegido

El usuario eligió las recomendaciones de `docs/diseno/fase-2/README.md` (12/11/2026):

| Pantalla | Opción | Con |
|---|---|---|
| Login del profe y del admin | A, la hoja sobre el pizarrón | De B: error al lado del campo cuando falta un dato y el estado «Esperá unos minutos» |
| Aceptar una invitación | A, la carta | De B: la marca «No es el correo con el que entraste» junto al correo de la invitación |
| Login del estudiante | A, igual que la tarjeta | De C: «Escanear mi tarjeta» como segunda puerta |
| Tarjetas de acceso | B, grande (A6, 4 por hoja) | De C: «Tarjeta nueva» por estudiante |
| Panel de la institución | B, primero las tareas (pegar y revisar) | De A: las listas, en «Ver profes e invitaciones» |

Las maquetas son la referencia visual. Los implementadores de front copian estructura, textos y estados de esos HTML; no copian el CSS suelto: usan Tailwind y los componentes de la app.

**El QR no alcanza para entrar.** Por defecto, y como en las maquetas, escanear completa el colegio y el usuario y siempre pide la contraseña. Una «tarjeta llave» (entrar solo con el QR) se puede sumar después para estudiantes con motriz, pero convierte la foto de una tarjeta en una cuenta abierta. Queda anotada en «Para después».

## Decisiones

### Quién crea cada cuenta

- **Nadie se da de alta solo.** `enable_signup = false` en Auth (ya está en `supabase/config.toml`) y en los proyectos de staging y producción. Toda cuenta la crea el servidor con el cliente admin, y siempre después de que una RPC autorizó con la sesión de quien la pide, o en el comando de administración que corre el equipo de Tiza.
- **Profes y admins**, por invitación. La primera institución y su primer admin, con el comando `npm run admin:institution` (T2.2).
- **Estudiantes**, por aprovisionamiento, cuando un admin o un profe del grupo crea el estudiante (`create_student` ya deja la fila `pending`).

### La autoridad sigue en la base

Los servicios no deciden permisos. Toda operación con el cliente admin (crear un usuario de Auth, cambiarle la contraseña) se hace solo con ids que devolvió una RPC llamada con la sesión del actor, que ya autorizó. El navegador nunca manda un id de Auth.

### Correo

- Una interfaz `MailSender` (`lib/server/mail/`) con dos implementaciones: Resend por `fetch` a su API (sin dependencia nueva; `RESEND_API_KEY` y `MAIL_FROM`) y Mailpit para desarrollo y pruebas, por su API HTTP de envío (`POST /api/v1/send` en el puerto 54324 de Supabase local). Se elige por `MAIL_DRIVER=resend|mailpit`. En producción, sin `RESEND_API_KEY` la app no arranca.
- El correo de recuperar la contraseña lo manda Supabase Auth. En producción, con Resend como SMTP (`docs/PLATAFORMA.md`, «Decisiones a confirmar»). En local va a Mailpit.
- Ningún log lleva un token, un enlace con token ni un correo. `log.ts` ya filtra por lista de permitidos: no se suma ninguna clave nueva para esto.

### Tokens

- Todo token (invitación, tarjeta) son 32 bytes de `crypto.randomBytes`, en base64url. La base guarda solo `sha256(token)` (`bytea` de 32). El servidor calcula el hash; la RPC recibe el hash.
- Los tokens van en la ruta (`/invitacion/<token>`, `/t/<token>`). Las páginas que los reciben responden con `Cache-Control: no-store` y `Referrer-Policy: no-referrer`, y no cargan nada de terceros. Los logs de acceso de Netlify sí ven la ruta: por eso una invitación vence a los 7 días y sirve una vez, y una tarjeta solo completa el usuario, nunca abre la sesión.

### Límite de intentos

Sale Upstash. Los contadores viven en `app.rate_limits` (ya existe) y se tocan solo con RPC internas. La política es la de hoy (`lib/auth/rateLimit.ts`), que ya probó la demo:

- Solo cuentan los fallos, y un acierto limpia los contadores de ese usuario.
- Ventanas fijas de 15 minutos.
- Estudiante: 10 por IP y usuario, 30 por usuario desde cualquier IP. Ningún límite por IP sola: un colegio entero sale por una IP.
- Profe: lo mismo, con el correo en lugar del usuario.
- Recuperar contraseña: 3 por correo por hora y 20 por IP por hora.
- Abrir una tarjeta (`/t/<token>`) o una invitación con un token que no existe: 30 por IP en 15 minutos.
- Las claves son `<balde>:<hex de HMAC-SHA256(RATE_LIMIT_SECRET, valor)>`, así nunca guardan una IP, un correo ni un usuario. Los baldes: `login_pair`, `login_user`, `staff_pair`, `staff_user`, `reset_email`, `reset_ip`, `token_ip`.
- La IP sale de `x-nf-client-connection-ip` (Netlify). Si no está (local, pruebas), de `x-forwarded-for` (el primero). Si tampoco está, `unknown`.
- Supabase Auth ve todas las llamadas desde la IP de Netlify, no la del estudiante. Por eso su límite por IP (`[auth.rate_limit] sign_in_sign_ups`) se sube a 1000 cada 5 minutos en `config.toml` y en los proyectos: el límite real es el nuestro. El de correos (`email_sent`) queda bajo.
- Al bloquearse, el servicio devuelve `RATE_LIMITED` con la hora a la que se puede volver a probar (el fin de la ventana), y la pantalla la muestra.

### Contraseña inicial de un estudiante

- Dos palabras cortas en español de una lista fija (`lib/domain/accounts/words.ts`, al menos 512 palabras de 3 a 6 letras, sin tildes, sin ñ y sin palabras que puedan ofender) y un número de dos cifras sin 0 ni 1: `nube-tigre-47`. Unos 24 bits. Con el límite de intentos alcanza: adivinar una cuenta llevaría años.
- Se genera con `crypto.randomInt`, nunca con `Math.random`.
- El login normaliza lo que escribe el estudiante: minúsculas, sin espacios al borde, y cualquier tira de espacios o guiones pasa a un guion. Como la contraseña nace en ese formato, normalizar no pierde nada.
- No se guarda en ningún lado: va al Auth de Supabase y a la hoja que se imprime. Si se pierde, una tarjeta nueva crea otra.

### Usuario de un estudiante

- El nombre más la inicial del apellido, sin tildes, en minúscula y solo con `a-z0-9`: «Lucía Fernández» da `luciaf`. Si está tomado, `luciaf2`, `luciaf3`…
- La regla es pura (`lib/domain/accounts/username.ts`) y recibe los usuarios ya tomados, que da `list_taken_usernames`.
- El admin ve y puede cambiar cada usuario antes de crear (paso «revisar» del panel B). Si al crear alguien tomó el mismo, `create_student` da `CONFLICT username_taken` y esa fila vuelve a revisar.

### Correo sintético

`<student_id>@estudiantes.usetiza.app`, como dice el spec. `lib/domain/accounts/email.ts` lo arma y lo reconoce. El subdominio no recibe correo. Ningún correo de Auth se le manda a esa dirección: recuperar contraseña rechaza un correo de ese dominio sin llamar a Auth.

### La sesión

- `proxy.ts` refresca la sesión de Supabase en cada pedido de página y de API, salvo `/api/jobs/*` (fase 3), los archivos estáticos y `/_next`. Usa `@supabase/ssr` con `getClaims()` y escribe las cookies en la respuesta.
- `proxy.ts` hace solo el chequeo optimista (hay sesión, y de qué tipo). La autorización real está en `getActor()` y en la base.
- `getActor()` (`lib/server/auth/actor.ts`) devuelve el actor del pedido: `null`, un staff con sus instituciones y roles (`list_my_institutions`), o un estudiante con su institución. Usa `'use cache: private'` como dice la guía de Next 16 (`node_modules/next/dist/docs/`, autenticación con Cache Components). Si la guía dice otra cosa, manda la guía y el ticket lo anota.
- La cookie firmada de la demo (`lib/auth/signing.ts`, `session.ts`) sigue hasta T4.15, pero desde T2.8 solo abre la demo: `getActor()` la ignora, y ninguna RPC ni servicio la mira.
- Salir: una Server Action que hace `signOut()` y vuelve al login de su tipo. Está en la cabecera del profe y en la del estudiante.

### Quién ve qué pantalla

| Ruta | Quién |
|---|---|
| `/ingresar/profesor`, `/ingresar/profesor/olvide`, `/ingresar/profesor/nueva` | Cualquiera. Con sesión de staff, redirige a `/grupos` |
| `/ingresar/estudiante`, `/ingresar/estudiante/escanear`, `/t/[token]` | Cualquiera. Con sesión de estudiante, redirige a `/estudiante` |
| `/invitacion/[token]` | Cualquiera con el token |
| `/auth/confirmar` | Route Handler del enlace de recuperar contraseña (`verifyOtp` con `token_hash` y `type=recovery`) |
| `/grupos/**`, `/materia/**` | Staff con sesión, o la demo con su cookie (como hoy) |
| `/estudiante/**` | Estudiante con sesión, o la demo con su cookie (como hoy) |
| `/institucion/**` | Admin de esa institución |
| `/institucion/[institutionId]/grupos/[groupId]/tarjetas` | Admin, o profe del grupo |

Hasta la fase 4, el profe con cuenta real ve en `/grupos` la app de hoy, que guarda en el navegador, y el estudiante real ve en `/estudiante` un inicio vacío («Todavía no tenés prácticos»). Lo nuevo con datos del servidor son el panel de la institución y las tarjetas.

## Tablas y columnas nuevas

Todas en `app`, con RLS activado y forzado, sin políticas y sin privilegios, como en la fase 1. Cada una con su trigger de pertenencia (`institution_id` y `student_id` no cambian) y con `app.no_truncate`.

```sql
-- Una tarjeta de acceso: el QR que completa el colegio y el usuario. Una sola vigente por estudiante.
create table app.access_cards (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  issued_by uuid references app.app_users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (institution_id, id),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade
);
create unique index access_cards_current_key on app.access_cards (student_id) where revoked_at is null;

-- Invitaciones: la clave de idempotencia y cuándo se mandó el último correo.
alter table app.invitations add column op_key uuid;
alter table app.invitations add column sent_at timestamptz;
create unique index invitations_op_key on app.invitations (institution_id, op_key) where op_key is not null;
```

- `access_cards` no tiene `revision`: nadie la edita. Emitir una tarjeta nueva pone `revoked_at` en la vigente e inserta otra, en la misma transacción y bajo el lock del estudiante.
- `issued_by` y `revoked_at` siguen la regla de los actores de un evento (fase 1, T1.F15): `issued_by` nace con el actor y no cambia; `revoked_at` pasa de NULL a un valor una sola vez.
- **Inventario.** `access_cards` tiene datos de un estudiante (su id y el hash del token). Al borrar al estudiante se borra (`on delete cascade` y la regla en `lib/domain/permissions/erasure.ts`). Se suma a `docs/PRIVACIDAD-DATOS.md` y a su prueba. `invitations.email` es un dato personal de un adulto; su retención (90 días después de aceptada, revocada o vencida) la programa la fase 9.

## RPC nuevas

Siguen las reglas de la fase 1: `perform app.rpc_begin();` primero, errores con `app.raise_error`, salida `jsonb` de claves cerradas, `internal_*` solo para `service_role`, las demás para `authenticated`. La matriz de permisos (`lib/domain/permissions/matrix.ts`) suma cada una.

### Invitaciones (T2.3)

| RPC | Quién | Qué |
|---|---|---|
| `create_invitation(p_institution_id uuid, p_email text, p_role text, p_token_hash bytea, p_op_key uuid)` → `{id, expires_at}` | admin de la institución, no en un sandbox | Normaliza el correo (minúsculas, sin espacios). Vence a los 7 días. Si ya es miembro activo con ese rol: `INVALID already_member`. Si hay una pendiente para el mismo correo y rol: `CONFLICT invitation_pending`. Un correo del dominio sintético: `INVALID invalid_email`. Mismo `op_key`: devuelve la misma |
| `resend_invitation(p_invitation_id uuid, p_revision integer, p_token_hash bytea)` → `{id, expires_at, revision}` | admin | Pendiente o vencida vuelve a pendiente con hash nuevo y 7 días más. Aceptada o revocada: `INVALID invitation_closed` |
| `revoke_invitation(p_invitation_id uuid, p_revision integer)` → `{id}` | admin | Solo una pendiente o vencida |
| `mark_invitation_sent(p_invitation_id uuid)` → `{id}` | admin | Pone `sent_at = now()` cuando el correo salió |
| `list_invitations(p_institution_id uuid)` → `{items: [{id, email, role, status, expires_at, sent_at, invited_by_name, created_at, revision}]}` | admin | `status` es el efectivo: una pendiente con `expires_at` pasado sale `expired` |
| `list_institution_staff(p_institution_id uuid)` → `{items: [{user_id, display_name, email, roles, has_signed_in}]}` | admin | Solo membresías activas de staff. `has_signed_in` sale de `auth.users.last_sign_in_at` |
| `internal_get_invitation(p_token_hash bytea)` → `{id, institution_name, role, email, inviter_name, status, expires_at, has_account}` o `NOT_FOUND` | service_role | Para la página de la invitación, que abre alguien todavía sin sesión. `has_account`: existe un usuario de Auth con ese correo |
| `internal_create_invitation(p_institution_id uuid, p_email text, p_role text, p_token_hash bytea)` → `{id, expires_at}` | service_role | Lo usa solo el comando de administración (T2.2): sin actor, `invited_by` NULL |
| `accept_invitation(p_token_hash bytea)` → `{institution_id, role}` | authenticated | Bloquea la invitación `FOR UPDATE`. El correo de la sesión (`auth.jwt() ->> 'email'`, en minúsculas) tiene que ser el de la invitación: si no, `FORBIDDEN invitation_email_mismatch`. Vencida: `INVALID invitation_expired`. Revocada: `INVALID invitation_closed`. Ya aceptada por el mismo usuario: devuelve lo mismo; por otro: `INVALID invitation_closed`. Suma la membresía con `internal_add_membership` por dentro y deja `accepted_by` y `accepted_at`. Un estudiante no puede aceptar: `INVALID role_conflict` (el trigger de la fase 1) |

Razones nuevas: `already_member`, `invitation_pending`, `invitation_closed`, `invitation_expired`, `invitation_email_mismatch`, `invalid_email`. Cada una con su texto en `lib/domain/errors/reasons.ts` y en `030_reasons.test.sql`.

### Cuentas de estudiantes (T2.5a)

| RPC | Quién | Qué |
|---|---|---|
| `list_taken_usernames(p_institution_id uuid, p_bases text[])` → `{items: text[]}` | admin o profe de la institución | Los usuarios de la institución que son una base o una base seguida de dígitos. Hasta 200 bases |
| `list_group_accounts(p_group_id uuid)` → `{items: [{student_id, display_name, username, account_status, has_signed_in, last_card_at}]}` | staff del grupo o admin | `account_status`: `pending`, `active` o `failed`. Solo inscripciones activas, sin archivados. No es sensible: no dice nada del perfil |
| `issue_access_cards(p_group_id uuid, p_cards jsonb, p_op_key uuid)` → `{institution_code, institution_name, items: [{student_id, display_name, username}]}` | staff del grupo o admin, no en un sandbox | `p_cards` es `[{student_id, token_hash}]` con 1 a 60 filas, el hash en hex. Cada estudiante tiene que estar inscripto en el grupo y sin archivar (si no, `INVALID not_enrolled`). Bloquea los estudiantes en orden de id, revoca la tarjeta vigente de cada uno e inserta la nueva. Escribe una fila de `audit_log` con `action = 'access_card.issued'` y el conjunto de estudiantes. Mismo `op_key` con las mismas filas: devuelve lo mismo |
| `internal_get_student_accounts(p_student_ids uuid[])` → `{items: [{student_id, provisioning_id, status, auth_user_id}]}` | service_role | Hasta 60. Para que el servicio sepa a quién crearle la cuenta y a quién cambiarle la contraseña, después de `issue_access_cards` |
| `internal_remember_student_account(p_provisioning_id uuid, p_auth_user_id uuid)` → `{id}` | service_role | Guarda la cuenta de Auth en la fila de aprovisionamiento antes de vincular. Una vez guardada no cambia (la guardia de la fase 1); la misma cuenta otra vez devuelve lo mismo |
| `internal_fail_student_account(p_provisioning_id uuid, p_error_code text)` → `{id, attempts}` | service_role | Marca `failed`, suma un intento y guarda un código, nunca un mensaje |
| `internal_list_unfinished_accounts(p_limit integer)` → `{items: [{student_id, provisioning_id, status, auth_user_id}]}` | service_role | `pending` y `failed` con menos de 5 intentos, de estudiantes sin archivar. Nunca `deleted`. Para `reconcile_accounts` |
| `internal_find_institution(p_code text)` → `{code, name}` o `NOT_FOUND` | service_role | Solo escuelas, no sandboxes. Para «Colegio recordado» y el error con nombre |
| `internal_resolve_student_login(p_code text, p_username text)` → `{institution_found, student_id}` | service_role | `student_id` solo si el estudiante existe, no está archivado y su cuenta está `active`; si no, `null`. Así el servicio arma el correo sintético o da el error genérico |
| `internal_resolve_access_card(p_token_hash bytea)` → `{institution_code, institution_name, username}` o `NOT_FOUND` | service_role | Solo una tarjeta vigente, de un estudiante sin archivar, con cuenta `active` y en una escuela. No devuelve el nombre del estudiante |

Razones nuevas: `invalid_cards`.

### Límite de intentos (T2.7)

| RPC | Quién | Qué |
|---|---|---|
| `internal_rate_limit_status(p_keys text[], p_window_seconds integer)` → `{items: [{key, count, retry_at}]}` | service_role | Cuenta de la ventana actual de cada clave (hasta 4) |
| `internal_rate_limit_hit(p_key text, p_window_seconds integer)` → `{count, retry_at}` | service_role | Suma un fallo con `insert … on conflict (key, window_start) do update` en una sola sentencia. De paso borra hasta 100 ventanas de más de un día |
| `internal_rate_limit_clear(p_keys text[])` → `{cleared}` | service_role | Borra la ventana actual de esas claves |

`window_start` es `to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)`.

## Servicios

En `lib/server/services/`. Cada archivo exporta pocas funciones con nombre; los cuerpos del contrato levantan `AppError("UNAVAILABLE", "Todavía no está disponible.")`.

| Archivo | Funciones | Ticket |
|---|---|---|
| `auth/actor.ts` (en `lib/server/auth/`) | `getActor(): Promise<Actor \| null>`, `requireStaff()`, `requireAdmin(institutionId)`, `requireStudent()` | T2.1 |
| `rate-limit.ts` | `checkLogin(bucket, ip, subject)`, `recordFailure(…)`, `clearSubject(…)` | T2.7 |
| `staff-auth.ts` | `signInStaff({email, password, ip})`, `requestPasswordReset({email, ip, origin})`, `setNewPassword({password})`, `signOut()` | T2.3 |
| `invitations.ts` | `inviteStaff({institutionId, emails, role, opKey, origin})` (varias a la vez, con el resultado de cada una), `resendInvitation`, `revokeInvitation`, `readInvitation(token)`, `acceptInvitation(token)`, `acceptInvitationAsNewUser({token, displayName, password})` | T2.3 |
| `student-accounts.ts` | `createStudentAccounts({groupId, rows, opKey})`, `issueAccessCards({groupId, studentIds, origin})` (devuelve las tarjetas con contraseña y URL del QR), `reconcileAccounts(limit)` | T2.5b |
| `student-auth.ts` | `findInstitution(code)`, `signInStudent({code, username, password, ip})`, `readAccessCard(token, ip)` | T2.5b |
| `lib/server/mail/` | `MailSender`, `getMailSender()`, `invitationMail(…)` | T2.3 |

Tipos de dominio en `lib/domain/accounts/`: `Actor`, `AccessCard`, `InvitationView`, `StaffRow`, `AccountRow`, `UsernameDraft`, y las reglas puras `username.ts`, `password.ts`, `email.ts`, `words.ts`.

**Crear cuentas** (`createStudentAccounts`): por cada fila llama a `create_student` con su `op_key` (derivado del `opKey` del pedido y el índice de la fila, con UUID v5), y enseguida aprovisiona: `internal_get_student_accounts` → `auth.admin.createUser({ email: sintético, email_confirm: true, app_metadata: { provisioning_id } })` sin contraseña → `internal_remember_student_account` → `internal_upsert_app_user` → `internal_link_student_user`. Si el correo ya existe, vincula solo si `app_metadata.provisioning_id` coincide; si no, `internal_fail_student_account('email_taken')`. Cualquier otro error: `internal_fail_student_account('<código>')` y sigue con la siguiente. El resultado dice, por fila, si se creó.

**Emitir tarjetas** (`issueAccessCards`): genera un token por estudiante → `issue_access_cards` con la sesión (autoriza) → `internal_get_student_accounts` → aprovisiona a quien le falte → genera una contraseña por estudiante y la pone con `auth.admin.updateUserById` → devuelve por estudiante `{studentId, displayName, username, institutionCode, institutionName, password, qrUrl}` solo para los que salieron bien, y la lista de los que no. La respuesta no se cachea y no se loguea.

**Reconciliar** (`reconcileAccounts`): `internal_list_unfinished_accounts` y el mismo aprovisionamiento. Hasta la fase 3 se corre a mano con `npm run admin:reconcile`.

## Entradas

| Archivo | Acciones |
|---|---|
| `app/ingresar/profesor/actions.ts` | `signInStaffAction`, `requestResetAction`, `setNewPasswordAction` |
| `app/ingresar/estudiante/actions.ts` | `findInstitutionAction`, `signInStudentAction` |
| `app/invitacion/[token]/actions.ts` | `acceptInvitationAction`, `acceptAsNewUserAction`, `signInAndAcceptAction` |
| `app/(auth)/salir/actions.ts` | `signOutAction` |
| `app/institucion/[institutionId]/actions.ts` | `inviteStaffAction`, `resendInvitationAction`, `revokeInvitationAction`, `previewUsernamesAction`, `createStudentAccountsAction`, `createGroupAction` |
| `app/institucion/[institutionId]/grupos/[groupId]/tarjetas/actions.ts` | `issueAccessCardsAction` |
| `app/auth/confirmar/route.ts` | `GET` con `defineRoute` |
| `app/t/[token]/page.tsx` | Server Component que llama a `readAccessCard` y muestra el login con el colegio y el usuario ya puestos |

Cada acción valida con zod, llama a un servicio y devuelve `Result`. Ninguna pasa de unas pocas líneas. La IP la lee la acción de los headers y se la pasa al servicio.

## Pantallas

Cada pantalla sigue su maqueta, en español rioplatense, con WCAG 2.2 AA:

- etiquetas visibles;
- errores con `role="alert"` y el foco en el mensaje;
- el error al lado del campo cuando falta un dato;
- nunca solo color;
- se puede pegar en todo campo y anda el gestor de contraseñas (`autocomplete` correcto);
- 320 px sin desborde.

El estudiante:

- **Errores neutros.** Fondo gris, ícono de idea, una pista concreta, nada en rojo y lo escrito no se borra.
- **Nada que delate el perfil.** Ninguna pantalla del estudiante muestra algo de perfiles, adaptaciones ni formas de responder.
- **Colegio recordado.** En `localStorage` se guardan solo `{code, name}` del colegio, con un botón para cambiarlo. Nada más del estudiante.
- **Escanear.** Usa `BarcodeDetector` donde exista. Si no existe o no hay cámara, explica que se puede abrir la cámara del celular y apuntar al código, y ofrece escribir los datos. No entra una dependencia para leer QR.

Las tarjetas (B):

- **Elegir.** Se elige a quiénes en una lista con casillas (todo el grupo marcado de entrada) y se ve una tarjeta de muestra con «Se crea al imprimir».
- **Confirmar.** Antes, un diálogo avisa que imprimir crea contraseñas nuevas y que las anteriores dejan de andar.
- **Imprimir.** Al confirmar, la acción devuelve las tarjetas y la página las pone en un contenedor que solo se ve al imprimir (`@media print`) y llama a `window.print()`. En pantalla, las contraseñas nunca aparecen. Al cerrar el diálogo de impresión se borran de la memoria del componente.
- **Tarjeta nueva.** Cada fila de la lista tiene «Tarjeta nueva», que hace lo mismo para un solo estudiante.
- **El QR.** Es un SVG generado en el navegador con una función propia (`lib/client/qr.ts`, sin dependencia: QR de versión fija, corrección M), con la URL `https://<origen>/t/<token>`.

## Tickets

Tandas. Cada tanda tiene a lo sumo un ticket con migraciones (turno de base) y nunca más de 4 implementadores a la vez. Los de front trabajan contra los stubs del contrato: prueban sus componentes con servicios simulados y Playwright entra al cerrar la tanda, cuando el back ya está mergeado.

| Tanda | Turno de base | En paralelo |
|---|---|---|
| 1 | T2.7 límites | T2.1 sesión, T2.4 login del profe e invitación, T2.6a login del estudiante |
| 2 | T2.3 invitaciones | T2.9 panel de la institución, T2.6b tarjetas |
| 3 | T2.5a cuentas de estudiantes (SQL) | T2.2 comando de administración |
| 4 | | T2.5b servicios de cuentas, T2.8 puente de la sesión vieja |

```
T2.1 · La sesión
Agente: backend          Tanda: 1        Depende de: contrato
Turno de base: no
Objetivo: cada pedido refresca la sesión de Supabase y el código pregunta quién es el actor en un solo lugar.
Archivos: proxy.ts (solo la parte de Supabase: refresco y cookies; las reglas de áreas siguen como están hasta T2.8),
  lib/server/auth/actor.ts, lib/server/auth/session-proxy.ts, lib/server/auth/*.test.ts,
  tests/integration/auth/actor.test.ts.
Criterios: el proxy refresca y no toca /api/jobs ni estáticos; getActor devuelve null, staff (con instituciones y
  roles) o estudiante; la cookie de la demo no da actor; requireAdmin de otra institución da FORBIDDEN.
Fuera de alcance: pantallas, reglas de áreas, borrar lib/auth.
```

```
T2.7 · Límite de intentos en Postgres
Agente: backend          Tanda: 1        Depende de: contrato
Turno de base: sí
Objetivo: los intentos fallidos se cuentan en Postgres y Upstash sale del proyecto.
Archivos: supabase/migrations/20261114110000_t2_7_rate_limits.sql, supabase/tests/041_rate_limits.test.sql,
  lib/server/repos/admin/rate-limits.ts, lib/server/services/rate-limit.ts (+ test), lib/server/request-ip.ts (+ test),
  supabase/config.toml ([auth.rate_limit]), package.json y package-lock.json (solo sacar @upstash/*),
  .env.example (RATE_LIMIT_SECRET), tests/integration/races/rate-limit.test.ts.
Criterios: los tres RPC; dos fallos a la vez cuentan dos (carrera); la clave nunca lleva el valor en claro;
  retry_at es el fin de la ventana; las ventanas viejas se borran.
Fuera de alcance: cambiar lib/auth/actions.ts (lo hace T2.8).
```

```
T2.4 · Login del profe, recuperar la contraseña e invitación (front)
Agente: frontend          Tanda: 1        Depende de: contrato
Turno de base: no
Objetivo: el profe entra, recupera su contraseña y acepta una invitación con las pantallas elegidas.
Archivos: app/ingresar/profesor/** (page, olvide, nueva, actions.ts), app/invitacion/[token]/**, app/(auth)/salir/**,
  components/auth/staff/**, tests de componentes al lado, tests/e2e/staff-auth.spec.ts (marcado para correr al
  cerrar la tanda 2).
Criterios: los estados de las maquetas login-profe-a (con el error por campo y el bloqueo de B) e invitacion-a (con la
  marca de B), los seis casos de la invitación, foco y role="alert", 320 px, axe sin errores.
Fuera de alcance: servicios (usa los del contrato), proxy.ts, el login viejo (lo borra T2.8).
```

```
T2.6a · Login del estudiante (front)
Agente: frontend          Tanda: 1        Depende de: contrato
Turno de base: no
Objetivo: el estudiante entra con los tres datos de su tarjeta o escaneándola.
Archivos: app/ingresar/estudiante/** (page, escanear, actions.ts), app/t/[token]/page.tsx,
  components/auth/student/**, lib/client/remembered-school.ts (+ test), tests de componentes al lado,
  tests/e2e/student-auth.spec.ts (para la tanda 4).
Criterios: estados de login-estudiante-a (colegio recordado, error neutro, pausa por intentos) y el escaneo de C como
  segunda puerta; nada en rojo; no se borra lo escrito; pegar y gestor de contraseñas; axe.
Fuera de alcance: servicios, tarjetas.
```

```
T2.3 · Invitaciones de profes (back)
Agente: backend          Tanda: 2        Depende de: T2.7, T2.1
Turno de base: sí
Objetivo: un admin invita profes y admins, el correo sale, y la invitación se acepta con o sin cuenta.
Archivos: supabase/migrations/20261114120000_t2_3_invitations.sql, supabase/tests/042_invitations.test.sql,
  supabase/tests/030_reasons.test.sql (sumar razones), lib/domain/errors/reasons.ts (sumar textos),
  lib/server/repos/invitations.ts, lib/server/repos/admin/invitations.ts, lib/server/repos/admin/auth-users.ts,
  lib/server/services/invitations.ts, lib/server/services/staff-auth.ts, lib/server/mail/**,
  tests/integration/invitations/**, .env.example (MAIL_*).
Criterios: las RPC de «Invitaciones» con la reglas comunes de pgTAP; aceptar con otro correo da FORBIDDEN; dos
  aceptaciones a la vez dejan una membresía; alta por invitación crea la cuenta solo si el token está vigente;
  recuperar contraseña con límite y sin llamar a Auth para un correo sintético; ningún log con token o correo.
```

```
T2.9 · Panel de la institución (front)
Agente: frontend          Tanda: 2        Depende de: contrato
Turno de base: no
Objetivo: el admin invita profes y crea cuentas de estudiantes pegando una lista y revisándola antes.
Archivos: app/institucion/** (salvo grupos/[groupId]/tarjetas), components/institution/**, tests al lado,
  tests/e2e/institution.spec.ts (para la tanda 4).
Criterios: estados de admin-b (pegar, revisar con repetidos y correos mal escritos, creadas) y las listas de admin-a en
  «Ver profes e invitaciones»; elegir o crear el grupo; cambiar un usuario en la revisión; axe.
```

```
T2.6b · Tarjetas de acceso (front)
Agente: frontend          Tanda: 2        Depende de: contrato
Turno de base: no
Objetivo: el profe imprime las tarjetas de su grupo sin que las contraseñas aparezcan en pantalla.
Archivos: app/institucion/[institutionId]/grupos/[groupId]/tarjetas/**, components/access-cards/**,
  lib/client/qr.ts (+ test con vectores conocidos), tests al lado.
Criterios: estados de tarjetas-b; «Tarjeta nueva» por fila; hoja A4 con 4 tarjetas A6; las contraseñas solo en
  @media print y fuera de la memoria al terminar; el QR se lee (test que decodifica el SVG con vectores conocidos).
```

```
T2.5a · Cuentas de estudiantes (SQL)
Agente: backend          Tanda: 3        Depende de: T2.3
Turno de base: sí
Objetivo: la base sabe emitir tarjetas, resolver un login de estudiante y listar las cuentas de un grupo.
Archivos: supabase/migrations/20261114130000_t2_5a_student_accounts.sql, supabase/tests/043_student_accounts.test.sql,
  supabase/tests/030_reasons.test.sql, lib/domain/errors/reasons.ts, lib/domain/permissions/erasure.ts,
  docs/PRIVACIDAD-DATOS.md, tests/integration/races/access-cards.test.ts.
Criterios: las RPC de «Cuentas de estudiantes» con las reglas comunes; dos emisiones a la vez dejan una sola tarjeta
  vigente; una tarjeta vieja no resuelve; un archivado no resuelve ni entra; audit_log con el conjunto.
```

```
T2.2 · Comando de administración
Agente: backend          Tanda: 3        Depende de: T2.3
Turno de base: no
Objetivo: el equipo de Tiza da de alta una institución con su primer admin desde la terminal.
Archivos: scripts/admin/institution.ts, scripts/admin/reconcile.ts (stub hasta T2.5b), package.json (scripts
  admin:institution y admin:reconcile), tests/integration/admin/institution.test.ts.
Criterios: crea la institución y la invitación del admin y muestra el enlace solo en la terminal; repetirlo con el
  mismo código no crea otra; pide confirmación si apunta a producción.
```

```
T2.5b · Servicios de cuentas de estudiantes
Agente: backend          Tanda: 4        Depende de: T2.5a
Turno de base: no
Objetivo: crear cuentas, emitir tarjetas, entrar como estudiante y reconciliar funcionan de punta a punta.
Archivos: lib/server/repos/student-accounts.ts, lib/server/repos/admin/student-accounts.ts,
  lib/server/services/student-accounts.ts, lib/server/services/student-auth.ts, lib/domain/accounts/password.ts,
  lib/domain/accounts/words.ts, lib/domain/accounts/username.ts (+ tests), scripts/admin/reconcile.ts,
  tests/integration/accounts/**.
Criterios: reintento con el correo ya creado vincula solo con el mismo provisioning_id; una cuenta borrada no se
  recrea; la contraseña nueva anda y la vieja no; login con espacios o mayúsculas anda; código inexistente da el
  error con nombre y usuario o contraseña mal dan el genérico; los límites de T2.7 se aplican.
```

```
T2.8 · Puente de la sesión vieja
Agente: backend          Tanda: 4        Depende de: T2.1, T2.4, T2.6a
Turno de base: no
Objetivo: todo lo que usaba las cuentas de demo pasa a Supabase y la demo guiada sigue andando.
Archivos: proxy.ts (reglas de áreas), app/(teacher)/layout.tsx, app/estudiante/layout.tsx, app/estudiante/page.tsx,
  app/estudiante/[assessmentId]/page.tsx, app/api/tts/route.ts, app/demo/**, lib/auth/** (borrar accounts.ts,
  actions.ts, dal.ts, rateLimit.*), components/auth/LoginScreen.tsx y LoginForm.tsx (borrar), lib/demo/steps.ts,
  tests/e2e/** que usaban las cuentas viejas.
Criterios: el Playwright de la demo sigue en verde; la cookie de la demo solo abre la demo; /api/tts acepta una sesión
  real o la demo (sin IA en la demo, como hoy); ningún import de lib/auth/accounts.
```

## Pruebas de la fase

- pgTAP de cada RPC nueva con las reglas comunes de la fase 1.
- Integración contra Supabase local: aceptar una invitación (con y sin cuenta, con otro correo, vencida); crear cuentas y reintentar; emitir tarjetas y entrar con la contraseña nueva; la vieja ya no entra; reconciliar.
- Carreras: dos aceptaciones de la misma invitación; dos emisiones de tarjetas del mismo estudiante; dos fallos de login a la vez.
- Playwright: el profe entra y sale; recupera la contraseña con el correo de Mailpit; un admin invita a un profe y el profe acepta desde Mailpit; el admin crea un grupo con estudiantes e imprime las tarjetas (la página de impresión, sin la impresora); el estudiante entra con los datos de la tarjeta y con el enlace del QR; la demo guiada completa en escritorio y celular.
- Fugas: ningún log de la fase tiene un correo, un token, un usuario o una contraseña (un test que corre los flujos con el log capturado y busca esos valores).

## Para después

- La tarjeta llave (entrar solo con el QR) para estudiantes con motriz, si Producto la pide: necesita un token distinto del de la tarjeta común, que se pueda revocar al instante, y un aviso al profe.
- El escaneo como primera puerta en celulares y tablets.
- El formato de bolsillo (A) como opción de impresión.
- Entrar con Google o Microsoft (login C).
- Vencer las sesiones de estudiante en computadoras compartidas del colegio.
