# Contrato de la fase 2 · Cuentas reales

Este documento fija cómo entran a Tiza los profes, los admins y los estudiantes con cuentas de verdad: las tablas y RPC nuevas, los servicios, las rutas, las pantallas y los tickets. Lo escribe el orquestador antes de repartir. Los tickets lo leen y no lo cambian: si algo no cierra, responden `BLOQUEADO`.

Fecha: 12/11/2026. Rama: `plataforma/fase-2`, desde `plataforma/fase-1`. Rige todo lo de `docs/contratos/fase-1.md` (esquemas, errores, nombres, locks, idempotencia, triggers de pertenencia) y `docs/contratos/fase-1-lecciones.md`. Incorpora las rondas 1 a 15 de Codex (F2C-1 a F2C-88, `docs/revisiones/fase-2-contrato-codex.md`).

Archivos del contrato (los escribe el orquestador, ningún ticket los edita):

- La migración `supabase/migrations/20261114100000_f2_contract.sql`: tablas y columnas nuevas, cerradas, sus guardias, y los stubs de las RPC nuevas, que levantan `UNAVAILABLE not_implemented`.
- La prueba `supabase/tests/040_f2_contract.test.sql`: existen las tablas y las firmas, nadie tiene privilegios, RLS forzado, las guardias rechazan.
- Tipos y esquemas en `lib/domain/accounts/` y su registro en `lib/domain/rpc.ts`.
- `retryAt` en `AppError` y en `Failure` (`lib/errors.ts`, `lib/server/entry/run.ts`, `lib/client/callAction.ts`).
- Firmas de servicios en `lib/server/services/` y `lib/server/auth/`, y de entradas en `app/**/actions.ts`, con cuerpos que levantan `AppError("UNAVAILABLE", …)`.

## Diseño elegido

El usuario eligió las recomendaciones de `docs/diseno/fase-2/README.md` (12/11/2026):

| Pantalla | Opción | Con |
|---|---|---|
| Login del profe y del admin | A, la hoja sobre el pizarrón | De B: error al lado del campo cuando falta un dato y el estado «Esperá unos minutos» |
| Aceptar una invitación | A, la carta | De B: la marca «No es el correo con el que entraste» junto al correo de la invitación |
| Login del estudiante | A, igual que la tarjeta | De C: «Escanear mi tarjeta» como segunda puerta |
| Tarjetas de acceso | B, grande (A6, 4 por hoja) | De C: «Tarjeta nueva» por estudiante |
| Panel de la institución | B, primero las tareas (pegar y revisar) | De A: las listas, en «Ver profes e invitaciones» |

Las maquetas son la referencia visual. Los implementadores de front copian estructura, textos y estados de esos HTML; no copian el CSS suelto: usan Tailwind y los componentes de la app. Lo que las maquetas muestran y esta fase no hace (cambiar el rol de alguien desde la lista) no se construye: el botón no aparece.

**El QR no alcanza para entrar.** Por defecto, y como en las maquetas, escanear completa el colegio y el usuario y siempre pide la contraseña. Una «tarjeta llave» (entrar solo con el QR) se puede sumar después para estudiantes con motriz, pero convierte la foto de una tarjeta en una cuenta abierta. Queda en «Para después».

## Decisiones

### Quién crea cada cuenta

- **Nadie se da de alta solo.** `enable_signup = false` en Auth (ya está en `supabase/config.toml`) y en los proyectos de staging y producción. Toda cuenta la crea el servidor con el cliente admin, después de que una RPC autorizó con la sesión de quien la pide, con un token de invitación vigente, o desde el comando de administración que corre el equipo de Tiza.
- **Profes y admins**, por invitación. La primera institución y su primer admin, con `npm run admin:institution` (T2.2).
- **Estudiantes**, por aprovisionamiento, cuando un admin o un profe del grupo crea el estudiante (`create_student` ya deja la fila `pending`).

### La autoridad sigue en la base

Los servicios no deciden permisos. Toda operación con el cliente admin (crear un usuario de Auth, cambiarle la contraseña, cerrarle las sesiones) se hace solo con ids que devolvió una RPC después de autorizar: con la sesión del actor, o con un token de invitación cuyo hash la RPC validó. El navegador nunca manda un id de Auth.

### Nombres de las salidas

Como en la fase 1: argumentos `p_snake_case`, salidas `jsonb` en camelCase. Las tablas de este documento escriben las salidas en camelCase.

### Correo

- Una interfaz `MailSender` (`lib/server/mail/`) con dos implementaciones: Resend por `fetch` a su API (sin dependencia nueva; `RESEND_API_KEY` y `MAIL_FROM`) y Mailpit para desarrollo y pruebas, por su API HTTP de envío (`POST /api/v1/send`, puerto 54324 de Supabase local). Se elige por `MAIL_DRIVER=resend|mailpit`. En producción, sin `RESEND_API_KEY` la app no arranca.
- El correo de recuperar la contraseña lo manda Supabase Auth con una plantilla propia (`supabase/templates/recovery.html`, `[auth.email.template.recovery]` en `config.toml`). En producción usa Resend como SMTP. En local va a Mailpit.
- Ningún log lleva un token, un enlace con token, un correo, un usuario ni una contraseña. `log.ts` ya filtra por lista de permitidos: no se suma ninguna clave para esto.

### Tokens fuera de la URL que ve el servidor (F2C-1)

- Todo token (invitación, tarjeta) son 32 bytes de `crypto.randomBytes`, en base64url. La base guarda solo `sha256(token)` (`bytea` de 32). El servidor calcula el hash; la RPC recibe el hash.
- **Los tokens viajan en el fragmento**, que el navegador nunca manda al servidor: `/invitacion#<token>`, `/t#<token>` y `/ingresar/profesor/nueva#<token_hash>` (la plantilla de recuperación arma ese enlace con `{{ .TokenHash }}`). La página es un componente de cliente que lee `location.hash`, lo borra de la barra con `history.replaceState` y lo manda en el cuerpo de una Server Action (POST). Así no queda en los logs de Netlify, en el historial ni en un `Referer`.
- Esas páginas responden con `Cache-Control: no-store` y `Referrer-Policy: no-referrer`, y no cargan nada de terceros.
- Las Server Actions que reciben un token no lo loguean y no lo ponen en un error.

### Sesión vigente en la base (F2C-9)

- Un access token de Supabase sigue siendo válido hasta vencer aunque se cierre la sesión. Por eso `app.rpc_begin()` suma un chequeo: si el JWT trae `session_id` y esa sesión ya no está en `auth.sessions`, la RPC da `FORBIDDEN no_session`. Un JWT de Auth real siempre trae `session_id`; las pruebas que simulan claims sin él no cambian.
- **Desde el rol del estudiante (F2C-26).** Las RPC `student_*` corren como `tiza_student`, que no ve el esquema `auth`. El chequeo lo hace `app.session_alive()`: sin argumentos, lee `session_id` de `request.jwt.claims` con `current_setting` y responde solo si esa sesión existe. Es `SECURITY DEFINER`, con dueño `postgres`, `search_path = ''`, y `EXECUTE` solo para `tiza_student` (F2C-40): las RPC de staff y las internas corren como `postgres`, que es su dueño, y `000_privileges` sigue exigiendo que `authenticated` y `service_role` no ejecuten nada de `app`. Es la única excepción a «ningún helper presta privilegios» (fase 1, «El rol del estudiante»): no recibe datos y solo dice si la sesión de quien llama sigue viva. `005_student_role` la suma a su lista de excepciones revisadas, con una prueba de que con el claim de otra sesión responde por esa y nada más.
- Salir (`signOut` con alcance `local`), cambiar la contraseña (`signOut` con alcance `others`) y emitir una tarjeta nueva (`issue_access_cards`, en su misma transacción) borran sesiones. Desde ese momento, ninguna RPC acepta el token viejo.
- `jwt_expiry` queda en 3600: el chequeo en la base hace que no importe para los datos.
- **Qué protege y qué no, en el esquema `auth` (F2C-81, F2C-82, F2C-84 a F2C-86).** Las guardias de esta fase cubren lo que GoTrue hace por pedidos públicos (una sesión copiada, un OTP adivinado, `PUT /auth/v1/user`) y lo que hacen nuestros servicios (un `createUser` atrasado). El DML directo del dueño sobre `auth.sessions` y `auth.refresh_tokens` queda **fuera** del modelo de amenazas. La razón: quien puede escribir ahí puede crear una sesión nueva y válida para cualquier usuario, con un id y un refresh token nuevos, sin restaurar nada, y ninguna guardia de la app lo impide. Las rondas 11 a 14 de Codex mostraron que cada guardia sobre esas tablas se esquiva con otra fila. Por eso no hay memoria de sesiones revocadas ni triggers en `auth.sessions`. Lo que sí queda:
  - `app.session_alive()` exige que la sesión exista en `auth.sessions`, que su `user_id` sea el `sub` del JWT y, para una cuenta de estudiante, el registro en `student_sessions` de **ese** estudiante (el de `students.user_id = sub`) con la versión vigente. La parte del estudiante y la comparación del `user_id` las escribe T2.5a;
  - el registro de estudiante se va con su sesión (FK a `auth.sessions` con `on delete cascade`) y solo lo escribe el bind.

  Las guardias de `auth.users` (forma fija de las cuentas de estudiante, cuentas suprimidas que no renacen) siguen cubriendo también el DML del dueño, porque protegen invariantes de nuestros datos y no sesiones.

### Límite de intentos (F2C-11 a F2C-15)

Sale Upstash. Los contadores viven en `app.rate_limits` (ya existe) y se tocan solo con RPC internas.

- **Se cuenta antes de probar.** Cada intento suma en sus claves antes de verificar la contraseña, en una sola sentencia atómica. Si alguna pasó su tope, no se verifica nada. Un acierto limpia las claves del sujeto. Así una ráfaga concurrente nunca prueba más que el tope.
- Ventanas fijas de 15 minutos, con los topes de la política de hoy (`lib/auth/rateLimit.ts`), que no limita por IP sola porque un colegio entero sale por una IP:
  - estudiante: 10 por IP y sujeto, 30 por sujeto desde cualquier IP. El sujeto es el par (código del colegio, usuario), normalizado;
  - profe: lo mismo, con el correo normalizado como sujeto;
  - recuperar contraseña: 3 por correo por hora y 20 por IP por hora;
  - abrir una tarjeta o una invitación: 30 por IP en 15 minutos, contando todos los intentos.
- Las claves son `<balde>:<hex de HMAC-SHA256(RATE_LIMIT_SECRET, valor)>`: nunca guardan una IP, un correo ni un usuario. Baldes: `student_pair`, `student_subject`, `staff_pair`, `staff_subject`, `reset_email`, `reset_ip`, `token_ip`.
- La IP sale de `x-nf-client-connection-ip` (Netlify). Si no está (local, pruebas), del primer valor de `x-forwarded-for`. Si tampoco, `unknown`.
- Al bloquearse, el servicio levanta `AppError("RATE_LIMITED", …, { retryAt })`, con el fin de la ventana más lejana. `retryAt` llega a la pantalla por `Failure.retryAt` (contrato).
- **Estudiantes: no hay otra puerta.** La contraseña del estudiante la verifica nuestro servidor (ver «Cómo entra un estudiante») y su cuenta de Auth no tiene contraseña. Nadie puede probar contraseñas de estudiantes contra `/auth/v1/token` salteando estos contadores.
- **Staff: las llamadas directas a Auth** (`/auth/v1/token` con la clave pública) no pasan por estos contadores. Las cubren las contraseñas de 10 caracteres como mínimo (`minimum_password_length = 10`), en producción la protección de contraseñas filtradas de Supabase, y el límite por IP de Auth. T2.7 verifica si Auth acepta la IP del cliente desde nuestro servidor (`Sb-Forwarded-For` con la clave secreta). Si la acepta, nuestras llamadas la mandan y los límites de Auth quedan en sus valores por defecto. Si no, se suben los límites de `/token` lo justo para un colegio entrando a la vez (T2.7 lo mide y lo anota).
- **Respuesta pareja (F2C-15, F2C-33).**
  - Un login de estudiante con un usuario que no existe hace el mismo trabajo que uno con la contraseña mal: verifica lo escrito contra un hash señuelo fijo, con los mismos parámetros de scrypt.
  - Todo login que no entra responde a los 800 ms como mínimo desde que empezó.
  - El límite se aplica igual a sujetos que no existen.
  - La única diferencia permitida es un código de colegio que no existe, que se dice con nombre porque el código no es secreto.
  - En el login del profe, un correo que no existe lo resuelve Auth: se acepta el riesgo de saber si un adulto del colegio tiene cuenta.

### Contraseña de un estudiante (F2C-47, F2C-53)

- Tres palabras cortas en español de una lista fija (`lib/domain/accounts/words.ts`, al menos 512 palabras de 3 a 5 letras, sin tildes, sin ñ y sin palabras que puedan ofender) y un número de dos cifras sin 0 ni 1: `sol-nube-tigre-47`. Unos 33 bits. Se genera con `crypto.randomInt`, nunca con `Math.random`.
- **Vive en nuestra base, no en Auth.** `app.student_credentials` guarda un hash scrypt (`crypto.scrypt` de Node, sin dependencia) y una `version` que sube en cada tarjeta. El hash se calcula en el servidor y nunca sale de él: ninguna RPC de usuario lo devuelve.
- **Parámetros fijos (F2C-62).** N = 2^15, r = 8, p = 1, clave de 32 bytes, sal de 16 bytes y `maxmem` de 64 MiB (sin `maxmem`, Node 24 rechaza esos parámetros). Formato `scrypt$15$8$1$<sal>$<hash>` en base64. `verifyPassword` valida estrictamente el formato, los parámetros y el largo de la sal y del hash decodificados, y compara con `timingSafeEqual`. El hash señuelo usa exactamente los mismos parámetros, y coincidir con él nunca abre una sesión: si la RPC devolvió campos nulos, el resultado es siempre «no coinciden».
- La cuenta de Auth del estudiante nace sin contraseña y nunca tiene una. Por eso GoTrue nunca la verifica ni la vuelve a cifrar (F2C-53), y emitir una tarjeta no escribe nada en Auth.
- El login normaliza lo que escribe el estudiante: minúsculas, sin espacios al borde, y cualquier tira de espacios o guiones pasa a un guion. Como la contraseña nace en ese formato, normalizar no pierde nada.
- La contraseña en claro no se guarda en ningún lado: solo va a la hoja que se imprime. Si se pierde, una tarjeta nueva crea otra.

### Usuario de un estudiante

- El nombre más la inicial del apellido, sin tildes, en minúscula y solo con `a-z0-9`: «Lucía Fernández» da `luciaf`. Si está tomado, `luciaf2`, `luciaf3`…
- La regla es pura (`lib/domain/accounts/username.ts`) y recibe los usuarios ya tomados, que da `list_taken_usernames`.
- El admin ve y puede cambiar cada usuario antes de crear (paso «revisar» del panel B). Si al crear alguien tomó el mismo, `create_student` da `CONFLICT username_taken` y esa fila vuelve a revisar.

### Correo sintético

`<auth_user_id>@estudiantes.usetiza.app`, fijo desde que se crea la cuenta. El spec decía `<student_id>`. Se usa el id de la cuenta de Auth, que es aleatorio y se elige antes de crearla (ver «Aprovisionar»), para que el correo no salga de un id que ven los profes. No hace falta cambiarlo: sin contraseña en Auth, conocer el correo no sirve para entrar.

- `lib/domain/accounts/email.ts` lo arma y lo reconoce.
- El subdominio no recibe correo.
- Recuperar contraseña rechaza un correo de ese dominio sin llamar a Auth, y una invitación a ese dominio da `INVALID invalid_email`.

### Cómo entra un estudiante (F2C-11, F2C-27, F2C-47)

1. El servicio aplica el límite de intentos al sujeto (colegio, usuario) y a la IP.
2. `internal_get_student_login(p_code, p_username)` devuelve `{institutionFound, authUserId, passwordHash, version}`. Los tres últimos solo vienen si el estudiante existe, no está archivado, su cuenta está `active` y tiene credencial; si no, son los tres `null`. La versión que usa el bind es la de esta misma lectura, la del hash que se verificó.
3. El servicio verifica lo escrito con `crypto.scrypt` y `timingSafeEqual`, contra `passwordHash` o, si es `null`, contra el hash señuelo.
4. Si coincide, abre la sesión de Supabase sin contraseña y **sin entregar cookies todavía** (F2C-56, F2C-60):
   - `auth.admin.generateLink({ type: 'magiclink', email: sintético })` da un `hashed_token`. No manda ningún correo. El servicio exige que `data.user.id` sea el `authUserId` de la RPC y que `verification_type` sea `magiclink`; si no, para con el error genérico;
   - un cliente de Supabase **sin cookies** (`persistSession: false`, solo en el servidor) hace `verifyOtp({ type: 'magiclink', token_hash })` y recibe la sesión: los tokens y su `session_id`.
5. `internal_bind_student_session(p_auth_user_id, p_session_id, p_version)` bloquea al estudiante (el mismo lock que toma `issue_access_cards`) y compara `p_version` con la versión vigente de su credencial.
   - Si son distintas (se emitió una tarjeta entre la verificación y este paso), borra esa sesión de `auth.sessions` y da `ok: false`: el servicio responde el error genérico.
   - Si son iguales, **registra la sesión** en `app.student_sessions` (`session_id`, `student_id`, `version`) y da `ok: true`.
6. Recién entonces el cliente de sesión del pedido hace `setSession` con esos tokens y deja las cookies.
7. Limpia los contadores del sujeto.

- **Una sesión de estudiante sin registro no lee nada (F2C-75).** Para una cuenta de estudiante, `app.session_alive()` exige además que su `session_id` esté en `app.student_sessions` con la versión vigente de su credencial. Una sesión que alguien obtuvo directo de Auth, sin pasar por nuestro servidor, nunca tiene registro: por ejemplo, adivinando en `/auth/v1/verify` el código de un magic link que quedó sin canjear, que GoTrue arma con un OTP de 6 dígitos. Esa sesión existe en `auth.sessions`, pero toda RPC la rechaza con `FORBIDDEN no_session`, y `getActor()` la trata como sin sesión. El registro solo lo escribe el bind, con `service_role`.
- **Por qué alcanza.** Si la tarjeta nueva se emite antes del paso 5, la versión no coincide: la sesión se borra y no se registra. Si se emite después, `issue_access_cards` sube la versión, borra las sesiones del estudiante y sus registros, y esa sesión deja de leer datos. No hay un orden en que la contraseña vieja, o un código adivinado, deje una sesión con acceso.
- Los tokens nunca salen del servidor salvo en las cookies del paso 6, y no se loguean. Los clientes de Supabase se crean con `debug: false` (con `debug`, `auth-js` registra sesiones completas). La prueba de fugas lo verifica.
- Si Auth responde 429 en `/verify`, el error es «Probá de nuevo en un minuto» (F2C-63). La contraseña ya se verificó bien, así que cuenta como un acierto: el servicio limpia las claves del sujeto igual que en el paso 7, y el reintento no queda bloqueado por nuestros contadores (F2C-69).

- **Las cuentas de Auth de estudiantes tienen una forma fija (F2C-47, F2C-57, F2C-58, F2C-60).** Un trigger `BEFORE INSERT OR UPDATE` en `auth.users` (`app.student_auth_guard`, `SECURITY DEFINER`, dueño `postgres`, `search_path = ''`) da P0004 en cualquiera de estos casos:
  - el correo que queda es del dominio sintético y no es exactamente `<id>@estudiantes.usetiza.app` de esa misma fila, o ese `id` no está recordado en una fila de `account_provisioning` que no esté `deleted`. Esto también frena el alta que GoTrue intenta cuando un `generateLink` no encuentra la cuenta;
  - el `id` está recordado y el correo que queda no es exactamente `<id>@estudiantes.usetiza.app` (también en un INSERT, y también NULL o cualquier otro dominio) (F2C-66);
  - en un UPDATE de una cuenta recordada, `encrypted_password` queda con algún valor.
  
  **En un INSERT de una cuenta recordada, el trigger pone `encrypted_password` en NULL** en vez de rechazarla (F2C-65): `auth.admin.createUser` sin contraseña igual genera una al azar y guarda su hash, así que rechazarla haría imposible crear la cuenta. Como nadie conoce esa contraseña y el trigger la borra antes de guardar, la cuenta nace sin contraseña. La prueba de integración crea una cuenta con `createUser` contra el Auth local y lee el valor guardado.
- **Las dos puntas de la relación (F2C-67).** Que un id quede recordado y que exista una fila de Auth con ese id se controla de los dos lados, con un mismo lock:
  - un trigger en `account_provisioning` (`BEFORE INSERT OR UPDATE OF auth_user_id, status`) toma el advisory del id recordado (el viejo y el nuevo, en orden) **también cuando cambia el `status`**. Así marcar `deleted` espera a un INSERT en Auth de ese id que todavía no confirmó, y la supresión recién después borra la cuenta de Auth, que ya se ve (F2C-74). Además exige que, si ya hay una fila en `auth.users` con ese id, tenga la forma fija (correo canónico y sin contraseña). Si no la tiene, da P0004, también contra un UPDATE directo del dueño;
  - los dos lados toman `pg_advisory_xact_lock` sobre el id (`hashtextextended('student_auth:' || id, 0)`). Así un INSERT en Auth y un «recordar» del mismo id nunca corren a la vez: el segundo espera a que el primero confirme, y en READ COMMITTED su consulta siguiente ya lo ve;
  - **orden de los locks (F2C-70): siempre la fila de `account_provisioning` primero y el advisory después.** Del lado de `account_provisioning`, la fila ya está bloqueada por el propio UPDATE o INSERT cuando corre el trigger, que toma el advisory. Del lado de `auth.users` hay **un solo trigger**, `app.student_auth_guard` (`BEFORE INSERT OR UPDATE`), que hace todo en este orden: `FOR SHARE` de las filas de `account_provisioning` con el id viejo y el nuevo (si existen), después el advisory de esos ids en orden, y recién después todas las comprobaciones (forma fija, `deleted`, cambio de id). Sale `app.student_auth_birth_guard`: sus reglas pasan a este trigger. Si no hay fila recordada, el lado de Auth solo toma el advisory, y no puede haber un ciclo;
  - `internal_remember_student_account` toma los mismos locks en el mismo orden (estudiante, su fila `FOR UPDATE` y el advisory) antes de su comprobación previa, así que una cuenta incompatible que aparece en el medio da `{ok: false}` y no P0004 (F2C-71). El P0004 queda para el DML directo;
  - en REPEATABLE READ o SERIALIZABLE esa consulta no vería lo confirmado, así que los dos triggers dan `40001` (serialization_failure) si la transacción no está en READ COMMITTED, como aceptó la fase 1 para sus carreras. GoTrue y nuestras RPC usan READ COMMITTED;
  - la prueba corre los dos órdenes con dos conexiones: insertar en Auth con contraseña mientras otro recuerda el id, y al revés.
  - en un UPDATE, cambia el `id` de una fila cuyo `id` viejo o nuevo está recordado, o cuyo correo viejo o nuevo es del dominio sintético;
  - en un UPDATE de una cuenta de estudiante, `email` o `encrypted_password` cambian de valor (`IS DISTINCT FROM`; se comparan valores y no columnas, porque GoTrue puede reescribir la fila entera).

  Las cuentas de staff no se tocan. Supabase permite triggers propios en `auth.users` desde una migración, sin cambiar el dueño de la tabla.
- **El otro orden.** `internal_remember_student_account` da `ok: false` si ya hay una fila en `auth.users` con ese id que no tiene la forma de arriba, antes de llegar al trigger.
- Así, alguien que copió la sesión de un estudiante no puede dejarse una contraseña propia en Auth (`PUT /auth/v1/user`), y cuando el profe emite una tarjeta nueva y se cierran las sesiones, pierde el acceso. El cambio de correo por `PUT /auth/v1/user` queda en `email_change` y se frena cuando se confirma.
- La prueba de integración llama a `PUT /auth/v1/user` con la sesión de un estudiante: la contraseña no cambia, y tampoco el correo después de confirmar.

### Aprovisionar una cuenta de estudiante (F2C-6 a F2C-8, F2C-25, F2C-49, F2C-54)

La cuenta de Auth de un estudiante tiene un id que se decide y se recuerda antes de crearla, así un reintento nunca crea una segunda. Se aprovisiona al emitir su primera tarjeta, o desde `reconcile`. Crear al estudiante en el panel no aprovisiona: deja la fila `pending`.

1. `internal_get_student_accounts` devuelve la fila. Si está `deleted`, para.
2. Si no tiene `authUserId`, el servicio elige uno (`crypto.randomUUID()`) y lo guarda con `internal_remember_student_account(p_provisioning_id, p_auth_user_id)`. Si ya había uno, la RPC devuelve ese, y se usa el guardado, nunca el propio. Con la fila `deleted` da `{ok: false}`.
3. **Primero pregunta, después crea (F2C-49).** `auth.admin.getUserById(authUserId)`:
   - si existe y su `app_metadata.provisioning_id` coincide, sigue;
   - si existe y no coincide, `internal_fail_student_account('account_mismatch')` y para;
   - si Auth responde que no existe (404), `auth.admin.createUser({ id: authUserId, email: sintético, email_confirm: true, app_metadata: { provisioning_id } })`, sin contraseña;
   - cualquier otra respuesta es incierta: para sin marcar nada, y lo retoma `reconcile`.
4. `internal_upsert_app_user` e `internal_link_student_user` (existen).

- **Crear es seguro de repetir.** Como la cuenta no tiene contraseña ni nada que se pueda pisar, dos aprovisionamientos a la vez convergen en la misma cuenta: uno la crea y el otro la encuentra.
- **Suprimir gana (F2C-25, F2C-54, F2C-58, F2C-59).** El mismo trigger `app.student_auth_guard` de `auth.users` busca el id que queda en `account_provisioning.auth_user_id` con `FOR SHARE`.
  - Si la fila está `deleted`, da P0004: una cuenta suprimida no vuelve a nacer, ni por un `createUser` atrasado, ni por un `INSERT` directo del dueño, ni por un `UPDATE` que le pone ese id a otra fila.
  - La marca no se pierde: una fila `deleted` de `account_provisioning` no se borra mientras exista su institución, aunque su estudiante ya no exista. Lo cambia la migración de contrato en `app.account_provisioning_kept` (T1.F12), con su prueba de `DELETE` seguido del `INSERT` en Auth, también con dos conexiones.
  - El `FOR SHARE` espera a una supresión en curso, que bloquea esa fila `FOR UPDATE`, y después lee el estado ya confirmado.
  - La supresión de la fase 9 marca `deleted` y recién después borra la cuenta de Auth, con borrado duro (`deleteUser(id, false)`): el borrado lógico de GoTrue reescribe el correo y el trigger lo rechazaría. Una creación que ganó el lock antes queda creada y la supresión la borra; una que llega después, la rechaza el trigger.
  - La fase 9 hereda este orden. La prueba ya existe acá, con dos conexiones.
- **Cuenta que desapareció de Auth sin que nadie suprimiera al estudiante** (alguien la borró a mano): con la fila `pending`, `failed` o `active` y el id recordado, se recrea con el mismo id y el estudiante conserva su identidad. **Cuenta de un estudiante suprimido** (`deleted`): nunca se recrea. La fila distingue los dos casos.
- `internal_fail_student_account` nunca cambia una fila `active` ni `deleted`: solo `pending` → `failed` o `failed` → `failed`. Un proceso atrasado no deshace el éxito de otro.

### Emitir tarjetas (F2C-4, F2C-5, F2C-30, F2C-31, F2C-50, F2C-51)

Emitir tarjetas es **una sola transacción** en la base: no escribe en Auth.

1. **Autoriza antes de tocar nada con el cliente admin (F2C-77, F2C-79).** Con la sesión, `list_group_accounts(p_group_id)`: `canIssueCards` tiene que ser verdadero y todos los estudiantes pedidos tienen que estar en la lista. Si no, termina (`FORBIDDEN` o `NOT_FOUND`) sin ninguna llamada admin. `provisionStudent` además descarta una fila que no existe o no está `pending`, `failed` o `active` antes de llamar a Auth. Después aprovisiona a quien le falte la cuenta (ver «Aprovisionar»). Los que no quedan `active` no entran en la emisión y vuelven en `others`: como `failed` si Auth rechazó o la fila no sirve, como `uncertain` si Auth no confirmó (F2C-64).
2. Genera por estudiante un token de tarjeta y una contraseña, y calcula el hash de cada una.
3. `issue_access_cards(p_group_id, p_cards, p_op_key)`, con la sesión, en una transacción:
   - autoriza;
   - bloquea a los estudiantes en orden de id;
   - por cada uno revoca la tarjeta vigente, inserta la nueva `active`, guarda el hash de la contraseña en `student_credentials` con `version + 1` y la emisión nueva en `issue_id`, y borra las sesiones de su cuenta en `auth.sessions`;
   - escribe `audit_log` (`access_card.issued`) con el conjunto;
   - registra la emisión con su `op_key`.
4. Devuelve las tarjetas para imprimir.

- **Dos emisiones a la vez** del mismo estudiante se ordenan por el lock: gana la última en confirmarse, y su contraseña es la que anda. La primera también imprimió, pero su tarjeta ya quedó revocada. Para no imprimir dos veces sin querer, la pantalla deshabilita «Imprimir» mientras corre su pedido.
- **Lo viejo deja de andar en el acto.** La contraseña anterior ya no coincide y la sesión abierta pierde el acceso a los datos (ver «Sesión vigente en la base»).
- **Idempotencia.** `op_key` con identidad, como en la fase 1. La identidad es `op_identity`: el hex de `sha256` del grupo y del conjunto ordenado de estudiantes. Es un resumen, no la lista, así que la emisión no guarda ids de estudiantes y la supresión no tiene nada que sacar de ella (F2C-30). Para un `op_key` repetido:
  - con otra identidad, `CONFLICT op_key_reused`;
  - con la misma, `CONFLICT card_issue_done`.

  Las contraseñas en claro no se guardan, así que una respuesta perdida no se puede repetir. La pantalla dice «Las tarjetas ya se crearon. Si no llegaste a imprimirlas, creá nuevas» y ofrece emitir con un `op_key` nuevo.
- **Reimprimir.** La página guarda en memoria las tarjetas que imprimió mientras está abierta, con «Imprimir de nuevo», que no crea contraseñas (ver «Pantallas»).

### Alta por invitación (F2C-2, F2C-3, F2C-8, F2C-22, F2C-23)

- **Aceptar con sesión** (`accept_invitation`). La RPC lee el correo actual de `auth.users` para `auth.uid()`, no el del JWT, y exige `email_confirmed_at`. Si no coincide con la invitación, `FORBIDDEN invitation_email_mismatch`. No usa `require_actor`: si la cuenta no tiene `app_user` (una alta anterior que se cortó), lo crea en la misma transacción, después de verificar el correo, con el nombre de `auth.users.raw_user_meta_data.display_name` si lo hay.
- **Aceptar sin cuenta.** El token es la credencial. Nunca se cambia la contraseña de una cuenta que ya existe:
  1. `internal_get_invitation(p_token_hash)` dice `hasAccount`: si ya hay una cuenta con ese correo. Solo con el token se puede preguntar, y solo por el correo de esa invitación (no hay búsqueda por correo libre).
  2. Si hay cuenta, la pantalla pasa a «Ya tenés cuenta: entrá para aceptar» (con «Olvidé mi contraseña»). Esto cubre también un intento anterior que creó la cuenta y se cortó: la persona eligió esa contraseña y la conoce.
  3. Si no hay, `auth.admin.createUser({ id: aleatorio, email, password, email_confirm: true, app_metadata: { invitation_id }, user_metadata: { display_name } })`. Auth no deja dos cuentas con el mismo correo: si dos pedidos llegan a la vez, uno gana y el otro recibe «Ya tenés cuenta».
  4. `internal_finish_invitation_signup(p_token_hash, p_user_id, p_display_name)` bloquea la invitación, exige que siga pendiente y vigente, y que la cuenta exista con el mismo correo, confirmado y con este `invitation_id`. Crea el `app_user`, suma la membresía y marca la invitación aceptada, todo en la misma transacción.
  5. `signInWithPassword` deja la sesión.
- Si la invitación se revocó o se rotó entre el paso 3 y el 4, la cuenta de Auth queda sin ninguna membresía y no da acceso a nada. Si la invitan de nuevo, entra por «Ya tenés cuenta» y `accept_invitation` crea su `app_user` (prueba: revocar, invitar de nuevo, entrar y aceptar).
- Sale `internal_find_auth_user`: con la cuenta del estudiante resuelta por id y la del profe por el token, no hace falta buscar por correo.

### Correos de invitación (F2C-5, F2C-32)

- Las invitaciones tienen `op_key` con identidad (correo y rol).
- Rotar el token (`resend_invitation`) sube `revision` y deja `sent_at` en NULL.
- `mark_invitation_sent(p_invitation_id, p_revision)` marca solo si la revisión es la del token que salió. Si otro rotó mientras tanto, da `CONFLICT revision_mismatch`, y el servicio lo ignora: ese correo llevaba un token viejo y el que rotó manda el suyo.
- Repetir un alta (`replayed`) cuyo correo no salió rota el token con `resend_invitation` y manda el correo nuevo.

### Recuperar la contraseña del profe (F2C-10)

1. `/ingresar/profesor/olvide` pide el correo. El servicio aplica el límite y llama a `resetPasswordForEmail`. Siempre responde «Si hay una cuenta con ese correo, te mandamos un enlace».
2. El enlace es `/ingresar/profesor/nueva#<token_hash>` y dura una hora (`otp_expiry = 3600`).
3. La página lee el fragmento y llama a `verifyRecoveryAction`, que hace `verifyOtp({ type: 'recovery', token_hash })` y deja una sesión. Si el enlace venció o ya se usó, muestra el estado «vencido».
4. La misma página pide la contraseña nueva. `setNewPasswordAction` hace `updateUser({ password })` y `signOut({ scope: 'others' })`, y lleva a `/grupos`.

`/ingresar/profesor/nueva` nunca redirige por tener sesión.

### La sesión

- `proxy.ts` refresca la sesión de Supabase en cada pedido de página y de API, salvo `/api/jobs/*` (fase 3), los archivos estáticos y `/_next`. Usa `@supabase/ssr` con `getClaims()` y escribe las cookies en la respuesta.
- `proxy.ts` hace solo el chequeo optimista (hay sesión, y de qué tipo). La autorización real está en `getActor()` y en la base, que además confirma que la sesión sigue viva.
- `getActor()` (`lib/server/auth/actor.ts`) devuelve el actor del pedido: `null`, un staff con sus instituciones y roles (`list_my_institutions`), o un estudiante con su institución (sin el id del estudiante: las RPC `student_*` lo sacan de la sesión). Usa `'use cache: private'` como dice la guía de Next 16 (`node_modules/next/dist/docs/`, autenticación con Cache Components). Si la guía dice otra cosa, manda la guía y el ticket lo anota.
- La cookie firmada de la demo (`lib/auth/signing.ts`, `session.ts`) sigue hasta T4.15, pero desde T2.8 solo abre la demo: `getActor()` la ignora, y ninguna RPC ni servicio la mira.
- Salir: `signOutAction` hace `signOut({ scope: 'local' })` y vuelve al login de su tipo. Está en la cabecera del profe y en la del estudiante.

### Quién ve qué pantalla

| Ruta | Quién |
|---|---|
| `/ingresar/profesor`, `/ingresar/profesor/olvide` | Cualquiera. Con sesión de staff, redirige a `/grupos` |
| `/ingresar/profesor/nueva` | Cualquiera. Nunca redirige |
| `/ingresar/estudiante`, `/ingresar/estudiante/escanear`, `/t` | Cualquiera. Con sesión de estudiante, redirige a `/estudiante` |
| `/invitacion` | Cualquiera con el token en el fragmento |
| `/grupos/**`, `/materia/**` | Staff con sesión, o la demo con su cookie (como hoy) |
| `/estudiante/**` | Estudiante con sesión, o la demo con su cookie (como hoy) |
| `/institucion/**` | Admin de esa institución |
| `/institucion/[institutionId]/grupos/[groupId]/tarjetas` | Admin, o staff del grupo |

Hasta la fase 4, el profe con cuenta real ve en `/grupos` la app de hoy, que guarda en el navegador, y el estudiante real ve en `/estudiante` un inicio vacío («Todavía no tenés prácticos»). Lo nuevo con datos del servidor son el panel de la institución y las tarjetas.

## Tablas y columnas nuevas

Todas en `app`, con RLS activado y forzado, sin políticas y sin privilegios, como en la fase 1. Cada una con `app.no_truncate` y sus guardias.

```sql
-- Una emisión de tarjetas: una transacción, que queda registrada para la idempotencia. No guarda ids de estudiantes:
-- op_identity es el sha256 (hex) del grupo y del conjunto ordenado de estudiantes, solo para comparar repeticiones.
create table app.access_card_issues (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  group_id uuid not null,
  op_key uuid not null,
  op_identity text not null check (op_identity ~ '^[0-9a-f]{64}$'),
  issued_by uuid references app.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (institution_id, id),
  unique (institution_id, op_key),
  -- Sin cascada (F2C-73): un grupo con emisiones no se borra, se archiva. NO ACTION y no RESTRICT, para que borrar la
  -- institución entera, que se lleva todo en la misma sentencia, siga andando.
  foreign key (institution_id, group_id) references app.groups (institution_id, id)
);

-- Una tarjeta de acceso: el QR que completa el colegio y el usuario. Una sola activa por estudiante.
create table app.access_cards (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null,
  issue_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (institution_id, id),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade,
  foreign key (institution_id, issue_id) references app.access_card_issues (institution_id, id) on delete cascade,
  check ((status = 'revoked') = (revoked_at is not null))
);
create unique index access_cards_active_key on app.access_cards (student_id) where status = 'active';

-- La contraseña de un estudiante (F2C-47): un hash scrypt, nunca en Auth. Credencial: sensible, solo para el servidor.
create table app.student_credentials (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null unique,
  password_hash text not null check (password_hash ~ '^scrypt[$]15[$]8[$]1[$][A-Za-z0-9+/=]+[$][A-Za-z0-9+/=]+$'),
  -- Sube en cada tarjeta: el login la compara antes de entregar la sesión (F2C-56).
  version integer not null default 1 check (version >= 1),
  -- La emisión que puso este hash: la vigente, no la primera (F2C-61).
  issue_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, id),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade,
  foreign key (institution_id, issue_id) references app.access_card_issues (institution_id, id) on delete cascade
);

-- Las sesiones de estudiante que abrió nuestro servidor después de verificar la contraseña (F2C-75). Solo el bind escribe
-- acá; issue_access_cards borra las del estudiante. Sin fila, la sesión de un estudiante no lee nada.
create table app.student_sessions (
  -- Se va sola cuando Auth borra la sesión (salir, revocar, borrar la cuenta): una sesión restaurada a mano no recupera
  -- su registro (F2C-78).
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null,
  version integer not null check (version >= 1),
  created_at timestamptz not null default now(),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade
);

-- Registro de todo hash de invitación que existió alguna vez. Un hash entra una sola vez, por el índice único, y no
-- se borra mientras exista la institución: así nunca vuelve a nacer, ni de a pasos ni con dos conexiones (F2C-39).
create table app.invitation_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  invitation_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (institution_id, invitation_id) references app.invitations (institution_id, id) on delete cascade
);

-- Invitaciones: idempotencia y cuándo salió el correo del token vigente.
alter table app.invitations add column op_key uuid;
alter table app.invitations add column op_identity text;
alter table app.invitations add column sent_at timestamptz;
create unique index invitations_op_key on app.invitations (institution_id, op_key) where op_key is not null;

```

Guardias (P0004, como en la fase 1; entran DML y TRUNCATE de cualquier rol, incluido el dueño y concurrente):

- **Pertenencia.** En tarjetas, emisiones y el registro de hashes no cambian `institution_id`, `student_id`, `issue_id`, `group_id`, `invitation_id`, `token_hash`, `op_key` ni `op_identity`, e `issued_by` solo pasa a NULL (el `on delete set null`). En invitaciones, `op_key` y `op_identity` no cambian una vez puestos.
- **Estados que solo avanzan.** Tarjeta: `active` → `revoked`. Una emisión no cambia nunca. Invitación: `accepted` y `revoked` son finales; `pending` y `expired` pueden pasar a `pending` solo con un `token_hash` nuevo.
- **Rotación de una invitación (F2C-29, F2C-39).** El `token_hash` de una invitación cambia solo en ese paso a `pending`. Todo `token_hash` que nace o llega a una invitación se inserta en `app.invitation_tokens` en la misma sentencia (trigger `AFTER INSERT OR UPDATE OF token_hash`), con un `insert` simple: si el hash ya estuvo alguna vez, el índice único lo rechaza (y espera a una transacción concurrente que lo esté insertando, en cualquier nivel de aislamiento). El trigger convierte ese `unique_violation` en P0004. No hay estado «vigente» ni «gastado»: el vigente es el que tiene la invitación, y todos los demás son historia.
- **Nacimiento.** Una tarjeta nace `active`. Una invitación nace `pending`, sin `accepted_by` (fase 1).
- **`deleted` es final (F2C-48).** En `account_provisioning`, una fila `deleted` no cambia de estado nunca más, también contra el dueño (P0004).
- **Las cuentas de Auth de los estudiantes (F2C-47, F2C-53, F2C-54).** Un trigger en `auth.users` y uno en `account_provisioning`, descritos en «Cómo entra un estudiante» y en «Aprovisionar»:
  - un solo trigger, `app.student_auth_guard` (`BEFORE INSERT OR UPDATE`), con la forma fija de una cuenta de estudiante y la regla de que una cuenta cuyo id está recordado en una fila `deleted` no nace ni se arma por UPDATE, en el orden de locks de «Las dos puntas»;
  - en `account_provisioning`, `app.student_auth_link_guard` (`BEFORE INSERT OR UPDATE OF auth_user_id, status`), que toma el advisory y exige la forma fija de una cuenta de Auth que ya existe con ese id.
- **La marca de supresión se conserva (F2C-59).** Una fila `deleted` de `account_provisioning` no se borra mientras exista su institución.
  
  Las cuentas de staff no se tocan. Supabase permite triggers propios en `auth.users` desde una migración, sin cambiar el dueño de la tabla.
- **Sesiones registradas.** En `student_sessions` no cambia nada: se inserta (el bind) o se borra (la emisión, la cascada del estudiante o la de `auth.sessions`). Una fila nueva exige que su `session_id` exista en `auth.sessions` (la FK) y que su versión sea la vigente de la credencial (guardia).
- **Credenciales (F2C-61).** `student_credentials` solo se escribe dentro de `issue_access_cards`, y no se borra mientras exista su estudiante: se va con él por la cascada. `password_hash`, `issue_id` y `version` cambian juntos o no cambian: un UPDATE que cambia alguno tiene que cambiar `issue_id` a otra emisión y subir `version` exactamente en uno. `institution_id` y `student_id` no cambian.
- **Memoria (F2C-19, F2C-28).** Mientras exista su institución, no se borran las invitaciones ni las filas de `invitation_tokens`, y esas filas no cambian. Las tarjetas no se borran mientras exista su estudiante: solo se van con él, por la cascada. Las emisiones no se borran mientras exista su institución, y un grupo con emisiones no se borra: se archiva (F2C-73). Así un hash revocado no vuelve a nacer vigente por `DELETE` e `INSERT`. La retención de la fase 9 borra el correo de una invitación vieja con una redacción, sin borrar la fila. Para eso la fase 9 suma, en una migración nueva, una excepción acotada a la guardia del correo de `invitations_frozen` (T1.F15): solo en modo de supresión o retención, solo para invitaciones `accepted`, `revoked` o `expired` con más de 90 días, y solo hacia un valor redactado; con su prueba (F2C-42).

**Inventario.** `access_cards`, `student_credentials` y `student_sessions` tienen datos de estudiantes (el id, el hash del token y el de la contraseña); al borrar al estudiante se van por la cascada. `student_credentials` es una credencial: ninguna proyección la devuelve y ningún log la lleva. `access_card_issues` no tiene ningún dato de un estudiante. Se suman a `docs/PRIVACIDAD-DATOS.md`, `lib/domain/permissions/tables.ts` y `006_inventory.test.sql`. `invitations.email` es un dato personal de un adulto; su retención (redactar 90 días después de aceptada, revocada o vencida) la programa la fase 9. `invitation_tokens` no tiene datos personales.

## RPC nuevas

Siguen las reglas de la fase 1: `perform app.rpc_begin();` primero, errores con `app.raise_error`, salida `jsonb` de claves cerradas en camelCase, `internal_*` solo para `service_role`, las demás para `authenticated`. La matriz de permisos (`lib/domain/permissions/matrix.ts`) suma cada una.

### Sesión (T2.7)

| RPC o función | Quién | Qué |
|---|---|---|
| `app.session_alive()` → `boolean` | ver «Sesión vigente en la base» | `true` si no hay `session_id` en los claims, o si esa sesión existe en `auth.sessions` y, para una cuenta de estudiante, además está en `app.student_sessions` con la versión vigente de su credencial (F2C-75; la parte del estudiante la suma T2.5a) |
| `app.rpc_begin()` (cambia) | todas | Suma: si `app.session_alive()` es falso, `FORBIDDEN no_session` |
| `internal_revoke_user_sessions(p_user_id uuid)` → `{revoked}` | service_role | Borra las sesiones de ese usuario en `auth.sessions` |

### Límite de intentos (T2.7)

| RPC | Quién | Qué |
|---|---|---|
| `internal_rate_limit_hit(p_keys text[], p_limits integer[], p_window_seconds integer)` → `{allowed, retryAt}` | service_role | Suma uno en la ventana actual de cada clave (hasta 4) con `insert … on conflict (key, window_start) do update … returning count`, en una sola sentencia. `allowed` es falso si alguna pasó su tope; `retryAt`, el fin de la ventana. De paso borra hasta 100 ventanas de más de un día |
| `internal_rate_limit_clear(p_keys text[])` → `{cleared}` | service_role | Borra la ventana actual de esas claves |

`window_start` es `to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)`.

### Invitaciones e institución (T2.3)

| RPC | Quién | Qué |
|---|---|---|
| `create_invitation(p_institution_id uuid, p_email text, p_role text, p_token_hash bytea, p_op_key uuid)` → `{id, expiresAt, sentAt, revision, replayed}` | admin de la institución, no en un sandbox | Normaliza el correo. Vence a los 7 días. Ya es miembro activo con ese rol: `INVALID already_member`. Hay una pendiente para el mismo correo y rol: `CONFLICT invitation_pending`. Correo del dominio sintético: `INVALID invalid_email`. Mismo `op_key` y misma identidad: devuelve la misma con `replayed: true` y sin tocar el hash |
| `resend_invitation(p_invitation_id uuid, p_revision integer, p_token_hash bytea)` → `{id, expiresAt, revision}` | admin | Pendiente o vencida: pendiente con hash nuevo, 7 días más, `revision + 1` y `sent_at` NULL. Aceptada o revocada: `INVALID invitation_closed` |
| `revoke_invitation(p_invitation_id uuid, p_revision integer)` → `{id}` | admin | Solo una pendiente o vencida |
| `mark_invitation_sent(p_invitation_id uuid, p_revision integer)` → `{id}` | admin | `sent_at = now()` solo si la revisión es esa; si no, `CONFLICT revision_mismatch` |
| `list_invitations(p_institution_id uuid)` → `{items: [{id, email, role, status, expiresAt, sentAt, invitedByName, createdAt, revision}]}` | admin | `status` efectivo: una pendiente vencida sale `expired` |
| `list_institution_staff(p_institution_id uuid)` → `{items: [{userId, displayName, email, roles, hasSignedIn}]}` | admin | Membresías activas de staff. `hasSignedIn` sale de `auth.users.last_sign_in_at` |
| `get_institution_summary(p_institution_id uuid)` → `{id, name, code, staffCount, pendingInvitations, groupCount, studentCount}` | admin | Para el inicio del panel B |
| `list_enabled_subjects()` → `{items: [{id}]}` | authenticated | Las materias con `enabled`, para elegir la del grupo nuevo (F2C-34). El nombre en español sale del catálogo de materias del código, nunca de un literal |
| `internal_get_invitation(p_token_hash bytea)` → `{id, institutionName, role, email, inviterName, status, expiresAt, hasAccount}` o `NOT_FOUND` | service_role | Para la página de la invitación. `hasAccount`: hay una cuenta de Auth con el correo de esta invitación |
| `internal_create_invitation(p_institution_id uuid, p_email text, p_role text, p_token_hash bytea)` → `{id, expiresAt, revision}` | service_role | Solo para el comando de administración (T2.2): sin actor |
| `internal_finish_invitation_signup(p_token_hash bytea, p_user_id uuid, p_display_name text)` → `{institutionId, role}` | service_role | Ver «Alta por invitación» |
| `accept_invitation(p_token_hash bytea)` → `{institutionId, role}` | authenticated | Ver «Alta por invitación». Bloquea la invitación `FOR UPDATE`. Vencida: `INVALID invitation_expired`. Revocada: `INVALID invitation_closed`. Ya aceptada por el mismo usuario: devuelve lo mismo; por otro, `INVALID invitation_closed`. Suma la membresía y deja `accepted_by` y `accepted_at`. Un estudiante no puede: `CONFLICT role_conflict` (el trigger de la fase 1) |

Razones nuevas: `already_member`, `invitation_pending`, `invitation_closed`, `invitation_expired`, `invitation_email_mismatch`, `invalid_email`, `invalid_token`.

### Cuentas de estudiantes (T2.5a)

| RPC | Quién | Qué |
|---|---|---|
| `list_taken_usernames(p_institution_id uuid, p_bases text[])` → `{items: text[]}` | admin o profe de la institución | Usuarios que son una base o una base seguida de dígitos. Hasta 200 bases |
| `list_group_accounts(p_group_id uuid)` → `{groupName, institutionCode, canIssueCards, items: [{studentId, displayName, username, accountStatus, hasSignedIn, lastCardAt}]}` | staff del grupo o admin | `accountStatus`: `pending`, `active`, `failed` o `none`. `none` es la fila `not_applicable` de un sandbox (fase 1); una escuela sin fila de aprovisionamiento es un error de datos y da P0004 (F2C-83). `canIssueCards` lo calcula la base con las mismas reglas que `issue_access_cards` (rol y que no sea un sandbox) (F2C-79). Inscripciones activas, sin archivados. No es sensible |
| `issue_access_cards(p_group_id uuid, p_cards jsonb, p_op_key uuid)` → `{institutionCode, institutionName, items: [{studentId, displayName, username}]}` | staff del grupo o admin, no en un sandbox | `p_cards` es `[{studentId, tokenHash, passwordHash}]`, de 1 a 60, el hash del token en hex y el de la contraseña en el formato scrypt. Ver «Emitir tarjetas». No inscripto, archivado o sin cuenta `active`: `INVALID not_enrolled`. Forma mala: `INVALID invalid_cards`. `op_key` repetido: `CONFLICT card_issue_done` u `op_key_reused` |
| `internal_get_student_accounts(p_student_ids uuid[])` → `{items: [{studentId, provisioningId, status, authUserId}]}` | service_role | Hasta 60 |
| `internal_remember_student_account(p_provisioning_id uuid, p_auth_user_id uuid)` → `{ok: true, authUserId}` o `{ok: false}` (F2C-46) | service_role | `ok: false` si la fila está `deleted`. Guarda el id si no había; si había, devuelve el guardado. Bajo el lock del estudiante y después el de la fila, en ese orden |
| `internal_fail_student_account(p_provisioning_id uuid, p_error_code text)` → `{status, attempts}` | service_role | Solo `pending` → `failed` o `failed` → `failed`; con `active` o `deleted` no cambia nada |
| `internal_list_unfinished_accounts(p_limit integer)` → `{items: [{studentId, provisioningId, status, authUserId}]}` | service_role | Dos casos, sin archivar y nunca `deleted`: `pending` y `failed` con `authUserId` recordado (un aprovisionamiento que empezó y no terminó) y menos de 5 intentos; y `active` cuyo `authUserId` ya no está en `auth.users` (una cuenta que alguien borró a mano, F2C-72) |
| `internal_bind_student_session(p_auth_user_id uuid, p_session_id uuid, p_version integer)` → `{ok}` | service_role | Ver «Cómo entra un estudiante». Bloquea al estudiante como `issue_access_cards`. Con otra versión borra esa sesión y da `ok: false` |
| `internal_find_institution(p_code text)` → `{code, name}` o `NOT_FOUND` | service_role | Solo escuelas |
| `internal_get_student_login(p_code text, p_username text)` → `{institutionFound, authUserId, passwordHash, version}` | service_role | Ver «Cómo entra un estudiante». Los tres últimos solo si el estudiante existe, no está archivado, su cuenta está `active` y tiene credencial; si no, los tres `null`. Es la única RPC que devuelve un hash de contraseña, y solo a `service_role` |
| `internal_resolve_access_card(p_token_hash bytea)` → `{institutionCode, institutionName, username}` o `NOT_FOUND` | service_role | Tarjeta `active`, estudiante sin archivar, cuenta `active`, escuela. Nunca el nombre del estudiante |

Razones nuevas: `invalid_cards`, `card_issue_done`.

## Servicios

Las capas de `eslint/rules/layers.mjs` mandan (F2C-35):

- `db/client.ts` solo entra en `lib/server/repos/*.ts`. Por eso toda llamada con la sesión del usuario, también las de Auth (`signInWithPassword`, `signOut`, `verifyOtp`, `updateUser`, `getClaims`), vive en un repo de sesión: `lib/server/repos/auth-session.ts`.
- `repos/admin/**` solo entra en `services/admin/**`, `jobs/**` y `tests/**`. Por eso todo lo que usa el cliente admin vive en `lib/server/services/admin/`. Los servicios públicos (`services/*.ts`) llaman a esos servicios, nunca a los repos admin.
- `app/**` llama a servicios y nunca a repos.
- **De dónde sale el cliente (F2C-41, F2C-45).** `lib/server/repos/db.ts` exporta `sessionDb(): Promise<RpcDb>` (el cliente de sesión del pedido). `lib/server/repos/admin/db.ts` exporta `adminDb(): RpcDb` (el cliente admin para las RPC) y `authAdmin()` (el `auth.admin` de un cliente admin creado con `global: { fetch }` que corta a los 5 s). `repos/admin/auth-users.ts` usa solo `authAdmin()`, nunca `db/admin.ts` directo, y su test comprueba el corte con un servidor que no responde. Un servicio pide el cliente ahí y se lo pasa a los repos existentes, que ya reciben un `RpcDb`; nunca lo usa directamente. `sessionDb` lo escribe T2.1; `adminDb` y `authAdmin`, T2.7.

Los cuerpos del contrato levantan `AppError("UNAVAILABLE", "Todavía no está disponible.")`.

| Archivo | Funciones | Usa | Ticket |
|---|---|---|---|
| `lib/server/auth/actor.ts` | `getActor()`, `requireStaff()`, `requireAdmin(institutionId)`, `requireStudent()` | `repos/auth-session.ts` (claims), `repos/institutions.ts` (`list_my_institutions`) | T2.1 |
| `lib/server/auth/request.ts` | `clientIp(headers)` | | T2.7 |
| `lib/server/repos/auth-session.ts` | `getClaims`, `signInWithPassword`, `signOut(scope)`, `verifyRecoveryOtp`, `setSessionTokens(tokens)`, `updatePassword`, `requestPasswordReset` | `db/client.ts` | T2.1 (`getClaims`), T2.3 (lo demás) y T2.5b (`setSessionTokens`) |
| `services/admin/rate-limit.ts` | `hitAttempt(keys, limits, windowSeconds)`, `clearAttempts(keys)` | `repos/admin/rate-limits.ts` | T2.7 |
| `services/admin/sessions.ts` | `revokeUserSessions(userId)` | `repos/admin/sessions.ts` | T2.7 |
| `services/rate-limit.ts` | `guardAttempt(kind, ip, subject)` (cuenta y levanta `RATE_LIMITED`), `clearSubject(kind, subject, ip)` (con la IP limpia también la clave del par) | `services/admin/rate-limit.ts` | T2.7 |
| `lib/server/repos/admin/auth-users.ts` | `createAuthUser`, `getAuthUser`, `deleteAuthUser`, `magicLinkToken(email)` (`generateLink` de tipo `magiclink`; devuelve el `hashed_token`, el id del usuario y el tipo), `exchangeMagicLink(tokenHash)` (`verifyOtp` en un cliente sin cookies; devuelve los tokens y el `session_id`), todos con el corte de 5 s. `exchangeMagicLink` usa `otpExchangeClient()`, una fábrica que T2.3 suma a `repos/admin/db.ts`: un cliente nuevo por operación, con la clave pública, `persistSession: false`, `autoRefreshToken: false`, `debug: false` y el mismo `fetch` de 5 s (F2C-80) | `repos/admin/db.ts` (`authAdmin()`) | T2.3 (T2.5b lo usa, no lo cambia) |
| `services/admin/invitation-signup.ts` | `readInvitationByToken(tokenHash)`, `createInvitedAccount(…)`, `finishInvitationSignup(…)`, `createInvitationAsOperator(…)` | `repos/admin/invitations.ts`, `repos/admin/auth-users.ts` | T2.3 |
| `services/staff-auth.ts` | `signInStaff({email, password, ip})`, `requestPasswordReset({email, ip, origin})`, `verifyRecovery({tokenHash})`, `setNewPassword({password})`, `signOut()` | `repos/auth-session.ts`, `services/rate-limit.ts` | T2.3 |
| `services/invitations.ts` | `inviteStaff({institutionId, emails, role, opKey, origin})` (resultado por correo), `resendInvitation`, `revokeInvitation`, `readInvitation({token, ip})` (con la relación de la sesión: `none`, `same` u `other`), `acceptInvitation({token})`, `acceptInvitationAsNewUser({token, displayName, password, ip})` | `repos/invitations.ts`, `services/admin/invitation-signup.ts`, `lib/server/mail/` | T2.3 |
| `services/institution.ts` | `getInstitutionSummary(id)`, `listStaff(id)`, `listInvitations(id)`, `listGroups(id)`, `listSubjects()`, `createGroup({institutionId, name, subjectId, schoolYear, opKey})` | `repos/institution.ts`, `repos/groups.ts` | T2.3 |
| `services/admin/provisioning.ts` | `provisionStudent({studentId, provisioningId})` (devuelve `active`, `failed` o `uncertain`), `reconcile(limit)` | `repos/admin/student-accounts.ts`, `repos/admin/students.ts`, `repos/admin/auth-users.ts` | T2.5b |
| `services/admin/student-login.ts` | `studentLogin(code, username)` (con el hash y la versión), `openStudentSession(authUserId, version)` (generateLink, verifyOtp sin cookies y bind; devuelve los tokens o nada), `findInstitution(code)`, `resolveAccessCard(tokenHash)` | `repos/admin/student-accounts.ts`, `repos/admin/auth-users.ts` | T2.5b |
| `services/student-accounts.ts` | `previewUsernames({institutionId, names})`, `createStudentAccounts({groupId, rows, opKey})`, `listGroupAccounts(groupId)`, `issueAccessCards({groupId, studentIds, opKey, origin})` | `repos/student-accounts.ts`, `repos/students.ts`, `services/admin/provisioning.ts` | T2.5b |
| `services/student-auth.ts` | `findInstitution({code, ip})`, `signInStudent({code, username, password, ip})`, `readAccessCard({token, ip})` | `services/admin/student-login.ts`, `repos/auth-session.ts`, `services/rate-limit.ts` | T2.5b |
| `lib/server/mail/` | `MailSender`, `getMailSender()`, `invitationMail(…)` | | T2.3 |

Tipos en `lib/domain/accounts/`: `Actor`, `AccessCard`, `InvitationView`, `StaffRow`, `AccountRow`, `UsernameDraft`, `InstitutionSummary`, y las reglas puras `username.ts`, `password.ts`, `email.ts`, `words.ts`, `normalize.ts`. El hash scrypt (`lib/server/auth/password-hash.ts`: `hashPassword`, `verifyPassword`, `DECOY_HASH`) vive en el servidor porque usa `node:crypto`.

**Crear cuentas** (`createStudentAccounts`): por cada fila, `create_student` con un `op_key` derivado del `opKey` del pedido y el índice de la fila (UUID v5). No aprovisiona: la cuenta de Auth nace con la primera tarjeta (ver «Aprovisionar»). Un error en una fila no frena las demás. El resultado dice, por fila, si se creó.

**Emitir tarjetas** (`issueAccessCards`): aprovisiona a quien le falte la cuenta, genera por estudiante un token y una contraseña con sus hashes, y llama a `issue_access_cards`. Devuelve `{cards: [{studentId, displayName, username, institutionCode, institutionName, password, qrUrl}], others: [{studentId, outcome}]}`, con `outcome` en `failed` (no se le pudo crear la cuenta) o `uncertain` (Auth no confirmó; se puede probar de nuevo enseguida). Esa respuesta no se cachea, no se loguea y no pasa por ningún error.

**Reconciliar** (`reconcile`): `internal_list_unfinished_accounts` y el mismo aprovisionamiento. Una cuenta `active` que desapareció de Auth se recrea con el mismo id y el estudiante vuelve a entrar con su contraseña de siempre, que vive en nuestra base (F2C-72). Solo reintenta filas `failed` o `pending` que ya tienen `authUserId` recordado, o sea, aprovisionamientos que empezaron y no terminaron. Hasta la fase 3 corre a mano con `npm run admin:reconcile`.

**Encabezados de las páginas con token.** `/invitacion`, `/t` e `/ingresar/profesor/nueva` responden con `Cache-Control: no-store` y `Referrer-Policy: no-referrer`. Los pone `proxy.ts` (T2.1), porque un Client Component no puede.

## Entradas

| Archivo | Acciones |
|---|---|
| `app/ingresar/profesor/actions.ts` | `signInStaffAction`, `requestResetAction`, `verifyRecoveryAction`, `setNewPasswordAction` |
| `app/ingresar/estudiante/actions.ts` | `findInstitutionAction`, `signInStudentAction`, `readAccessCardAction` |
| `app/invitacion/actions.ts` | `readInvitationAction`, `acceptInvitationAction`, `acceptAsNewUserAction`, `signInAndAcceptAction` |
| `app/salir/actions.ts` | `signOutAction` |
| `app/institucion/[institutionId]/actions.ts` | `inviteStaffAction`, `resendInvitationAction`, `revokeInvitationAction`, `previewUsernamesAction`, `createStudentAccountsAction`, `createGroupAction` |
| `app/institucion/[institutionId]/grupos/[groupId]/tarjetas/actions.ts` | `issueAccessCardsAction` |

Cada acción valida con zod, llama a un servicio y devuelve `Result`. Ninguna pasa de unas pocas líneas. La IP la lee la acción con `clientIp(await headers())` y se la pasa al servicio. Las lecturas de las páginas del panel y de las tarjetas son Server Components que llaman a los servicios de lectura.

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
- **Escanear.** Usa `BarcodeDetector` donde exista: lee la URL del QR, toma el fragmento y sigue como `/t`. Si no existe o no hay cámara, explica que se puede abrir la cámara del celular y apuntar al código, y ofrece escribir los datos. No entra una dependencia para leer QR.

Las tarjetas (B):

- **Elegir.** Se elige a quiénes en una lista con casillas (todo el grupo marcado de entrada) y se ve una tarjeta de muestra con «Se crea al imprimir».
- **Confirmar.** Antes, un diálogo avisa que imprimir crea contraseñas nuevas, que las anteriores dejan de andar y que se cierran las sesiones abiertas de esos estudiantes.
- **Imprimir.** Al confirmar, la acción devuelve las tarjetas y la página las pone en un contenedor que solo se ve al imprimir (`@media print`) y llama a `window.print()`. En pantalla, las contraseñas nunca aparecen. Quedan en la memoria del componente mientras la página está abierta, para «Imprimir de nuevo» sin crear contraseñas, y se borran con «Listo» o al salir de la página (`pagehide`). Nunca van a `localStorage`, `sessionStorage` ni a la URL (F2C-52).
- **Tarjeta nueva.** Cada fila tiene «Tarjeta nueva», que hace lo mismo para un solo estudiante.
- **Si algo falló.** La página lista a quiénes no se les pudo crear la tarjeta, con «Probar de nuevo».
- **El QR.** Un SVG generado en el navegador con una función propia (`lib/client/qr.ts`, sin dependencia: modo byte, corrección M, versión mínima que entre), con la URL `https://<origen>/t#<token>`.

## Tickets

Tandas. Cada tanda tiene a lo sumo un ticket con migraciones (turno de base) y nunca más de 4 implementadores a la vez. Los de front trabajan contra los stubs del contrato: prueban sus componentes con servicios simulados, y su Playwright corre cuando el back de su flujo está mergeado.

| Tanda | Turno de base | En paralelo |
|---|---|---|
| 1 | T2.7 sesión vigente y límites | T2.1 sesión en el proxy, T2.4 login del profe e invitación, T2.6a login del estudiante |
| 2 | T2.3 invitaciones | T2.9 panel de la institución, T2.6b tarjetas |
| 3 | T2.5a cuentas de estudiantes (SQL) | T2.2 comando de administración |
| 4 | | T2.5b servicios de cuentas, T2.5c pruebas de la fase 1 con cuentas canónicas, T2.8 puente de la sesión vieja |

```
T2.1 · La sesión en el proxy y el actor
Agente: backend          Tanda: 1        Depende de: contrato
Turno de base: no
Objetivo: cada pedido refresca la sesión de Supabase y el código pregunta quién es el actor en un solo lugar.
Archivos: proxy.ts (solo refresco y cookies de Supabase; las reglas de áreas siguen como están hasta T2.8),
  los encabezados no-store y no-referrer de las páginas con token, lib/server/auth/actor.ts,
  lib/server/auth/session-proxy.ts, lib/server/repos/auth-session.ts (solo getClaims), lib/server/repos/db.ts (sessionDb), lib/server/auth/*.test.ts,
  tests/integration/auth/actor.test.ts.
Criterios: el proxy refresca y no toca /api/jobs ni estáticos; getActor devuelve null, staff (con instituciones y
  roles) o estudiante; la cookie de la demo no da actor; requireAdmin de otra institución da FORBIDDEN.
Fuera de alcance: pantallas, reglas de áreas, borrar lib/auth.
```

```
T2.7 · Sesión vigente en la base y límite de intentos
Agente: backend          Tanda: 1        Depende de: contrato
Turno de base: sí
Objetivo: una sesión cerrada ya no lee datos, y los intentos se cuentan en Postgres antes de probar.
Archivos: supabase/migrations/20261114110000_t2_7_sessions_rate_limits.sql, supabase/tests/041_sessions_rate_limits.test.sql,
  supabase/tests/helpers (si hace falta un helper de sesión), lib/server/repos/admin/rate-limits.ts,
  lib/server/repos/admin/sessions.ts, lib/server/repos/admin/db.ts (adminDb y authAdmin con el fetch de 5 s), lib/server/services/admin/rate-limit.ts, lib/server/services/admin/sessions.ts,
  lib/server/services/rate-limit.ts (+ test), lib/server/auth/request.ts (+ test), supabase/tests/005_student_role.test.sql
  (sumar app.session_alive a las excepciones revisadas),
  supabase/config.toml ([auth.rate_limit], minimum_password_length), package.json y package-lock.json (solo sacar
  @upstash/*), .env.example (RATE_LIMIT_SECRET), tests/integration/races/rate-limit.test.ts,
  tests/integration/auth/session-revoked.test.ts, docs/contratos/fase-2-notas.md (lo que midió de Sb-Forwarded-For).
Criterios: los límites de Auth de /token y de /verify (token_verifications) medidos y ajustados para un colegio entrando a
  la vez, anotados en fase-2-notas.md (F2C-63); rpc_begin rechaza un session_id borrado y acepta uno vivo y la ausencia de claim, también en una RPC
  student_* que corre como tiza_student; las 2806 pruebas pgTAP
  siguen; una ráfaga de 50 intentos concurrentes al mismo sujeto deja pasar a lo sumo el tope; la clave nunca lleva
  el valor en claro; retryAt es el fin de la ventana; las ventanas viejas se borran; Sb-Forwarded-For medido y anotado.
Fuera de alcance: cambiar lib/auth/actions.ts (lo hace T2.8).
```

```
T2.4 · Login del profe, recuperar la contraseña e invitación (front)
Agente: frontend          Tanda: 1        Depende de: contrato
Turno de base: no
Objetivo: el profe entra, recupera su contraseña y acepta una invitación con las pantallas elegidas.
Archivos: app/ingresar/profesor/** (page.tsx, olvide/, nueva/; actions.ts ya existe: implementar sus cuerpos finos),
  app/invitacion/** (page.tsx; actions.ts ídem), app/salir/**, components/auth/staff/**, tests de componentes al lado,
  tests/e2e/staff-auth.spec.ts (para cerrar la tanda 2).
Criterios: estados de login-profe-a con el error por campo y el bloqueo de B (con retryAt), los estados de
  recuperar (enviado, vencido, nueva), invitacion-a con la marca de B y sus seis casos; el token se lee del fragmento y
  se borra de la barra; foco y role="alert"; 320 px; axe sin errores.
Fuera de alcance: servicios (usa los del contrato), proxy.ts, el login viejo (lo borra T2.8).
```

```
T2.6a · Login del estudiante (front)
Agente: frontend          Tanda: 1        Depende de: contrato
Turno de base: no
Objetivo: el estudiante entra con los tres datos de su tarjeta o escaneándola.
Archivos: app/ingresar/estudiante/** (page.tsx, escanear/; actions.ts ya existe), app/t/page.tsx,
  components/auth/student/**, lib/client/remembered-school.ts (+ test), tests de componentes al lado,
  tests/e2e/student-auth.spec.ts (para la tanda 4).
Criterios: estados de login-estudiante-a (colegio recordado, error neutro, pausa con retryAt) y el escaneo de C como
  segunda puerta; /t lee el fragmento y completa colegio y usuario; nada en rojo; no se borra lo escrito; pegar y
  gestor de contraseñas; axe.
Fuera de alcance: servicios, tarjetas.
```

```
T2.3 · Invitaciones, login del profe y lecturas del panel (back)
Agente: backend          Tanda: 2        Depende de: T2.7, T2.1
Turno de base: sí
Objetivo: un admin invita profes y admins, el correo sale, la invitación se acepta con o sin cuenta, y el profe
  entra, recupera la contraseña y sale.
Archivos: supabase/migrations/20261114120000_t2_3_invitations.sql, supabase/tests/042_invitations.test.sql,
  supabase/tests/030_reasons.test.sql, lib/domain/errors/reasons.ts, supabase/templates/recovery.html,
  supabase/config.toml ([auth.email.template.recovery]), lib/server/repos/invitations.ts, lib/server/repos/institution.ts,
  lib/server/repos/admin/invitations.ts, lib/server/repos/admin/auth-users.ts, lib/server/repos/admin/db.ts (solo sumar
  otpExchangeClient), lib/server/repos/auth-session.ts (salvo
  getClaims), lib/server/services/admin/invitation-signup.ts, lib/server/services/invitations.ts,
  lib/server/services/institution.ts, lib/server/services/staff-auth.ts, lib/server/mail/**,
  tests/integration/invitations/**, tests/integration/auth/staff-auth.test.ts, .env.example (MAIL_*).
Criterios: las RPC de «Invitaciones» con las reglas comunes de pgTAP; aceptar con otro correo (también con un JWT
  viejo después de cambiar el correo) da FORBIDDEN; dos aceptaciones a la vez dejan una membresía; alta sin cuenta
  con revocación concurrente no deja membresía; revocar, invitar de nuevo, entrar y aceptar crea el app_user; dos altas
  sin cuenta a la vez dejan una cuenta y una membresía; ninguna alta cambia la contraseña de una cuenta que ya existía;
  mark_invitation_sent atrasado da revision_mismatch; un hash gastado no vuelve por DELETE e INSERT; recuperar con
  límite y sin llamar a Auth para un correo sintético; respuesta pareja en el login; ningún log con token o correo.
```

```
T2.9 · Panel de la institución (front)
Agente: frontend          Tanda: 2        Depende de: contrato
Turno de base: no
Objetivo: el admin invita profes y crea cuentas de estudiantes pegando una lista y revisándola antes.
Archivos: app/institucion/** (salvo grupos/[groupId]/tarjetas; actions.ts ya existe), components/institution/**,
  tests al lado, tests/e2e/institution.spec.ts (para la tanda 4).
Criterios: estados de admin-b (pegar, revisar con repetidos y correos mal escritos, creadas) y las listas de admin-a en
  «Ver profes e invitaciones» (sin cambiar roles); elegir o crear el grupo; cambiar un usuario en la revisión; axe.
```

```
T2.6b · Tarjetas de acceso (front)
Agente: frontend          Tanda: 2        Depende de: contrato
Turno de base: no
Objetivo: el profe imprime las tarjetas de su grupo sin que las contraseñas aparezcan en pantalla.
Archivos: app/institucion/[institutionId]/grupos/[groupId]/tarjetas/** (actions.ts ya existe),
  components/access-cards/**, lib/client/qr.ts (+ test), tests al lado.
Criterios: estados de tarjetas-b; «Tarjeta nueva» por fila; la lista de las que fallaron; los conflictos
  card_issue_done con su texto, y los que quedaron failed o uncertain; hoja A4 con 4 tarjetas A6; las contraseñas solo en @media print
  en memoria solo mientras la página está abierta («Imprimir de nuevo», «Listo», pagehide); el QR codifica bien (test contra vectores de la norma).
```

```
T2.5a · Cuentas de estudiantes (SQL)
Agente: backend          Tanda: 3        Depende de: T2.3
Turno de base: sí
Objetivo: la base emite tarjetas en una transacción, guarda la contraseña del estudiante, aprovisiona sin duplicar
  cuentas, resuelve un login de estudiante y lista las cuentas de un grupo.
Archivos: supabase/migrations/20261114130000_t2_5a_student_accounts.sql (incluye el CREATE OR REPLACE de app.session_alive
  con la parte del estudiante), supabase/tests/043_student_accounts.test.sql,
  supabase/tests/030_reasons.test.sql, supabase/tests/006_inventory.test.sql, lib/domain/errors/reasons.ts,
  lib/domain/permissions/erasure.ts, lib/domain/permissions/tables.ts, docs/PRIVACIDAD-DATOS.md,
  tests/integration/races/access-cards.test.ts, tests/integration/races/provisioning.test.ts, tests/factories/** y
  tests/integration/support/** (el login de estudiante de las pruebas pasa por el bind, así sigue leyendo datos). Los
  archivos de la fase 1 que apagan student_auth_link_guard los arregla T2.5c.
Criterios: las RPC de «Cuentas de estudiantes» con las reglas comunes; dos emisiones a la vez del mismo estudiante
  terminan con una sola tarjeta activa y la credencial de la última; issue_access_cards borra las sesiones del
  estudiante; internal_get_student_login es la única que devuelve el hash, y solo a service_role; remember concurrente
  devuelve un solo id y con la fila deleted da ok falso; fail no deshace un active; una tarjeta vieja no resuelve; un
  archivado no resuelve ni entra; audit_log con el conjunto; el trigger de auth.users y el de account_provisioning en cada caso de «Cómo entra un estudiante» y «Aprovisionar» (INSERT con contraseña que queda en NULL, INSERT con un correo externo o
  con otro correo sintético, las dos puntas con dos conexiones y el 40001 en REPEATABLE READ, UPDATE de id hacia uno suprimido, correo sintético con otro id, DELETE de la marca deleted seguido
  del INSERT, y con dos conexiones un INSERT que espera a una supresión en curso y después la ve); el bind con otra
  versión borra la sesión; el orden de locks sin ciclos (la secuencia de F2C-70 con dos conexiones); remember con una
  cuenta incompatible que aparece en el medio da ok falso; un grupo con emisiones no se borra; reconcile lista una cuenta
  active que falta en Auth; la carrera de tres conexiones de F2C-74 (recordar, insertar en Auth y suprimir) termina sin
  cuenta viva; una sesión de estudiante sin fila en student_sessions, o con otra versión, da FORBIDDEN no_session en una
  RPC student_* y en list_my_institutions; salir borra el registro (la FK) y el JWT viejo deja de leer; el registro
  sobrevive a un refresh; canIssueCards falso en un sandbox; una sesión cuyo user_id no es el sub del JWT no pasa.
```

```
T2.2 · Comando de administración
Agente: backend          Tanda: 3        Depende de: T2.3
Turno de base: no
Objetivo: el equipo de Tiza da de alta una institución con su primer admin desde la terminal.
Archivos: scripts/admin/institution.ts, scripts/admin/reconcile.ts (stub hasta T2.5b), package.json (scripts
  admin:institution y admin:reconcile), lib/server/services/admin/institution.ts (+ test; crea la institución y la
  invitación del primer admin con los repos admin que ya existen, porque un script no puede importar repos admin)
  (F2C-87), tests/integration/admin/institution.test.ts.
Criterios: crea la institución y la invitación del admin y muestra el enlace solo en la terminal; repetirlo con el
  mismo código no crea otra; pide confirmación si apunta a una URL que no es local.
```

```
T2.5c · Pruebas de la fase 1 con cuentas canónicas
Agente: backend          Tanda: 4        Depende de: T2.5a
Turno de base: no
Objetivo: toda la suite corre con student_auth_link_guard prendida, como producción.
Archivos: los archivos pgTAP de supabase/tests/ que hoy apagan student_auth_link_guard (salvo 040 y 043), los de
  tests/integration que vinculan cuentas comunes a estudiantes, tests/integration/setup/global.ts.
Criterios: ningún archivo apaga la guardia; las cuentas de estudiante de las pruebas tienen la forma canónica; las
  pruebas de la fase 1 que comprueban rechazos (una persona staff y estudiante, dos estudiantes con una cuenta) siguen
  comprobando lo mismo; toda la suite en verde.
```

```
T2.5b · Servicios de cuentas de estudiantes
Agente: backend          Tanda: 4        Depende de: T2.5a
Turno de base: no
Objetivo: crear cuentas, emitir tarjetas, entrar como estudiante y reconciliar funcionan de punta a punta.
Archivos: lib/server/repos/student-accounts.ts, lib/server/repos/admin/student-accounts.ts,
  lib/server/services/admin/provisioning.ts, lib/server/services/admin/student-login.ts,
  lib/server/auth/password-hash.ts (+ test), lib/server/repos/auth-session.ts (solo setSessionTokens), lib/server/services/student-accounts.ts,
  lib/server/services/student-auth.ts, lib/domain/accounts/password.ts,
  lib/domain/accounts/words.ts, lib/domain/accounts/username.ts, lib/domain/accounts/normalize.ts (+ tests),
  scripts/admin/reconcile.ts, tests/integration/accounts/**.
Criterios: un reintento después de cada paso del aprovisionamiento converge en una sola cuenta; la cuenta de un
  estudiante suprimido (deleted) no se recrea, y una que desapareció de Auth sin supresión se recrea con el mismo id;
  getUserById antes de createUser; dos issueAccessCards del mismo estudiante a la vez dejan andando solo la contraseña
  de la última; un login con la contraseña vieja frenado entre scrypt y el bind, con una tarjeta emitida en el medio,
  no deja ninguna sesión viva; generateLink con un id distinto del recordado no abre sesión; una sesión abierta con verifyOtp directo, sin el
  servidor, no lee datos; un pedido de tarjetas con un estudiante de otro grupo, o en un sandbox, termina sin ninguna llamada admin; la contraseña nueva anda, la vieja no, y la sesión abierta del estudiante deja de leer datos; el
  estudiante entra sin que su cuenta de Auth tenga contraseña (generateLink y verifyOtp) y ningún correo sale; PUT
  /auth/v1/user con su sesión no le pone contraseña; login con espacios o mayúsculas anda; código inexistente da el
  error con nombre; usuario inexistente y contraseña mal dan el genérico, los dos pasando por scrypt; los límites de
  T2.7 se aplican.
```

```
T2.8 · Puente de la sesión vieja
Agente: backend          Tanda: 4        Depende de: T2.1, T2.4, T2.6a
Turno de base: no
Objetivo: todo lo que usaba las cuentas de demo pasa a Supabase y la demo guiada sigue andando.
Archivos: proxy.ts (reglas de áreas), app/(teacher)/layout.tsx, app/estudiante/layout.tsx, app/estudiante/page.tsx,
  app/estudiante/[assessmentId]/page.tsx, app/api/tts/route.ts, app/demo/**, lib/auth/** (borrar accounts.ts,
  actions.ts, dal.ts, rateLimit.*), components/auth/LoginScreen.tsx y LoginForm.tsx (borrar), lib/demo/steps.ts,
  tests/e2e/** que usaban las cuentas viejas, components/demo/Demo.tsx, components/demo/Tour.tsx,
  components/student/voice/VoiceCommands.tsx y app/demo/actions.ts (F2C-88: demoViewAs pasa a las acciones de la demo y
  «salir» por voz llama a signOutAction).
Criterios: el Playwright de la demo sigue en verde, con el cambio de personaje y el recorrido guiado; la cookie de la demo solo abre la demo; /api/tts acepta una sesión
  real o la demo (sin IA en la demo, como hoy); ningún import de lib/auth/accounts.
```

## Pruebas de la fase

- pgTAP de cada RPC nueva con las reglas comunes de la fase 1, y de cada guardia como dueño.
- Integración contra Supabase local: aceptar una invitación (con y sin cuenta, con otro correo, vencida, revocada a mitad del alta); crear cuentas y reintentar después de cada paso; emitir tarjetas y entrar con la contraseña nueva; la vieja ya no entra; una sesión cerrada no lee; reconciliar.
- Carreras: dos aceptaciones de la misma invitación; dos emisiones del mismo estudiante (servicio entero); dos aprovisionamientos; una ráfaga de intentos de login.
- Playwright: el profe entra y sale; recupera la contraseña con el correo de Mailpit; un admin invita a un profe y el profe acepta desde Mailpit; el admin crea un grupo con estudiantes e imprime las tarjetas (la página de impresión, sin la impresora); el estudiante entra con los datos de la tarjeta y con el enlace del QR; la demo guiada completa en escritorio y celular.
- Fugas: ningún log de la fase tiene un correo, un token, un usuario o una contraseña (un test que corre los flujos con el log capturado y busca esos valores).

## Para después

- La tarjeta llave (entrar solo con el QR) para estudiantes con motriz, si Producto la pide: necesita un token distinto del de la tarjeta común, que se pueda revocar al instante, y un aviso al profe.
- El escaneo como primera puerta en celulares y tablets.
- El formato de bolsillo (A) como opción de impresión.
- Entrar con Google o Microsoft (login C).
- Cambiar el rol de alguien desde la lista del panel.
- Vencer las sesiones de estudiante en computadoras compartidas del colegio.
- Un límite por cuenta dentro de Auth con el hook de verificación de contraseña, si el plan de Supabase lo permite (fase 10).
