# Contrato de la fase 2 · Cuentas reales

Este documento fija cómo entran a Tiza los profes, los admins y los estudiantes con cuentas de verdad: las tablas y RPC nuevas, los servicios, las rutas, las pantallas y los tickets. Lo escribe el orquestador antes de repartir. Los tickets lo leen y no lo cambian: si algo no cierra, responden `BLOQUEADO`.

Fecha: 12/11/2026. Rama: `plataforma/fase-2`, desde `plataforma/fase-1`. Rige todo lo de `docs/contratos/fase-1.md` (esquemas, errores, nombres, locks, idempotencia, triggers de pertenencia) y `docs/contratos/fase-1-lecciones.md`. Incorpora las rondas 1 a 3 de Codex (F2C-1 a F2C-42, `docs/revisiones/fase-2-contrato-codex.md`).

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
- Salir (`signOut` con alcance `local`), cambiar la contraseña (`signOut` con alcance `others`) y emitir una tarjeta nueva (`internal_revoke_user_sessions`) borran sesiones. Desde ese momento, ninguna RPC acepta el token viejo.
- `jwt_expiry` queda en 3600: el chequeo en la base hace que no importe para los datos.

### Límite de intentos (F2C-11 a F2C-15)

Sale Upstash. Los contadores viven en `app.rate_limits` (ya existe) y se tocan solo con RPC internas.

- **Se cuenta antes de probar.** Cada intento suma en sus claves antes de llamar a Auth, en una sola sentencia atómica. Si alguna pasó su tope, no se llama a Auth. Un acierto limpia las claves del sujeto. Así una ráfaga concurrente nunca prueba más que el tope.
- Ventanas fijas de 15 minutos, con los topes de la política de hoy (`lib/auth/rateLimit.ts`), que no limita por IP sola porque un colegio entero sale por una IP:
  - estudiante: 10 por IP y sujeto, 30 por sujeto desde cualquier IP. El sujeto es el par (código del colegio, usuario), normalizado;
  - profe: lo mismo, con el correo normalizado como sujeto;
  - recuperar contraseña: 3 por correo por hora y 20 por IP por hora;
  - abrir una tarjeta o una invitación: 30 por IP en 15 minutos, contando todos los intentos.
- Las claves son `<balde>:<hex de HMAC-SHA256(RATE_LIMIT_SECRET, valor)>`: nunca guardan una IP, un correo ni un usuario. Baldes: `student_pair`, `student_subject`, `staff_pair`, `staff_subject`, `reset_email`, `reset_ip`, `token_ip`.
- La IP sale de `x-nf-client-connection-ip` (Netlify). Si no está (local, pruebas), del primer valor de `x-forwarded-for`. Si tampoco, `unknown`.
- **Respuesta pareja (F2C-15, F2C-33).** Un login de estudiante con un usuario que no existe hace el mismo trabajo que uno con la contraseña mal: prueba la contraseña contra una cuenta señuelo (`decoy@estudiantes.usetiza.app`, con una contraseña aleatoria que nadie conoce; la crea `npm run admin:institution` si falta). Así los dos caminos pasan por una verificación de contraseña de Auth. Además, todo login que no entra responde a los 800 ms como mínimo desde que empezó, y una llamada a Auth tiene un plazo de 5 s: si vence, el error es el mismo genérico. El límite se aplica igual a sujetos que no existen. La única diferencia permitida es un código de colegio que no existe, que se dice con nombre porque el código no es secreto. En el login del profe, un correo que no existe lo resuelve Auth: el riesgo de saber si un adulto del colegio tiene cuenta se acepta.
- Al bloquearse, el servicio levanta `AppError("RATE_LIMITED", …, { retryAt })`, con el fin de la ventana más lejana. `retryAt` llega a la pantalla por `Failure.retryAt` (contrato).
- **Las llamadas directas a Auth** (`/auth/v1/token` con la clave pública) no pasan por estos contadores. Las cubre esto:
  - el correo de un estudiante es `<parte aleatoria>@estudiantes.usetiza.app`, que nunca llega al navegador de nadie más que el suyo, así que no se puede apuntar a una cuenta ajena. **Cada tarjeta nueva cambia ese correo** (F2C-27): quien copió una sesión y su correo pierde las dos cosas al emitirse otra tarjeta;
  - la contraseña de un estudiante tiene tres palabras y un número (unos 33 bits): con el límite por IP de Auth, adivinarla desde muchas IP lleva años;
  - las contraseñas de staff tienen 10 caracteres como mínimo (`minimum_password_length = 10`) y, en producción, la protección de contraseñas filtradas de Supabase;
  - y el límite por IP de Auth. T2.7 verifica si Auth acepta la IP del cliente desde nuestro servidor (`Sb-Forwarded-For` con la clave secreta). Si la acepta, nuestras llamadas la mandan y los límites de Auth quedan en sus valores por defecto. Si no, se suben los límites de `/token` lo justo para un colegio entrando a la vez (T2.7 lo mide y lo anota), y la defensa directa queda en los dos puntos anteriores.

### Contraseña inicial de un estudiante

- Tres palabras cortas en español de una lista fija (`lib/domain/accounts/words.ts`, al menos 512 palabras de 3 a 5 letras, sin tildes, sin ñ y sin palabras que puedan ofender) y un número de dos cifras sin 0 ni 1: `sol-nube-tigre-47`. Unos 33 bits. Las maquetas muestran dos palabras: la tarjeta tiene lugar para tres.
- Si el plan de Supabase permite el hook de verificación de contraseña, la fase 10 suma ahí un límite por cuenta dentro de Auth. Queda en «Para después».
- Se genera con `crypto.randomInt`, nunca con `Math.random`.
- El login normaliza lo que escribe el estudiante: minúsculas, sin espacios al borde, y cualquier tira de espacios o guiones pasa a un guion. Como la contraseña nace en ese formato, normalizar no pierde nada.
- No se guarda en ningún lado: va al Auth de Supabase y a la hoja que se imprime. Si se pierde, una tarjeta nueva crea otra.

### Usuario de un estudiante

- El nombre más la inicial del apellido, sin tildes, en minúscula y solo con `a-z0-9`: «Lucía Fernández» da `luciaf`. Si está tomado, `luciaf2`, `luciaf3`…
- La regla es pura (`lib/domain/accounts/username.ts`) y recibe los usuarios ya tomados, que da `list_taken_usernames`.
- El admin ve y puede cambiar cada usuario antes de crear (paso «revisar» del panel B). Si al crear alguien tomó el mismo, `create_student` da `CONFLICT username_taken` y esa fila vuelve a revisar.

### Correo sintético

`<parte aleatoria>@estudiantes.usetiza.app`, con 32 caracteres hexadecimales de `crypto.randomBytes(16)`. El spec decía `<student_id>`; se usa una parte aleatoria para que el correo no se derive de un id que ven los profes, y se cambia en cada tarjeta nueva (F2C-27). `lib/domain/accounts/email.ts` lo arma y lo reconoce. El correo vigente vive solo en `auth.users`: `internal_resolve_student_login` lo lee de ahí. El subdominio no recibe correo. Recuperar contraseña rechaza un correo de ese dominio sin llamar a Auth, y una invitación a ese dominio da `INVALID invalid_email`.

### El plazo de una operación con Auth (F2C-24, F2C-25, F2C-36 a F2C-38)

Dos operaciones escriben en Auth, fuera de la transacción de Postgres, sobre una cuenta que ya existe o que se crea con un id elegido antes: aprovisionar la cuenta de un estudiante, y cambiarle la contraseña y el correo al emitir una tarjeta. Para que una escritura atrasada no pise a otra, cada una toma antes un **plazo** en la base, bajo lock, con un **titular**, y todas cumplen estas reglas:

- **Titular.** Tomar el plazo devuelve un `holder` (uuid) que queda guardado junto al plazo. Confirmar, recordar la cuenta y terminar exigen ese `holder`. Sin él, o con otro, la RPC da `ok: false` y no cambia nada. Así una confirmación de A no se confunde con una toma de B.
- **Nadie llama a Auth sin confirmar antes un plazo vigente con al menos 4 minutos por delante**, y cada llamada a Auth vence a los 5 segundos. Los métodos admin de `auth-js` no reciben un `AbortSignal`: el plazo se pone con un `fetch` propio en el cliente admin de Auth (`global.fetch` con `AbortSignal.timeout(5000)`).
- **El plazo es de 5 minutos y es más largo que cualquier proceso que pueda tenerlo.** Las Server Actions corren en funciones de Netlify, que la plataforma corta a los 60 segundos. Un proceso que confirmó el plazo no puede seguir 4 minutos más: lo mata la plataforma.
- **Resultado confirmado contra resultado incierto (F2C-36).**
  - Un **rechazo confirmado** de Auth (una respuesta 4xx que dice qué falló) es un fallo: la operación lo anota y sigue.
  - Un **resultado incierto** (vencimiento de los 5 s, error de red, 5xx) no es un fallo. La operación extiende el plazo a **15 minutos desde ahora** y no lo suelta. La tarjeta de ese estudiante no se imprime. Ninguna emisión, aprovisionamiento ni supresión de esa cuenta puede avanzar hasta que venza.
  - Los 15 minutos cubren con creces el tiempo máximo que Auth procesa un pedido: GoTrue corta cada pedido con su propio plazo de servidor. T2.5b busca en el código de `supabase/auth` el valor de ese corte (`API_MAX_REQUEST_DURATION` o el que corresponda) y lo anota en `docs/contratos/fase-2-notas.md`. Si es mayor a 5 minutos, el ticket responde `BLOQUEADO`.
- **El plazo solo crece (F2C-37).** `lease_until` nunca baja ni vuelve a NULL una vez puesto, y `holder` cambia solo cuando el plazo anterior venció. Lo garantiza una guardia (P0004), también contra el dueño. Terminar una operación no «suelta» el plazo: lo deja como está. La operación siguiente espera a que venza, o la misma operación lo reconoce por su estado (`active`, `done`).
- **Nadie empieza otra operación sobre la misma cuenta hasta que el plazo anterior venció o su operación terminó con un resultado confirmado.** Cuando vence, ya no puede llegar a Auth ninguna escritura del proceso anterior.
- **Los comandos de terminal** (`admin:reconcile`) no tienen el corte de 60 s. Confirman el plazo antes de cada llamada, nunca hacen dos llamadas con una sola confirmación, y en producción corren en el entorno de funciones (la fase 3 los pasa a trabajos). Queda como riesgo aceptado para la corrida manual en local o staging.
- **El alta de un profe invitado no usa plazo**, y queda exceptuada con esta razón: crea una cuenta nueva con un correo que Auth no deja repetir (gana una sola) y nunca cambia una cuenta que ya existe. No hay dos escrituras que se puedan pisar.

### Aprovisionar una cuenta de estudiante (F2C-6 a F2C-8, F2C-25, F2C-36 a F2C-38)

La cuenta de Auth de un estudiante tiene un id que se decide y se recuerda antes de crearla, así un reintento nunca crea una segunda:

1. `internal_claim_provisioning(p_provisioning_id, p_holder)` bloquea al estudiante y después su fila de aprovisionamiento (el orden de la fase 1).
   - Con `p_holder` NULL, intenta tomar el plazo. Si la fila está `deleted` o el estudiante no existe, da `ok: false`. Si otro titular tiene un plazo vigente, da `ok: false` con `retryAt`. Si no, toma el plazo con un `holder` nuevo y devuelve la fila: estado, `authUserId`, `holder` y `leaseUntil`.
   - Con el `p_holder` propio, confirma: extiende el plazo a 5 minutos y da `ok: true`, solo si el titular sigue siendo ese, la fila no está `deleted` y quedan al menos 4 minutos.
2. Si no tiene `authUserId`, el servicio elige uno (`crypto.randomUUID()`) y lo guarda con `internal_remember_student_account(p_provisioning_id, p_holder, p_auth_user_id)`. Si ya había uno, la RPC devuelve ese: se usa el guardado, nunca el propio.
3. Confirma el plazo y llama a `auth.admin.createUser({ id: authUserId, email: sintético, email_confirm: true, app_metadata: { provisioning_id }, password? })`.
4. Si el id ya existe en Auth, confirma de nuevo y llama a `auth.admin.getUserById(authUserId)`: si su `app_metadata.provisioning_id` coincide, sigue; si no, `internal_fail_student_account(p_provisioning_id, p_holder, 'account_mismatch')` y para.
5. Si Auth da un resultado incierto, `internal_extend_provisioning(p_provisioning_id, p_holder)` lleva el plazo a 15 minutos y el servicio para sin marcar nada: lo retoma `reconcile` cuando el plazo venza.
6. `internal_upsert_app_user` e `internal_link_student_user` (existen).

- **Suprimir gana.** La supresión de la fase 9 marca la fila `deleted` bajo los mismos locks. Desde ese momento ningún claim da `ok`. La cuenta de Auth se borra recién cuando venció `lease_until`, que solo crece. Así ninguna creación atrasada o incierta puede llegar después del borrado. La fase 9 hereda esta regla. Su prueba ya existe acá: con un plazo vigente, la supresión deja la fila `deleted` y el borrado en Auth espera.
- **Cuenta que desapareció de Auth sin que nadie suprimiera al estudiante** (alguien la borró a mano desde el panel de Supabase): con la fila `pending`, `failed` o `active` y el id recordado, se recrea con el mismo id y el estudiante conserva su identidad. **Cuenta de un estudiante suprimido** (`deleted`): nunca se recrea. La fila distingue los dos casos.
- `internal_fail_student_account` exige el titular y nunca cambia una fila `active` ni `deleted`: solo `pending` → `failed` o `failed` → `failed`. Un proceso atrasado no deshace el éxito de otro.
- Dos procesos que aprovisionan a la vez no corren juntos: el segundo encuentra el plazo tomado.

### Emitir tarjetas (F2C-4, F2C-5, F2C-24, F2C-30, F2C-31, F2C-36)

Emitir una tarjeta cambia la contraseña y el correo en Auth, fuera de la transacción. Cada emisión es una operación con plazo (ver «El plazo de una operación con Auth»), y un estudiante solo puede estar en una emisión abierta a la vez:

1. **Empezar** (`begin_access_cards`, con la sesión). Autoriza. Bloquea a los estudiantes en orden de id. Si alguno tiene una tarjeta `pending` de otra emisión cuyo plazo sigue vigente (esté `running` o `done`), `CONFLICT card_issue_running`. Si el plazo venció, esa tarjeta pasa a `revoked`, y si su emisión seguía `running`, pasa a `abandoned`. El titular del plazo de una emisión es la emisión misma: solo el pedido que la empezó la conoce. Crea la emisión (`running`, plazo de 5 minutos) y una tarjeta `pending` por estudiante. Escribe `audit_log` (`access_card.issued`) con el conjunto.
2. **Por estudiante** (servicio). `internal_claim_card_password(p_issue_id, p_student_id)` confirma, bajo lock, que la tarjeta sigue `pending` y la emisión `running` con al menos 4 minutos de plazo, lo extiende a 5 minutos desde ahora y devuelve la cuenta. Recién entonces el servicio aprovisiona si hace falta, pone en Auth la contraseña nueva y un correo nuevo, y cierra las sesiones del estudiante (`internal_revoke_user_sessions`). Si la confirmación da `ok: false`, no toca Auth. Si Auth da un resultado incierto, `internal_extend_card_issue(p_issue_id)` lleva el plazo de la emisión a 15 minutos y ese estudiante queda como incierto.
3. **Terminar** (`finish_access_cards(p_issue_id, p_done, p_uncertain)`, con la sesión del mismo actor). Para cada estudiante de `p_done`: la tarjeta vigente pasa a `revoked` y la `pending` a `active`. Las de `p_uncertain` quedan `pending`, bloqueando nuevas emisiones de ese estudiante hasta que venza el plazo. Las demás `pending` de esa emisión pasan a `revoked`. La emisión queda `done`. Devuelve los estudiantes activados. El servicio solo devuelve tarjetas de esos.

- Con la regla del plazo, la garantía es completa: una emisión nueva del mismo estudiante solo empieza cuando la anterior terminó o venció, y una vencida ya no puede escribir en Auth. Dos emisiones a la vez imprimen una sola contraseña, y es la que anda.
- A un estudiante incierto la pantalla le dice «No pudimos confirmar la tarjeta de Lucía. Probá de nuevo en unos minutos». Pasado el plazo, la emisión siguiente pone una contraseña nueva, y ya no puede llegar ninguna escritura vieja.
- Si el proceso muere a mitad de camino, las tarjetas `pending` vencen solas y la próxima emisión las limpia. Un estudiante cuya contraseña sí cambió sigue con su tarjeta vieja activa, que ya no entra: el profe ve «Tarjeta nueva» como siempre.
- **Idempotencia.** `op_key` con identidad, como en la fase 1. La identidad es `op_identity`: el hex de `sha256` del grupo y el conjunto ordenado de estudiantes. Es un resumen, no la lista: la emisión no guarda ids de estudiantes y la supresión no tiene nada que sacar de ella (F2C-30). El orden de las respuestas a un `op_key` repetido:
  1. con otra identidad, `CONFLICT op_key_reused`;
  2. con la emisión `running`, `CONFLICT card_issue_running`;
  3. con la emisión `done`, `CONFLICT card_issue_done`;
  4. con la emisión `abandoned`, `CONFLICT card_issue_abandoned`.
  
  Las contraseñas no se guardan, así que una respuesta perdida no se puede repetir. Para `done`, la pantalla dice «Las tarjetas ya se crearon. Si no llegaste a imprimirlas, creá nuevas»; para `abandoned`, «La impresión anterior se cortó. Creá las tarjetas de nuevo». En los dos casos ofrece emitir con un `op_key` nuevo.

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
-- Una emisión de tarjetas: la operación que cambia contraseñas en Auth, con plazo. No guarda ids de estudiantes:
-- op_identity es el sha256 (hex) del grupo y del conjunto ordenado de estudiantes, solo para comparar repeticiones.
create table app.access_card_issues (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  group_id uuid not null,
  op_key uuid not null,
  op_identity text not null check (op_identity ~ '^[0-9a-f]{64}$'),
  issued_by uuid references app.app_users (id) on delete set null,
  status text not null default 'running' check (status in ('running', 'done', 'abandoned')),
  lease_until timestamptz not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (institution_id, id),
  unique (institution_id, op_key),
  foreign key (institution_id, group_id) references app.groups (institution_id, id) on delete cascade,
  check ((status = 'running') = (finished_at is null))
);

-- Una tarjeta de acceso: el QR que completa el colegio y el usuario.
create table app.access_cards (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references app.institutions (id) on delete cascade,
  student_id uuid not null,
  issue_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  revoked_at timestamptz,
  unique (institution_id, id),
  foreign key (institution_id, student_id) references app.students (institution_id, id) on delete cascade,
  foreign key (institution_id, issue_id) references app.access_card_issues (institution_id, id) on delete cascade,
  check ((status = 'revoked') = (revoked_at is not null)),
  check (status = 'pending' or activated_at is not null or status = 'revoked')
);
create unique index access_cards_active_key on app.access_cards (student_id) where status = 'active';
create unique index access_cards_pending_key on app.access_cards (student_id) where status = 'pending';

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

-- El plazo de quien está creando la cuenta de Auth de un estudiante, y su titular.
alter table app.account_provisioning add column lease_until timestamptz;
alter table app.account_provisioning add column lease_holder uuid;
```

Guardias (P0004, como en la fase 1; entran DML y TRUNCATE de cualquier rol, incluido el dueño y concurrente):

- **Pertenencia.** En tarjetas, emisiones y el registro de hashes no cambian `institution_id`, `student_id`, `issue_id`, `group_id`, `invitation_id`, `token_hash`, `op_key` ni `op_identity`, e `issued_by` solo pasa a NULL (el `on delete set null`). En invitaciones, `op_key` y `op_identity` no cambian una vez puestos.
- **Estados que solo avanzan.** Tarjeta: `pending` → `active` → `revoked`, o `pending` → `revoked`. Emisión: `running` → `done` o `abandoned`. Invitación: `accepted` y `revoked` son finales; `pending` y `expired` pueden pasar a `pending` solo con un `token_hash` nuevo.
- **Rotación de una invitación (F2C-29, F2C-39).** El `token_hash` de una invitación cambia solo en ese paso a `pending`. Todo `token_hash` que nace o llega a una invitación se inserta en `app.invitation_tokens` en la misma sentencia (trigger `AFTER INSERT OR UPDATE OF token_hash`), con un `insert` simple: si el hash ya estuvo alguna vez, el índice único lo rechaza (y espera a una transacción concurrente que lo esté insertando, en cualquier nivel de aislamiento). El trigger convierte ese `unique_violation` en P0004. No hay estado «vigente» ni «gastado»: el vigente es el que tiene la invitación, y todos los demás son historia.
- **Nacimiento.** Una tarjeta nace `pending`. Una emisión nace `running`. Una invitación nace `pending`, sin `accepted_by` (fase 1).
- **Memoria (F2C-19, F2C-28).** Mientras exista su institución, no se borran las invitaciones ni las filas de `invitation_tokens`, y esas filas no cambian. Las tarjetas y las emisiones no se borran mientras exista su estudiante o su grupo: solo se van con ellos, por la cascada. Así un hash revocado no vuelve a nacer vigente por `DELETE` e `INSERT`. La retención de la fase 9 borra el correo de una invitación vieja con una redacción, sin borrar la fila. Para eso la fase 9 suma, en una migración nueva, una excepción acotada a la guardia del correo de `invitations_frozen` (T1.F15): solo en modo de supresión o retención, solo para invitaciones `accepted`, `revoked` o `expired` con más de 90 días, y solo hacia un valor redactado; con su prueba (F2C-42).
- **Los plazos solo crecen (F2C-37).** En `account_provisioning` y `access_card_issues`, `lease_until` nunca baja ni vuelve a NULL una vez puesto. `lease_holder` cambia solo si el `lease_until` anterior ya venció. Las dos cosas son guardias P0004, también contra el dueño.

**Inventario.** `access_cards` tiene datos de estudiantes (el id y el hash del token); al borrar al estudiante se van por la cascada. `access_card_issues` no tiene ningún dato de un estudiante. Se suman a `docs/PRIVACIDAD-DATOS.md`, `lib/domain/permissions/tables.ts` y `006_inventory.test.sql`. `invitations.email` es un dato personal de un adulto; su retención (redactar 90 días después de aceptada, revocada o vencida) la programa la fase 9. `invitation_tokens` no tiene datos personales.

## RPC nuevas

Siguen las reglas de la fase 1: `perform app.rpc_begin();` primero, errores con `app.raise_error`, salida `jsonb` de claves cerradas en camelCase, `internal_*` solo para `service_role`, las demás para `authenticated`. La matriz de permisos (`lib/domain/permissions/matrix.ts`) suma cada una.

### Sesión (T2.7)

| RPC o función | Quién | Qué |
|---|---|---|
| `app.session_alive()` → `boolean` | ver «Sesión vigente en la base» | `true` si no hay `session_id` en los claims o si esa sesión existe en `auth.sessions` |
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
| `list_group_accounts(p_group_id uuid)` → `{groupName, institutionCode, items: [{studentId, displayName, username, accountStatus, hasSignedIn, lastCardAt}]}` | staff del grupo o admin | `accountStatus`: `pending`, `active` o `failed`. Inscripciones activas, sin archivados. No es sensible |
| `begin_access_cards(p_group_id uuid, p_cards jsonb, p_op_key uuid)` → `{issueId, leaseUntil, institutionCode, institutionName, items: [{studentId, displayName, username}]}` | staff del grupo o admin, no en un sandbox | `p_cards` es `[{studentId, tokenHash}]`, de 1 a 60, el hash en hex. Ver «Emitir tarjetas». No inscripto o archivado: `INVALID not_enrolled`. Forma mala: `INVALID invalid_cards` |
| `finish_access_cards(p_issue_id uuid, p_done uuid[], p_uncertain uuid[])` → `{activated: uuid[]}` | el mismo actor que empezó | Ver «Emitir tarjetas». Otra persona: `NOT_FOUND`. Emisión que no está `running`: `CONFLICT card_issue_done` |
| `internal_claim_card_password(p_issue_id uuid, p_student_id uuid)` → `{ok, provisioningId, status, authUserId}` | service_role | Ver «Emitir tarjetas» |
| `internal_extend_card_issue(p_issue_id uuid)` → `{leaseUntil}` | service_role | Lleva el plazo de una emisión a 15 minutos desde ahora, nunca más corto |
| `internal_claim_provisioning(p_provisioning_id uuid, p_holder uuid)` → `{ok, retryAt, status, authUserId, holder, leaseUntil}` | service_role | Ver «Aprovisionar» |
| `internal_extend_provisioning(p_provisioning_id uuid, p_holder uuid)` → `{ok, leaseUntil}` | service_role | Lleva el plazo a 15 minutos, solo para su titular |
| `internal_get_student_accounts(p_student_ids uuid[])` → `{items: [{studentId, provisioningId, status, authUserId}]}` | service_role | Hasta 60 |
| `internal_remember_student_account(p_provisioning_id uuid, p_holder uuid, p_auth_user_id uuid)` → `{authUserId}` | service_role | Exige el plazo vigente de ese titular. Guarda el id si no había; si había, devuelve el guardado. Bajo el lock del estudiante y después el de la fila, en ese orden |
| `internal_fail_student_account(p_provisioning_id uuid, p_holder uuid, p_error_code text)` → `{status, attempts}` | service_role | Exige el titular. Solo `pending` → `failed` o `failed` → `failed`; con `active` o `deleted` no cambia nada. No toca el plazo |
| `internal_list_unfinished_accounts(p_limit integer)` → `{items: [{studentId, provisioningId, status, authUserId}]}` | service_role | `pending` y `failed` con menos de 5 intentos, sin archivar y sin plazo vigente. Nunca `deleted` |
| `internal_find_institution(p_code text)` → `{code, name}` o `NOT_FOUND` | service_role | Solo escuelas |
| `internal_resolve_student_login(p_code text, p_username text)` → `{institutionFound, authEmail}` | service_role | `authEmail` (el correo vigente, de `auth.users`) solo si el estudiante existe, no está archivado y su cuenta está `active`; si no, `null` |
| `internal_resolve_access_card(p_token_hash bytea)` → `{institutionCode, institutionName, username}` o `NOT_FOUND` | service_role | Tarjeta `active`, estudiante sin archivar, cuenta `active`, escuela. Nunca el nombre del estudiante |

Razones nuevas: `invalid_cards`, `card_issue_running`, `card_issue_done`, `card_issue_abandoned`.

## Servicios

Las capas de `eslint/rules/layers.mjs` mandan (F2C-35):

- `db/client.ts` solo entra en `lib/server/repos/*.ts`. Por eso toda llamada con la sesión del usuario, también las de Auth (`signInWithPassword`, `signOut`, `verifyOtp`, `updateUser`, `getClaims`), vive en un repo de sesión: `lib/server/repos/auth-session.ts`.
- `repos/admin/**` solo entra en `services/admin/**`, `jobs/**` y `tests/**`. Por eso todo lo que usa el cliente admin vive en `lib/server/services/admin/`. Los servicios públicos (`services/*.ts`) llaman a esos servicios, nunca a los repos admin.
- `app/**` llama a servicios y nunca a repos.
- **De dónde sale el cliente (F2C-41).** `lib/server/repos/db.ts` exporta `sessionDb(): Promise<RpcDb>` (crea el cliente de sesión del pedido) y `lib/server/repos/admin/db.ts` exporta `adminDb(): RpcDb` (el cliente admin, con el `fetch` de 5 s para Auth). Un servicio pide el cliente ahí y se lo pasa a los repos existentes, que ya reciben un `RpcDb`; nunca lo usa directamente. `sessionDb` lo escribe T2.1; `adminDb`, T2.7.

Los cuerpos del contrato levantan `AppError("UNAVAILABLE", "Todavía no está disponible.")`.

| Archivo | Funciones | Usa | Ticket |
|---|---|---|---|
| `lib/server/auth/actor.ts` | `getActor()`, `requireStaff()`, `requireAdmin(institutionId)`, `requireStudent()` | `repos/auth-session.ts` (claims), `repos/institutions.ts` (`list_my_institutions`) | T2.1 |
| `lib/server/auth/request.ts` | `clientIp(headers)` | | T2.7 |
| `lib/server/repos/auth-session.ts` | `getClaims`, `signInWithPassword`, `signOut(scope)`, `verifyRecoveryOtp`, `updatePassword`, `requestPasswordReset` | `db/client.ts` | T2.1 (`getClaims`) y T2.3 (lo demás) |
| `services/admin/rate-limit.ts` | `hitAttempt(keys, limits, windowSeconds)`, `clearAttempts(keys)` | `repos/admin/rate-limits.ts` | T2.7 |
| `services/admin/sessions.ts` | `revokeUserSessions(userId)` | `repos/admin/sessions.ts` | T2.7 |
| `services/rate-limit.ts` | `guardAttempt(kind, ip, subject)` (cuenta y levanta `RATE_LIMITED`), `clearSubject(kind, subject)` | `services/admin/rate-limit.ts` | T2.7 |
| `lib/server/repos/admin/auth-users.ts` | `createAuthUser`, `getAuthUser`, `updateAuthUser` (contraseña, correo), `deleteAuthUser`, todos con `AbortSignal` de 5 s | `db/admin.ts` | T2.3 (T2.5b lo usa, no lo cambia) |
| `services/admin/invitation-signup.ts` | `readInvitationByToken(tokenHash)`, `createInvitedAccount(…)`, `finishInvitationSignup(…)`, `createInvitationAsOperator(…)` | `repos/admin/invitations.ts`, `repos/admin/auth-users.ts` | T2.3 |
| `services/staff-auth.ts` | `signInStaff({email, password, ip})`, `requestPasswordReset({email, ip, origin})`, `verifyRecovery({tokenHash})`, `setNewPassword({password})`, `signOut()` | `repos/auth-session.ts`, `services/rate-limit.ts` | T2.3 |
| `services/invitations.ts` | `inviteStaff({institutionId, emails, role, opKey, origin})` (resultado por correo), `resendInvitation`, `revokeInvitation`, `readInvitation({token, ip})` (con la relación de la sesión: `none`, `same` u `other`), `acceptInvitation({token})`, `acceptInvitationAsNewUser({token, displayName, password, ip})` | `repos/invitations.ts`, `services/admin/invitation-signup.ts`, `lib/server/mail/` | T2.3 |
| `services/institution.ts` | `getInstitutionSummary(id)`, `listStaff(id)`, `listInvitations(id)`, `listGroups(id)`, `listSubjects()`, `createGroup({institutionId, name, subjectId, schoolYear, opKey})` | `repos/institution.ts`, `repos/groups.ts` | T2.3 |
| `services/admin/provisioning.ts` | `provisionStudent(provisioningId, password?)`, `reconcile(limit)` | `repos/admin/student-accounts.ts`, `repos/admin/students.ts`, `repos/admin/auth-users.ts` | T2.5b |
| `services/admin/card-passwords.ts` | `applyCardPassword(issueId, studentId, password)` (el paso por estudiante de «Emitir tarjetas») | `repos/admin/student-accounts.ts`, `repos/admin/auth-users.ts`, `services/admin/sessions.ts` | T2.5b |
| `services/admin/student-login.ts` | `resolveStudentLogin(code, username)`, `findInstitution(code)`, `resolveAccessCard(tokenHash)` | `repos/admin/student-accounts.ts` | T2.5b |
| `services/student-accounts.ts` | `previewUsernames({institutionId, names})`, `createStudentAccounts({groupId, rows, opKey})`, `listGroupAccounts(groupId)`, `issueAccessCards({groupId, studentIds, opKey, origin})` | `repos/student-accounts.ts`, `repos/students.ts`, `services/admin/provisioning.ts`, `services/admin/card-passwords.ts` | T2.5b |
| `services/student-auth.ts` | `findInstitution({code, ip})`, `signInStudent({code, username, password, ip})`, `readAccessCard({token, ip})` | `services/admin/student-login.ts`, `repos/auth-session.ts`, `services/rate-limit.ts` | T2.5b |
| `lib/server/mail/` | `MailSender`, `getMailSender()`, `invitationMail(…)` | | T2.3 |

Tipos en `lib/domain/accounts/`: `Actor`, `AccessCard`, `InvitationView`, `StaffRow`, `AccountRow`, `UsernameDraft`, `InstitutionSummary`, y las reglas puras `username.ts`, `password.ts`, `email.ts`, `words.ts`, `normalize.ts`.

**Crear cuentas** (`createStudentAccounts`): por cada fila, `create_student` con un `op_key` derivado del `opKey` del pedido y el índice de la fila (UUID v5), y enseguida el aprovisionamiento sin contraseña. Un error en una fila no frena las demás. El resultado dice, por fila, si se creó y si su cuenta quedó lista.

**Emitir tarjetas** (`issueAccessCards`): genera un token por estudiante, `begin_access_cards`, el paso por estudiante de «Emitir tarjetas» y `finish_access_cards`. Devuelve `{cards: [{studentId, displayName, username, institutionCode, institutionName, password, qrUrl}], failed: [studentId]}`. Esa respuesta no se cachea, no se loguea y no pasa por ningún error.

**Reconciliar** (`reconcile`): `internal_list_unfinished_accounts` y el mismo aprovisionamiento. Hasta la fase 3 corre a mano con `npm run admin:reconcile`.

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
- **Imprimir.** Al confirmar, la acción devuelve las tarjetas y la página las pone en un contenedor que solo se ve al imprimir (`@media print`) y llama a `window.print()`. En pantalla, las contraseñas nunca aparecen. Al terminar la impresión (`afterprint`) se borran de la memoria del componente.
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
| 4 | | T2.5b servicios de cuentas, T2.8 puente de la sesión vieja |

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
  lib/server/repos/admin/sessions.ts, lib/server/repos/admin/db.ts (adminDb con el fetch de 5 s), lib/server/services/admin/rate-limit.ts, lib/server/services/admin/sessions.ts,
  lib/server/services/rate-limit.ts (+ test), lib/server/auth/request.ts (+ test), supabase/tests/005_student_role.test.sql
  (sumar app.session_alive a las excepciones revisadas),
  supabase/config.toml ([auth.rate_limit], minimum_password_length), package.json y package-lock.json (solo sacar
  @upstash/*), .env.example (RATE_LIMIT_SECRET), tests/integration/races/rate-limit.test.ts,
  tests/integration/auth/session-revoked.test.ts, docs/contratos/fase-2-notas.md (lo que midió de Sb-Forwarded-For).
Criterios: rpc_begin rechaza un session_id borrado y acepta uno vivo y la ausencia de claim, también en una RPC
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
  lib/server/repos/admin/invitations.ts, lib/server/repos/admin/auth-users.ts, lib/server/repos/auth-session.ts (salvo
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
  card_issue_running y card_issue_done con su texto; hoja A4 con 4 tarjetas A6; las contraseñas solo en @media print
  y fuera de la memoria después de afterprint; el QR codifica bien (test contra vectores de la norma).
```

```
T2.5a · Cuentas de estudiantes (SQL)
Agente: backend          Tanda: 3        Depende de: T2.3
Turno de base: sí
Objetivo: la base sabe emitir tarjetas con plazo, aprovisionar sin duplicar cuentas, resolver un login de estudiante
  y listar las cuentas de un grupo.
Archivos: supabase/migrations/20261114130000_t2_5a_student_accounts.sql, supabase/tests/043_student_accounts.test.sql,
  supabase/tests/030_reasons.test.sql, supabase/tests/006_inventory.test.sql, lib/domain/errors/reasons.ts,
  lib/domain/permissions/erasure.ts, lib/domain/permissions/tables.ts, docs/PRIVACIDAD-DATOS.md,
  tests/integration/races/access-cards.test.ts, tests/integration/races/provisioning.test.ts.
Criterios: las RPC de «Cuentas de estudiantes» con las reglas comunes; dos emisiones a la vez del mismo estudiante:
  una da card_issue_running; una emisión vencida se limpia; claim fuera de plazo da ok falso; finish de otro actor da
  NOT_FOUND; claim_provisioning con plazo ajeno da ok falso y con la fila deleted también; remember concurrente devuelve
  un solo id; fail no deshace un active; una tarjeta vieja no resuelve; un
  archivado no resuelve ni entra; audit_log con el conjunto.
```

```
T2.2 · Comando de administración
Agente: backend          Tanda: 3        Depende de: T2.3
Turno de base: no
Objetivo: el equipo de Tiza da de alta una institución con su primer admin desde la terminal.
Archivos: scripts/admin/institution.ts, scripts/admin/reconcile.ts (stub hasta T2.5b), package.json (scripts
  admin:institution y admin:reconcile), tests/integration/admin/institution.test.ts.
Criterios: crea la institución y la invitación del admin y muestra el enlace solo en la terminal; crea la cuenta
  señuelo del login de estudiantes si falta; repetirlo con el
  mismo código no crea otra; pide confirmación si apunta a una URL que no es local.
```

```
T2.5b · Servicios de cuentas de estudiantes
Agente: backend          Tanda: 4        Depende de: T2.5a
Turno de base: no
Objetivo: crear cuentas, emitir tarjetas, entrar como estudiante y reconciliar funcionan de punta a punta.
Archivos: lib/server/repos/student-accounts.ts, lib/server/repos/admin/student-accounts.ts,
  lib/server/services/admin/provisioning.ts, lib/server/services/admin/card-passwords.ts,
  lib/server/services/admin/student-login.ts, lib/server/services/student-accounts.ts,
  lib/server/services/student-auth.ts, lib/domain/accounts/password.ts,
  lib/domain/accounts/words.ts, lib/domain/accounts/username.ts, lib/domain/accounts/normalize.ts (+ tests),
  scripts/admin/reconcile.ts, tests/integration/accounts/**.
Criterios: un reintento después de cada paso del aprovisionamiento converge en una sola cuenta; la cuenta de un
  estudiante suprimido (deleted) no se recrea, y una que desapareció de Auth sin supresión se recrea con el mismo id;
  ninguna llamada a Auth sin plazo vigente (prueba con el plazo vencido a propósito); cada tarjeta nueva cambia el
  correo; dos issueAccessCards del mismo estudiante a la vez imprimen una sola contraseña que anda; la contraseña
  nueva anda, la vieja no, y la sesión abierta del estudiante deja de leer datos; login con espacios o mayúsculas
  anda; código inexistente da el error con nombre; usuario o contraseña mal dan el genérico en el mismo tiempo; los
  límites de T2.7 se aplican.
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
