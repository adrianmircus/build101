# Revisión de Codex del contrato de la fase 2

## Ronda 1

1. **F2C-1 · Alta — Los logs reciben credenciales de invitación utilizables.**  
   **Dónde:** [fase-2.md:51](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:51).  
   El contrato reconoce que Netlify registra el token en la ruta. Si la invitación es para una cuenta nueva, quien obtenga ese log puede usar el enlace para elegir la contraseña y apropiarse del alta. Vencer en siete días y permitir un solo uso no evita que el atacante llegue primero. **Cambiaría:** transportar el secreto fuera de la URL enviada al servidor —por ejemplo, fragmento y canje por POST— y definir su exclusión de logs de infraestructura, errores y observabilidad.

2. **F2C-2 · Alta — El alta por invitación no tiene una operación reservada y recuperable.**  
   **Dónde:** [fase-2.md:151](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:151), líneas 153, 193 y criterio de T2.3.  
   `internal_get_invitation` permite leer el token, pero ninguna RPC reserva el alta antes de `auth.admin.createUser`. Entre comprobarlo y crear la cuenta, otro pedido puede revocar o reenviar la invitación. Auth puede quedar creado aunque aceptar falle; tampoco se define cómo recuperar el caso «Auth creado, app_user o membresía pendientes». **Cambiaría:** agregar una intención durable de alta, con reserva exclusiva, identidad de operación, cuenta recordada y estados de recuperación. Probaría revocación, reenvío y fallos intermedios concurrentes.

3. **F2C-3 · Media — Comparar únicamente el correo del JWT permite aceptar con una identidad desactualizada.**  
   **Dónde:** [fase-2.md:153](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:153).  
   Un JWT emitido antes de cambiar el correo conserva el anterior hasta vencer. Con ese JWT y el token de invitación se puede aceptar aunque el correo actual de la cuenta ya sea otro. **Cambiaría:** comprobar dentro de la aceptación el correo actual y confirmado de `auth.users`, asociado a `auth.uid()`, y definir la vigencia de la sesión para esta operación.

4. **F2C-4 · Alta — El lock de emisión no serializa los cambios de contraseña en Auth.**  
   **Dónde:** [fase-2.md:163](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:163) y línea 202.  
   A emite QR-A y libera la transacción; B emite QR-B y cambia la contraseña; A termina después cambiándola nuevamente. Puede imprimirse QR-B con una contraseña que ya no sirve. Además, si Auth falla, ya se revocó el QR anterior y se registró una emisión que no terminó. **Cambiaría:** modelar la emisión completa como una operación durable por estudiante, serializada hasta resolver Auth, con estados, recuperación y publicación del resultado coherente. La prueba debe abarcar el servicio completo, no solo dos RPC SQL.

5. **F2C-5 · Alta — La idempotencia prometida no tiene almacenamiento ni recorrido completo.**  
   **Dónde:** [fase-2.md:128](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:128), líneas 145, 163 y 194.  
   Invitaciones agrega `op_key` sin `op_identity`; las tarjetas no tienen una relación con la operación ni un resultado original guardado. Además, `issueAccessCards` no recibe `opKey`. Tras perder una respuesta, el reintento genera otros tokens y contraseñas, y puede invalidar las tarjetas recién emitidas. **Cambiaría:** definir identidad inmutable, resultado y lock por operación conforme a fase 1, y llevar la misma clave desde el navegador hasta los efectos externos. También debe quedar explícita la recuperación cuando los secretos originales ya no están disponibles.

6. **F2C-6 · Alta — El aprovisionamiento no prioriza la primera cuenta ya recordada.**  
   **Dónde:** [fase-2.md:200](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:200); guardia en `20261113140000_t1_fix15.sql:73`.  
   La secuencia prescribe crear por correo incluso cuando `internal_get_student_accounts` devuelve `auth_user_id`. Si esa primera cuenta fue borrada, puede crear una segunda y recién descubrir al recordarla que la guardia lo prohíbe. Queda una cuenta huérfana; no corresponde debilitar la guardia para vincularla. **Cambiaría:** si existe una cuenta recordada, recuperar exclusivamente esa cuenta; si desapareció, detener el aprovisionamiento y conservar la identidad original. Nunca crear otra para ese estudiante.

7. **F2C-7 · Alta — Un trabajador atrasado puede convertir un aprovisionamiento exitoso en fallido.**  
   **Dónde:** [fase-2.md:166](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:166), líneas 167, 200 y 204.  
   Crear cuentas y reconciliar pueden leer la misma fila pendiente. Uno termina y la deja `active`; el otro encuentra un error y llama a `internal_fail_student_account`, cuya semántica manda marcarla `failed`. El login deja de resolver una cuenta válida. Tampoco hay una reserva que cierre la carrera con el borrado antes de crear en Auth. **Cambiaría:** reclamar cada intento con una versión o identificador, aceptar su finalización solo si sigue vigente y prohibir regresiones de estados terminales. Agregaría carreras de aprovisionamiento contra éxito, archivo y borrado.

8. **F2C-8 · Media — Falta una forma acotada de recuperar el usuario de Auth existente.**  
   **Dónde:** [fase-2.md:200](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:200); `node_modules/@supabase/auth-js/src/GoTrueAdminApi.ts:521` y `:623`.  
   Cuando el correo ya existe se exige comprobar `app_metadata.provisioning_id`, pero el error de creación no entrega ese usuario. El SDK instalado ofrece búsqueda por id y listado paginado, sin `getUserByEmail`. Recorrer todo Auth sería una consulta global innecesaria para cada recuperación. **Cambiaría:** agregar una RPC interna que resuelva exclusivamente la intención de aprovisionamiento y devuelva el id verificado y los datos mínimos. [Referencia del listado disponible](https://supabase.com/docs/reference/javascript/auth-admin-listusers).

9. **F2C-9 · Alta — Cambiar la contraseña o salir no garantiza el rechazo inmediato de una sesión anterior.**  
   **Dónde:** [fase-2.md:87](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:87), líneas 91 y 202.  
   `getClaims()` puede verificar localmente un JWT todavía válido. Aunque se revoquen los refresh tokens, una copia del access token puede seguir llamando RPC hasta vencer; hoy `jwt_expiry` es 3600. Una tarjeta nueva por pérdida no expulsa inmediatamente a quien ya entró. **Cambiaría:** fijar explícitamente qué eventos revocan acceso y comprobar en la base la sesión vigente o una versión de credenciales para las operaciones protegidas. Supabase documenta esta limitación y el chequeo mediante `session_id`. [Sesiones de Supabase](https://supabase.com/docs/guides/auth/sessions).

10. **F2C-10 · Media — La recuperación de contraseña se redirige fuera de su propia pantalla.**  
    **Dónde:** [fase-2.md:97](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:97), líneas 100 y 216.  
    `verifyOtp(type=recovery)` establece una sesión. Al llegar a `/ingresar/profesor/nueva`, la regla manda al staff con sesión a `/grupos`, antes de elegir la nueva contraseña. También falta asignar el template/configuración del correo que debe producir el enlace con `token_hash`. **Cambiaría:** exceptuar explícitamente el flujo de recuperación, definir sus transiciones y asignar callback y template a un ticket concreto.

11. **F2C-11 · Alta — El limitador de Tiza no protege las llamadas directas a Supabase Auth.**  
    **Dónde:** [fase-2.md:59](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:59), líneas 65 y 70.  
    Quien conoce un correo de staff —o un correo sintético obtenido de una sesión— puede llamar directamente a `/auth/v1/token?grant_type=password` con la clave pública. Esos intentos no pasan por los contadores de Tiza. Por tanto, la justificación de las contraseñas de unos 24 bits no queda garantizada por los límites declarados. **Cambiaría:** aplicar una protección equivalente dentro de Auth, por ejemplo mediante un hook de verificación de contraseña, y probar el endpoint directo. [Implementación de Auth](https://github.com/supabase/auth/blob/master/internal/api/token.go).

12. **F2C-12 · Media — Contar fallos atómicamente no limita los intentos concurrentes.**  
    **Dónde:** [fase-2.md:178](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:178) y servicios de línea 191.  
    Muchos pedidos pueden consultar un contador en cero antes de que termine el primero. Todos prueban contraseñas; después los incrementos quedan correctamente contados, pero ya se superó el límite. La carrera exigida solo comprueba que dos fallos suman dos. **Cambiaría:** reservar intentos en curso antes de consultar Auth, con vencimiento y finalización según éxito o fallo, y probar una ráfaga contra un único sujeto.

13. **F2C-13 · Media — Se modifica una cuota que no cubre el endpoint utilizado para contraseña.**  
    **Dónde:** [fase-2.md:65](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:65); `supabase/config.toml:213`.  
    `signInWithPassword` llama a `/token`; Auth aplica allí el limitador de tokens. Subir solamente `sign_in_sign_ups` no resuelve la concentración de logins y refrescos en la IP del servidor. Un ingreso simultáneo de varios grupos puede recibir 429 aunque los contadores propios permitan entrar. **Cambiaría:** verificar y configurar la cuota efectiva del endpoint de tokens y el mecanismo soportado de reenvío de IP, sin asumir que las dos cuotas son equivalentes. [Límites de Auth](https://supabase.com/docs/guides/auth/rate-limits).

14. **F2C-14 · Media — La identidad del contador estudiantil omite el colegio.**  
    **Dónde:** [fase-2.md:59](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:59), líneas 63 y 191.  
    El usuario es único por institución, pero los límites están definidos por «usuario». Treinta fallos contra `luciaf` pueden bloquear a las `luciaf` de otros colegios; un éxito puede limpiarles el contador compartido. **Cambiaría:** definir exactamente el sujeto normalizado como tupla de colegio y usuario, y la pareja como IP más esa tupla, antes del HMAC. Probaría dos instituciones con el mismo username.

15. **F2C-15 · Media — El error genérico no cierra la enumeración por tiempos.**  
    **Dónde:** [fase-2.md:169](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:169).  
    Para un usuario inexistente se permite responder inmediatamente; para uno existente se consulta Auth y se verifica la contraseña. Repetir mediciones permite distinguir cuentas aunque el texto sea idéntico. **Cambiaría:** definir un recorrido de trabajo comparable para los resultados negativos y respuestas uniformes, incluidos errores de Auth. El límite debe aplicarse también a usuarios inexistentes.

16. **F2C-16 · Media — No está definido cómo llega `retry_at` hasta la pantalla.**  
    **Dónde:** [fase-2.md:66](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:66); `lib/errors.ts:18`, `:30` y `lib/server/entry/run.ts:33`.  
    La RPC devuelve la hora, pero `AppError` y `Failure` no tienen ese campo y la entrada conserva únicamente código, mensaje y requestId. El implementador no tiene un contrato tipado para transmitirla. **Cambiaría:** definir el transporte de `retryAt` y asignar los cambios de errores, entradas y cliente al ticket correspondiente.

17. **F2C-17 · Media — Las firmas no cubren todas las pantallas elegidas.**  
    **Dónde:** [fase-2.md:188](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:188) y líneas 210–217; `docs/diseno/fase-2/admin-b.html:216`.  
    Faltan servicios declarados para cargar las listas de staff, invitaciones y cuentas; obtener el código institucional y completar el selector/alta de grupo. `previewUsernamesAction` y `createGroupAction` no tienen servicio asignado. Además, el diseño promete cambiar a admin desde la lista sin una operación correspondiente, y `readInvitation(token)` no recibe la IP exigida para limitar tokens inválidos. **Cambiaría:** cerrar firmas de lectura y mutación, DTO y dueño de cada recorrido, o corregir expresamente los textos que quedan fuera de fase.

18. **F2C-18 · Media — Hay trabajo obligatorio sin archivos asignados y dependencias incompletas.**  
    **Dónde:** [fase-2.md:276](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:276), T2.3, T2.5a y T2.5b.  
    Ningún ticket tiene asignado `app/auth/confirmar/route.ts`. T2.5a debe actualizar el inventario y su prueba, pero no puede tocar `permissions/tables.ts` ni `006_inventory.test.sql`. Tampoco se asignan las extensiones del protocolo de errores. T2.5b usa el repositorio privilegiado de Auth de T2.3 sin declararlo como archivo propio. **Cambiaría:** completar responsables, permisos de archivo y dependencias antes de repartir. No encontré una pisada obligatoria entre los archivos concretos de una misma tanda.

19. **F2C-19 · Media — Las guardias permiten recuperar tokens revocados mediante DML.**  
    **Dónde:** [20261114100000_f2_contract.sql:34](C:/Users/adrim/build101/.claude/worktrees/fase-1/supabase/migrations/20261114100000_f2_contract.sql:34) y línea 71.  
    La tarjeta impide cambiar `revoked_at` una vez puesto, pero no impide borrar esa fila y reinsertar su hash como vigente. En invitaciones, la guardia tampoco prohíbe `revoked → pending` conservando el token. Son caminos dentro del modelo de amenazas solicitado; `no_truncate` no los cierra. **Cambiaría:** conservar la memoria de revocación, impedir el borrado independiente de tarjetas mientras exista su estudiante y proteger los estados terminales de invitación. Probarlo como dueño mediante DML y con dos conexiones.

20. **F2C-20 · Baja — Las respuestas nuevas contradicen los nombres heredados.**  
    **Dónde:** [fase-2.md:145](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:145) y tablas de RPC; `docs/contratos/fase-1.md:74`.  
    Fase 1 exige resultados JSON en camelCase, pero fase 2 fija `expires_at`, `institution_id`, `auth_user_id`, `has_signed_in`, etc. SQL y zod pueden terminar implementando contratos distintos. **Cambiaría:** reservar snake_case para SQL y argumentos `p_*`, y escribir todas las salidas y DTO en camelCase.

21. **F2C-21 · Baja — El código de `role_conflict` no coincide con la guardia existente.**  
    **Dónde:** [fase-2.md:153](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:153); `20261112120000_t1_2a_fix.sql:35`.  
    El contrato promete `INVALID role_conflict` atribuyéndolo al trigger heredado, pero ese trigger devuelve `CONFLICT role_conflict`. Una implementación que conserve fase 1 incumple el criterio nuevo. **Cambiaría:** corregir el contrato a `CONFLICT` y exigir código y razón completos en las pruebas.

**Veredicto: necesita otra ronda.**

### Qué se cambió

Todos los hallazgos entran en la versión 2 del contrato: tokens en el fragmento (F2C-1), alta por invitación atómica con la cuenta de esa invitación (F2C-2, F2C-8), correo actual de auth.users (F2C-3), emisiones de tarjetas con plazo y estados (F2C-4, F2C-5), id de Auth elegido y recordado antes de crear (F2C-6, F2C-7), sesión vigente en rpc_begin (F2C-9), recuperar sin redirección y con plantilla (F2C-10), defensa de Auth directa y Sb-Forwarded-For medido (F2C-11, F2C-13), contar antes de probar (F2C-12), sujeto con el colegio (F2C-14), respuesta pareja (F2C-15), retryAt en Failure (F2C-16), servicios de lectura del panel (F2C-17), archivos asignados (F2C-18), guardias de estados y memoria de revocadas (F2C-19), camelCase (F2C-20) y CONFLICT role_conflict (F2C-21).

## Ronda 2

1. **F2C-22 · Alta · El alta por invitación sigue permitiendo cambios de contraseña atrasados.**  
   **Dónde:** [contrato:133](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:133), pasos 1–3.  
   **Escenario:** A y B encuentran la cuenta de esa invitación todavía sin ingresos. B se demora después de consultar. A termina la aceptación e inicia sesión. B continúa y cambia la contraseña; recién después `internal_finish_invitation_signup` rechaza la invitación ya aceptada. La membresía fue atómica, pero la contraseña quedó elegida por un intento que perdió. También puede ocurrir después de un reenvío que invalidó el token de B.  
   **Propongo:** una intención durable y exclusiva de alta que gobierne también los efectos en Auth. Integrar la búsqueda en una RPC autorizada por token: `internal_find_auth_user(p_email)` permite consultar cualquier correo y no acredita por sí misma autorización para modificar esa cuenta. No reutilizar `hasSignedIn` como reserva.

2. **F2C-23 · Media · La cuenta huérfana de una invitación revocada no tiene un recorrido completo de aceptación.**  
   **Dónde:** [contrato:135](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:135), línea 137 y `accept_invitation`.  
   **Escenario:** se crea Auth, se revoca la invitación y falla `internal_finish_invitation_signup`. Queda Auth sin `app_user`. Otra invitación manda a esa persona a «Ya tenés cuenta». Puede autenticarse, pero el recorrido de aceptación con sesión solo prescribe sumar la membresía: falta crear el padre `app_users` que exige su FK. Aplicar además el `require_actor` habitual de fase 1 lo rechazaría antes.  
   **Propongo:** definir expresamente cómo la aceptación con sesión crea o recupera ese `app_user`, dentro de su transacción y después de verificar la identidad actual. Probar revocación → nueva invitación → ingreso → aceptación.

3. **F2C-24 · Alta · El plazo de las tarjetas no serializa las escrituras en Auth.**  
   **Dónde:** [contrato:121](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:121), especialmente líneas 122 y 125.  
   **Escenario:** A obtiene el claim y se demora; vence su plazo; B abandona esa emisión, cambia la contraseña y entrega una tarjeta válida; A continúa y sobrescribe la contraseña de B. El claim no acompaña a `updateUserById` como condición comprobable por Auth. La demora también puede estar en una llamada de resultado incierto, no solamente entre dos instrucciones locales.  
   **Propongo:** no habilitar un sucesor mientras la escritura anterior siga indeterminada; definir serialización y recuperación del efecto externo. Agregar otro chequeo SQL antes de llamar tampoco elimina la carrera. Si se acepta deliberadamente esta garantía menor, corregir el criterio que promete una sola contraseña imprimible que funciona y probar explícitamente el caso del trabajador atrasado.

4. **F2C-25 · Alta · Aprovisionar puede recrear Auth después de una supresión; además hay dos políticas contradictorias.**  
   **Dónde:** [contrato:106](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:106), pasos 1–6, línea 113 y criterio de T2.5b en línea 500.  
   **Escenario:** A lee un aprovisionamiento pendiente con su UUID recordado y se detiene. Otro proceso marca `deleted`, suprime al estudiante y borra Auth. A continúa con `createUser` y recrea ese UUID. Si cae antes de la compensación, queda Auth nuevamente creado; incluso vuelve a resolver a una persona el identificador conservado en la marca de supresión. Evitar `active → failed` no cierra esta carrera.  
   **Propongo:** definir coordinación durable entre aprovisionamiento y supresión, incluida recuperación de creaciones de resultado incierto. `deleted` debe impedir nuevos intentos y la supresión debe resolver los que ya estaban en curso. Separar expresamente «Auth borrado accidentalmente» de «cuenta suprimida»: línea 113 manda recrear y T2.5b manda no recrear.

5. **F2C-26 · Alta · El nuevo `rpc_begin` rompe el aislamiento de ejecución del estudiante.**  
   **Dónde:** [contrato:239](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:239); [contrato de fase 1:136](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-1.md:136).  
   **Escenario:** una RPC `student_*` real ejecuta `rpc_begin` como `tiza_student`. Ese rol no tiene acceso al esquema `auth`, ni a `auth.jwt()` ni a `auth.sessions`. El chequeo falla con permisos insuficientes. Convertir `rpc_begin` en `SECURITY DEFINER` contradice la prohibición de helpers que presten privilegios y hace fallar `005_student_role`. Las pruebas sin `session_id` pueden ocultarlo.  
   **Propongo:** resolver en el contrato cómo validar sesiones desde ese rol: una proyección mínima con permisos y aislamiento adecuados, o una excepción mínima y explícitamente revisada al modelo anterior. Asignar sus cambios de permisos y pruebas. No conceder lectura global de sesiones como arreglo incidental.

6. **F2C-27 · Alta · El correo sintético estable no sustituye la defensa por cuenta en Auth.**  
   **Dónde:** [contrato:80](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:80), líneas 87 y 100.  
   **Escenario:** alguien copia una sesión en una computadora compartida y obtiene su correo sintético. El docente emite una tarjeta nueva y expulsa esa sesión, pero el correo permanece igual. El atacante ya puede dirigir intentos distribuidos al endpoint público de Auth contra una contraseña de unos 24 bits, sin pasar por los contadores de Tiza.  
   **Propongo:** aplicar una defensa por cuenta dentro de Auth —por ejemplo, un hook si el plan lo permite— o cambiar el esquema de credenciales y su análisis de seguridad. El límite por IP no equivale al límite por sujeto. [Supabase documenta ambos mecanismos](https://supabase.com/docs/guides/auth/rate-limits), [incluido el hook](https://supabase.com/docs/guides/auth/auth-hooks).

7. **F2C-28 · Alta · Las invitaciones todavía pierden la memoria de revocación mediante DML.**  
   **Dónde:** [contrato:225](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:225), guardias de estados y memoria.  
   **Escenario:** como dueño, se borra una invitación revocada y se inserta otra `pending` con el mismo hash y vencimiento futuro. Cumple nacimiento y unicidad; las guardias de transición nunca comparan ambas filas. La prohibición de borrar que prescribe el documento alcanza tarjetas y emisiones, pero no invitaciones.  
   **Propongo:** conservar la memoria de hashes invalidados, proteger su borrado y definir cómo sobrevive al reenvío y a la retención. Probar `DELETE + INSERT`, reutilización del hash y carreras entre conexiones, además de `TRUNCATE`.

8. **F2C-29 · Media · La inmutabilidad de `token_hash` contradice el reenvío.**  
   **Dónde:** [contrato:224](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:224), frente a líneas 225 y 256.  
   **Escenario:** `resend_invitation` intenta cambiar el hash de una invitación pendiente o vencida. La guardia general dice que `token_hash` no cambia y debe rechazarlo con `P0004`.  
   **Propongo:** separar las reglas de tarjetas e invitaciones. Para invitaciones, permitir la rotación definida por el contrato sin permitir recuperar hashes invalidados; no implementar una excepción que simplemente olvide el anterior.

9. **F2C-30 · Media · La supresión de estudiantes contradice la identidad y las restricciones de las emisiones.**  
   **Dónde:** [contrato:183](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:183), líneas 224 y 229.  
   **Escenario:** al suprimir un estudiante hay que quitarlo de `student_ids`, pero esa columna es inmutable. Si era el único, el arreglo vacío también viola `cardinality BETWEEN 1 AND 60`. Si se permite editarlo sin más, cambia el conjunto usado como identidad del `op_key`.  
   **Propongo:** definir la excepción de supresión dentro de `begin_erasure`, el caso sin integrantes y el destino de la identidad de operación. Protegerla como fase 1 protege las identidades redactables: una edición ordinaria no debe poder alterar el conjunto.

10. **F2C-31 · Media · Falta el resultado de reintentar una emisión `abandoned`.**  
    **Dónde:** [contrato:127](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:127), estado y unicidad de `access_card_issues`.  
    **Escenario:** una emisión vence y otra la marca `abandoned`. El navegador original reintenta con el mismo `op_key`. El contrato define `running` y `done`, pero no `abandoned`; tampoco puede insertar otra fila porque la clave sigue ocupada.  
    **Propongo:** fijar código, razón y comportamiento de pantalla para ese replay, incluido el uso de una clave nueva. Exigir la comparación de identidad también en este estado.

11. **F2C-32 · Media · El acuse del correo puede confirmar el envío de otro token.**  
    **Dónde:** [contrato:138](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:138), `resend_invitation` y `mark_invitation_sent` en líneas 256–258.  
    **Escenario:** A envía el correo con H1 y demora su acuse. B rota a H2 y su envío falla. A llama a `mark_invitation_sent(id)` y deja marcada como enviada la invitación que ahora contiene H2. El reintento ve `sentAt` y no recupera el envío fallido; el correo recibido contiene H1, invalidado.  
    **Propongo:** vincular envío y acuse a una revisión o generación de token; reiniciar el estado de envío al rotar y rechazar acuses atrasados. La misma identidad debe gobernar los reintentos.

12. **F2C-33 · Media · Esperar hasta 800 ms establece un mínimo, no una respuesta pareja.**  
    **Dónde:** [contrato:78](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:78).  
    **Escenario:** el usuario inexistente responde a los 800 ms; para uno existente, Auth tarda 1,5 segundos en rechazar. Mediciones repetidas vuelven a distinguirlos. También falta resolver la contradicción con T2.5b, que exige un error específico para colegio inexistente.  
    **Propongo:** definir trabajo negativo comparable, tiempos máximos y tratamiento uniforme de errores; probar las distribuciones con Auth lento y con fallos. Acordar qué diferencias de respuesta se permiten para colegios.

13. **F2C-34 · Media · Crear un grupo sigue sin recibir su materia.**  
    **Dónde:** [contrato:300](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:300); [RPC existente](C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/domain/groups/rpc.ts:39).  
    **Escenario:** el panel intenta crear un grupo mediante `createGroup({institutionId, name, schoolYear, opKey})`, pero `create_group` exige `p_subject_id`. El servicio no tiene el dato y tampoco está definido cómo elegirlo. Fijar matemática incumpliría las reglas del proyecto.  
    **Propongo:** agregar `subjectId` al recorrido completo y definir la fuente del selector de materias habilitadas.

14. **F2C-35 · Media · Los archivos asignados chocan con las fronteras de imports existentes.**  
    **Dónde:** [contrato:295](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:295), tickets T2.1/T2.3/T2.5b; [regla de capas](C:/Users/adrim/build101/.claude/worktrees/fase-1/eslint/rules/layers.mjs:25).  
    **Escenario:** `services/student-accounts.ts`, `services/invitations.ts` y `services/rate-limit.ts` necesitan los repos privilegiados asignados, pero ESLint solo permite importarlos desde `services/admin/**`, jobs, tests u otros repos admin. `auth/actor.ts` tampoco puede importar `db/client.ts`; los repos existentes requieren recibir el cliente. No está asignado un recorrido compatible para obtenerlo.  
    **Propongo:** fijar las fachadas, repos de sesión y servicios privilegiados necesarios, con sus rutas y propietarios, antes de repartir. Asignar también dónde se implementan los encabezados HTTP de las páginas con tokens: los tickets de front no pueden establecerlos desde un Client Component.

Las APIs señaladas **sí están disponibles** en la instalación revisada:

- `createUser({ id })`: `AdminUserAttributes.id` existe y el SDK envía los atributos al endpoint admin. También lo admite la [implementación de Auth consultada](https://raw.githubusercontent.com/supabase/auth/master/internal/api/admin.go).
- `verifyOtp({ token_hash, type: "recovery" })`: está tipado y guarda la sesión al verificar.
- `signOut({ scope: "local" | "others" })`: ambos alcances existen. `others` conserva la sesión actual; el JWT viejo requiere el chequeo adicional en base. [Semántica oficial](https://supabase.com/docs/guides/auth/signout).
- Fragmento → lectura en cliente → Server Action por POST es viable. El fragmento no reemplaza al argumento: hay que conservar el token en memoria para las acciones posteriores.
- La guía instalada sí recomienda `use cache: private`; `cacheComponents` ya está habilitado. No encuentro una incompatibilidad intrínseca ahí.

Respecto de la primera cuenta, **reservar el UUID antes de crear Auth es compatible con fase 1**: `auth_user_id` no tiene FK a Auth; `account_provisioning_born` exige concordancia cuando el estudiante ya está vinculado y `frozen` conserva el primer UUID. El orden estudiante → provisioning de `internal_remember_student_account` también coincide con `t1_fix15`. No hace falta debilitar esas guardias. Lo pendiente es la coordinación con la supresión descrita en F2C-25.

El estado de la ronda anterior corresponde al **diseño del documento**, no a los stubs en reescritura:

| Hallazgo | Estado | Motivo |
|---|---|---|
| F2C-1 | **Cerrado** | Fragmento, POST y exclusión explícita de logs. |
| F2C-2 | **Abierto** | La membresía es atómica; los efectos sobre Auth siguen sin reserva exclusiva. F2C-22/23. |
| F2C-3 | **Cerrado** | Exige correo actual y confirmado de `auth.users`. |
| F2C-4 | **Abierto** | El plazo no impide escrituras externas atrasadas. F2C-24. |
| F2C-5 | **Abierto** | Mejoró el protocolo, pero faltan replay `abandoned` y acuse ligado al token. F2C-31/32. |
| F2C-6 | **Cerrado** | Se recuerda y reutiliza el primer UUID; la política de recreación necesita aclaración en F2C-25. |
| F2C-7 | **Abierto** | Se evita degradar `active`, pero permanece la carrera contra supresión. F2C-25. |
| F2C-8 | **Cerrado** | El aprovisionamiento puede recuperar por UUID mediante `getUserById`. El lookup general abre F2C-22. |
| F2C-9 | **Abierto** | La solución no contempla los privilegios de `tiza_student`. F2C-26. |
| F2C-10 | **Cerrado** | Recuperación sin redirección y plantilla asignada. |
| F2C-11 | **Abierto** | UUID oculto y límite por IP no garantizan el límite por cuenta. F2C-27. |
| F2C-12 | **Cerrado** | Contar atómicamente antes de probar cierra la ráfaga de fallos descrita. |
| F2C-13 | **Cerrado** | Ahora contempla `/token`, forwarding soportado y medición de cuotas. |
| F2C-14 | **Cerrado** | El sujeto incluye colegio y usuario normalizados. |
| F2C-15 | **Abierto** | El piso de 800 ms no iguala recorridos más lentos. F2C-33. |
| F2C-16 | **Cerrado** | Define transporte de `retryAt` y responsabilidad del contrato. |
| F2C-17 | **Abierto** | Falta la materia en el alta de grupo. F2C-34. |
| F2C-18 | **Abierto** | Persisten recorridos sin archivos asignados compatibles con las capas. F2C-35. |
| F2C-19 | **Abierto** | Las invitaciones permiten recuperar el hash mediante borrado y reinserción. F2C-28. |
| F2C-20 | **Cerrado** | Salidas y DTO declarados en camelCase. |
| F2C-21 | **Cerrado** | Corrige a `CONFLICT role_conflict`. |

**Veredicto: necesita otra ronda.**

### Qué se cambió

Versión 3 del contrato: la regla del plazo para toda escritura en Auth, apoyada en el corte de 60 s de Netlify (F2C-24, F2C-25); internal_claim_provisioning y la supresión que espera el plazo (F2C-25); el alta por invitación nunca cambia la contraseña de una cuenta existente y accept_invitation crea el app_user que falte; sale internal_find_auth_user (F2C-22, F2C-23); app.session_alive para tiza_student (F2C-26); correo sintético que cambia con cada tarjeta y contraseñas de tres palabras (F2C-27); invitation_spent_tokens y memoria de invitaciones (F2C-28, F2C-29); emisiones sin ids de estudiantes, con op_identity (F2C-30); card_issue_abandoned (F2C-31); mark_invitation_sent con revisión (F2C-32); cuenta señuelo y plazo de 5 s en Auth (F2C-33); subjectId y list_enabled_subjects (F2C-34); servicios privilegiados en services/admin y repo de sesión de Auth (F2C-35).

## Ronda 3

1. **F2C-36 · Alta — El corte de Netlify no resuelve una escritura de Auth cuyo resultado quedó incierto.**

   **Dónde:** [regla del plazo y finalización](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:105), pasos de emisión y `internal_fail_student_account`, línea 324.

   **Escenario:** A manda un cambio de contraseña. A los cinco segundos aborta la espera, pero no sabe si Auth lo aplicó o todavía lo está procesando. El servicio considera fallida esa tarjeta y termina la emisión. B puede empezar inmediatamente y entregar otra contraseña; la escritura pendiente de A puede completarse después y sobrescribirla. En aprovisionamiento, liberar el plazo tras ese error permite que la supresión borre Auth antes de que termine una creación incierta.

   Netlify efectivamente documenta el [límite de 60 segundos](https://docs.netlify.com/build/functions/configuration/). Eso acota al trabajador local; **no demuestra que abortar su petición cancele o revierta el efecto remoto**. Tampoco obliga a esperar cinco minutos cuando la operación se declara terminada antes.

   **Propongo:** distinguir fallo confirmado de resultado indeterminado. Este último no debe liberar la exclusión ni habilitar una supresión definitiva hasta resolver el efecto externo. Si la solución depende de un máximo de procesamiento remoto, el contrato debe identificar y verificar esa garantía de Auth. El riesgo aceptado para terminales locales no cubre este caso de producción.

2. **F2C-37 · Alta — El plazo del que depende la supresión queda modificable por DML directo.**

   **Dónde:** [guardia de `lease_until`](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:268), frente a «Suprimir gana», línea 124.

   **Escenario:** A confirma su plazo y se detiene brevemente antes de `createUser`. El dueño ejecuta `UPDATE account_provisioning SET lease_until = NULL`. La supresión marca `deleted` y, al no encontrar un plazo vigente, intenta borrar Auth. A continúa dentro de los 60 segundos y crea la cuenta después de ese borrado. No hizo falta DDL ni un trabajador que sobreviviera cinco minutos.

   La justificación «sin guardia especial: no da acceso a nada» no alcanza: esa columna gobierna cuándo se permite borrar Auth y cuándo puede entrar otro trabajador.

   **Propongo:** proteger también por guardias la conservación del plazo y sus condiciones de liberación. Definir expresamente las transiciones permitidas durante `deleted` y ante resultados inciertos. Probar acortamiento y vaciado como dueño, concurrentes con creación y supresión.

3. **F2C-38 · Media — Falta identificar al titular del plazo y separar adquisición de confirmación.**

   **Dónde:** [regla general](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:109), `internal_claim_provisioning`, `internal_remember_student_account` e `internal_fail_student_account`, líneas 321–324.

   **Escenario:** A adquiere el plazo, intenta crear una cuenta ya existente y debe consultar `getUserById`. Para cumplir la confirmación antes de cada llamada vuelve a usar `internal_claim_provisioning`. La RPC recibe solamente `provisioning_id`: no puede distinguir una confirmación de A de una adquisición por B. Tampoco `remember` o `fail` acreditan ser del intento que obtuvo el plazo.

   Además, la regla general incluye crear profesores invitados, pero ese recorrido no define ningún claim ni almacenamiento de plazo.

   **Propongo:** devolver una identidad del intento y exigirla al confirmar, recordar y finalizar; especificar qué ocurre cuando la confirmación pierde vigencia. Para las invitaciones, implementar el protocolo o exceptuar explícitamente su creación, justificándolo por creación exclusiva y ausencia de cambios sobre cuentas existentes. Esa identidad no sustituye la resolución del efecto remoto de F2C-36.

4. **F2C-39 · Alta — La memoria de hashes gastados necesita exclusión entre tablas, también bajo concurrencia.**

   **Dónde:** [`invitation_spent_tokens` y guardias](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:242), especialmente línea 265.

   **Escenario:** A rota una invitación de H1 a H2 e inserta H1 en gastados, sin confirmar todavía. B intenta insertar otra invitación con H1. Su consulta de gastados no ve la escritura de A; el índice único de invitaciones espera. Cuando A confirma, H1 queda libre en ese índice y B puede insertarlo. Consultar gastados antes del índice no evita esa carrera. Con una transacción del dueño en `REPEATABLE READ`, tampoco alcanza con repetir una lectura ordinaria después de esperar.

   Es una consecuencia de combinar [la comprobación de unicidad](https://www.postgresql.org/docs/current/index-unique-checks.html) con [snapshots separados](https://www.postgresql.org/docs/current/transaction-iso.html). Los dos índices únicos actuales no imponen unicidad entre ambas tablas.

   **Propongo:** fijar una reserva durable común por hash, con estado terminal protegido, o un mecanismo equivalente cuya corrección alcance todos los caminos DML. Exigir pruebas con dos conexiones como dueño, incluyendo reutilización durante una rotación y `REPEATABLE READ`. La solución secuencial de borrar y reinsertar sí mejoró; falta cerrar esta variante.

5. **F2C-40 · Media — Los privilegios de `session_alive` chocan con otra compuerta de fase 1.**

   **Dónde:** [excepción de privilegios](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:63) y [prueba heredada](/C:/Users/adrim/build101/.claude/worktrees/fase-1/supabase/tests/000_privileges.test.sql:122).

   **Escenario:** T2.7 concede `EXECUTE` a `authenticated` y `service_role`, además de `tiza_student`, exactamente como manda el documento. `000_privileges` exige que esos dos primeros roles no tengan ejecución sobre ninguna función de `app`: falla aunque se actualice `005_student_role`. T2.7 tampoco tiene asignado modificar `000_privileges`.

   **Propongo:** conceder ejecución solamente a `tiza_student`; las RPC de staff ya corren como `postgres`, dueño del helper. Si se mantienen los otros grants, documentar otra excepción y asignar su prueba.

   La excepción mínima para el estudiante **sí tiene una razón suficiente**: una función fija que devuelve un booleano evita conceder lectura de `auth.sessions` y no abre acceso a perfiles o claves.

6. **F2C-41 · Media — Las capas nuevas todavía no completan el recorrido de obtención del cliente.**

   **Dónde:** [tabla de servicios y repos](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:334) y [`listMyInstitutions`](/C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/server/repos/institutions.ts:8).

   **Escenario:** T2.1 implementa `getActor()`. Obtiene claims mediante `auth-session.ts`, pero `listMyInstitutions(db)` exige un `RpcDb`. El contrato de `auth-session.ts` solo declara operaciones de Auth y no entrega ese cliente ni ejecuta las consultas institucionales. `actor.ts` sigue sin poder importar `db/client.ts`, y `repos/institutions.ts` no está asignado a T2.1. El mismo hueco aparece al usar los repos existentes de grupos desde los servicios nuevos.

   **Propongo:** declarar una fábrica o un contexto de sesión desde un repo autorizado, o fachadas que creen el cliente dentro del repo, y asignar los archivos necesarios. Mover los servicios privilegiados a `services/admin/**` cierra esa mitad de F2C-35; no completa esta otra.

7. **F2C-42 · Baja — La retención de invitaciones necesita una excepción explícita a la inmutabilidad del correo.**

   **Dónde:** [memoria y retención](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:267) y [`invitations_frozen` de T1.F15](/C:/Users/adrim/build101/.claude/worktrees/fase-1/supabase/migrations/20261113140000_t1_fix15.sql:108).

   **Escenario:** fase 9 intenta redactar el correo de una invitación cerrada hace más de 90 días. La guardia heredada rechaza cualquier cambio de `email`, incluso dentro del modo de supresión. Conservar la fila resuelve la memoria del token, pero la redacción prometida no pasa esa guardia.

   **Propongo:** dejar documentada la excepción acotada de retención, sus condiciones y su prueba para fase 9. Se implementa mediante una migración nueva, conservando las protecciones de aceptación y pertenencia.

El estado de los hallazgos anteriores, evaluado contra la **versión 3**, es:

| Hallazgo | Estado | Motivo |
|---|---|---|
| F2C-1 | **Cerrado** | Fragmento, envío por POST y exclusión de logs. |
| F2C-2 | **Cerrado** | El huérfano está contemplado y puede recuperar la aceptación; no se sobrescribe una cuenta existente. |
| F2C-3 | **Cerrado** | Verifica el correo actual y confirmado de Auth. |
| F2C-4 | **Abierto** | Sigue faltando resolver escrituras externas indeterminadas. F2C-36. |
| F2C-5 | **Cerrado** | Identidad durable y replay definido para todos los estados; explica la pérdida de secretos. |
| F2C-6 | **Cerrado** | Recuerda y reutiliza el primer UUID. |
| F2C-7 | **Abierto** | Cierra la degradación de `active`, pero permanece la carrera contra supresión. F2C-36/37. |
| F2C-8 | **Cerrado** | Recuperación por UUID; desaparece la necesidad de búsqueda libre por correo. |
| F2C-9 | **Cerrado** | El chequeo de sesión en base resuelve el access token revocado para llamadas posteriores. |
| F2C-10 | **Cerrado** | Recuperación exceptuada de redirecciones y plantilla asignada. |
| F2C-11 | **Cerrado** | Cambia las credenciales y declara una defensa y un riesgo residual para Auth directo. |
| F2C-12 | **Cerrado** | Reserva intentos atómicamente antes de probar. |
| F2C-13 | **Cerrado** | Contempla `/token`, forwarding y medición de cuotas. |
| F2C-14 | **Cerrado** | El sujeto incluye colegio y usuario normalizados. |
| F2C-15 | **Cerrado** | La cuenta señuelo agrega trabajo negativo comparable. |
| F2C-16 | **Cerrado** | `retryAt` tiene transporte y responsables definidos. |
| F2C-17 | **Cerrado** | Completa lecturas del panel y alta con materia. |
| F2C-18 | **Abierto** | Persiste el recorrido incompleto entre servicios, cliente y repos existentes. F2C-41. |
| F2C-19 | **Abierto** | La memoria mejora, pero falta cerrar la reutilización concurrente. F2C-39. |
| F2C-20 | **Cerrado** | Salidas declaradas en camelCase. |
| F2C-21 | **Cerrado** | Usa `CONFLICT role_conflict`. |
| F2C-22 | **Cerrado** | Ningún alta modifica la contraseña de una cuenta existente; elimina la búsqueda libre. |
| F2C-23 | **Cerrado** | Aceptar con sesión crea el `app_user` faltante dentro de la transacción. |
| F2C-24 | **Abierto** | La justificación temporal no resuelve efectos inciertos ni liberaciones anticipadas. F2C-36/37. |
| F2C-25 | **Abierto** | Distingue borrado accidental de supresión, pero la exclusión todavía tiene huecos. F2C-36–38. |
| F2C-26 | **Cerrado** | Define una excepción mínima viable para `tiza_student`; los grants adicionales abren F2C-40. |
| F2C-27 | **Cerrado** | Rota el correo y aumenta la entropía de la contraseña. |
| F2C-28 | **Abierto** | Falta exclusión concurrente entre hashes vigentes y gastados. F2C-39. |
| F2C-29 | **Cerrado** | Distingue explícitamente la rotación de invitaciones de las columnas inmutables. |
| F2C-30 | **Cerrado** | Elimina la lista de estudiantes de la emisión y conserva su identidad resumida. |
| F2C-31 | **Cerrado** | Define código, texto y nueva clave para `abandoned`. |
| F2C-32 | **Cerrado** | Vincula el acuse a la revisión del token. |
| F2C-33 | **Cerrado** | Añade verificación contra señuelo, timeout y diferencias permitidas. |
| F2C-34 | **Cerrado** | Incluye `subjectId` y la fuente del selector. |
| F2C-35 | **Abierto** | Corrige imports privilegiados y encabezados, pero falta obtener el cliente de sesión. F2C-41. |

La reserva previa del UUID **es compatible con T1.F12–T1.F15**: `auth_user_id` no tiene FK a Auth, `account_provisioning_born` exige concordancia cuando ya hay vínculo y `frozen` conserva el primer UUID. El orden estudiante → provisioning también coincide. No hace falta debilitar esas guardias.

En las APIs instaladas, confirmé:

- **`createUser({ id })` está permitido**: [`AdminUserAttributes.id`](/C:/Users/adrim/build101/.claude/worktrees/fase-1/node_modules/@supabase/auth-js/src/lib/types.ts:649) y envío de atributos al endpoint admin.
- **`verifyOtp({ token_hash, type: "recovery" })` está permitido** y guarda la sesión.
- **`signOut({ scope: "local" | "others" })` está permitido**; `others` conserva la sesión actual.
- Los métodos admin **no reciben un `AbortSignal` como parámetro por llamada**. El timeout debe conectarse mediante un `fetch` personalizado u otro adaptador válido; pasarlo como atributo del usuario no lo implementa.
- Fragmento → cliente → Server Action por POST y `'use cache: private'` son compatibles con las [guías instaladas de Next 16](/C:/Users/adrim/build101/.claude/worktrees/fase-1/node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md).

No reabro la cuenta huérfana de invitación: sin membresía no concede acceso y ahora tiene recuperación definida. Tampoco reabro la enumeración de staff, expresamente aceptada, ni la defensa de Auth directo solo por carecer de contador por sujeto: correo independiente y rotativo más contraseña reforzada constituyen una mitigación razonable para esta fase. La afirmación «lleva años» sigue siendo una estimación dependiente del volumen distribuido, no una garantía de límite por cuenta. La cuenta señuelo y los 800 ms resuelven el recorrido negativo comparable; no deben interpretarse como igualdad matemática de latencias.

**Veredicto: necesita otra ronda.**

### Qué se cambió

Versión 4: resultado incierto de Auth que extiende el plazo a 15 minutos y no lo suelta, con el corte de GoTrue a verificar en T2.5b (F2C-36); plazos que solo crecen, con guardia (F2C-37); titular del plazo en claim, remember y fail, y el alta de profes exceptuada con razón (F2C-38); invitation_tokens como registro único de todo hash (F2C-39); session_alive solo para tiza_student (F2C-40); sessionDb y adminDb como fábricas de cliente (F2C-41); la excepción de retención del correo queda para la fase 9 (F2C-42).

## Ronda 4

1. **F2C-43 · Alta — La extensión posterior al error no cubre la caída del proceso.**

   **Dónde:** [regla del plazo](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:110), tratamiento del resultado incierto y pasos de extensión.

   **Escenario:** A confirma un plazo de cinco minutos. Se demora 50 segundos antes de enviar a Auth: todavía quedan más de cuatro minutos. La llamada vence localmente cinco segundos después, pero falla la RPC que debía extender el plazo y Netlify termina el proceso. Solo quedaron guardados los cinco minutos originales.

   El contrato admite un procesamiento remoto de hasta cinco minutos. Con uno de cuatro minutos y medio, B puede empezar al vencer el plazo original y entregar una contraseña antes de que termine la escritura de A. En aprovisionamiento, la supresión puede completar el borrado antes de que llegue la creación.

   Además, buscar el valor predeterminado en el código no verifica la configuración efectiva ni demuestra un límite sobre los efectos pendientes. En el código consultado, el middleware usa cancelación de contexto; no mata el handler. Esa distinción requiere verificar también cómo termina la escritura. [Middleware de Auth](https://github.com/supabase/auth/blob/master/internal/api/middleware.go), [configuración](https://github.com/supabase/auth/blob/master/internal/conf/configuration.go).

   **Cambio propuesto:** guardar **antes de llamar a Auth** un plazo que cubra la demora máxima del trabajador más el procesamiento remoto y un margen, incluso si nunca se ejecuta la extensión. Alternativamente, demostrar una cota remota suficientemente menor para que los cinco minutos originales alcancen. T2.5b debe bloquear también ante configuración desconocida, timeout desactivado o ausencia de una garantía sobre los efectos.

2. **F2C-44 · Alta — Revocar una tarjeta pendiente elimina la exclusión sin acortar el plazo.**

   **Dónde:** [empezar una emisión](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:143) y [transiciones permitidas](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:278).

   **Escenario:** A confirma su emisión y empieza a cambiar la contraseña. El dueño ejecuta un `UPDATE` de su tarjeta `pending` a `revoked`, con `revoked_at`. Es una transición expresamente permitida; no modifica `lease_until`.

   B llama a `begin_access_cards`. Como ya no encuentra una tarjeta `pending`, empieza otra emisión, cambia la contraseña e imprime. La escritura de A termina después y sobrescribe esa contraseña. Que la finalización de A falle no repara la tarjeta que B ya imprimió.

   **Cambio propuesto:** conservar la reserva por estudiante independientemente del estado de la tarjeta. La adquisición siguiente debe comprobar esa reserva aunque la tarjeta haya pasado a `active` o `revoked`. Definir y proteger todos los caminos que dejan de bloquear, incluidos DML directo, finalización y cascadas. Probar esta secuencia como dueño con dos conexiones.

3. **F2C-45 · Media — El timeout de `adminDb` no tiene un recorrido definido hasta las llamadas de Auth.**

   **Dónde:** [fábricas y repos de Auth](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:355), T2.7 y T2.3.

   **Escenario:** T2.7 agrega el `fetch` de cinco segundos en `repos/admin/db.ts`, como está asignado. T2.3 implementa `auth-users.ts` usando `db/admin.ts`, como indica su tabla. Esa fábrica existente no recibe opciones de `fetch`. El timeout agregado al otro cliente no alcanza estas llamadas.

   Tampoco puede usarse directamente el resultado declarado de `adminDb()` para Auth: [`RpcDb`](/C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/server/repos/rpc.ts:17) expone solamente `rpc`, sin `auth`.

   **Cambio propuesto:** fijar una fábrica del cliente completo de Auth con ese `fetch`, asignar su archivo y obligar a `auth-users.ts` a usarla. Puede conservarse `adminDb(): RpcDb` para los repos de RPC. Agregar una comprobación del timeout a través del recorrido real de `createAuthUser` y `updateAuthUser`.

4. **F2C-46 · Media — La respuesta ante un titular incorrecto contradice las salidas declaradas.**

   **Dónde:** [regla del titular](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:109) y [firmas de remember/fail](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:339).

   **Escenario:** A conserva un titular viejo y B adquiere el plazo después de vencer. A llama a `internal_remember_student_account` o `internal_fail_student_account`. La regla general exige devolver `ok: false`, pero sus salidas declaradas son `{authUserId}` y `{status, attempts}`. Con validación cerrada, devolver lo exigido por la regla rompe el esquema; devolver lo exigido por la tabla no comunica la pérdida del titular.

   **Cambio propuesto:** declarar las variantes de éxito y rechazo de cada RPC afectada, incluyendo sus campos y el comportamiento del servicio. Actualizar conjuntamente firmas, esquemas y criterios del contrato.

El estado de los hallazgos abiertos de la ronda 3 queda así. «Cerrado» se refiere al defecto concreto denunciado; los problemas nuevos están identificados arriba.

| Hallazgo | Estado en v4 | Motivo |
|---|---|---|
| F2C-4 | **Abierto** | Aún puede imprimirse una contraseña que luego sobrescribe otro intento: F2C-43/44. |
| F2C-7 | **Abierto parcialmente** | Impide degradar `active`, pero la carrera de creación contra supresión conserva el caso de F2C-43. |
| F2C-18 | **Cerrado** | Las fábricas y sus responsables completan la obtención del cliente para los repos existentes. |
| F2C-19 | **Cerrado** | Define memoria protegida y estados terminales; las invitaciones tienen ahora registro común de hashes. |
| F2C-24 | **Abierto** | La exclusión externa sigue dependiendo de una extensión que puede no persistirse y de un bloqueo eliminable: F2C-43/44. |
| F2C-25 | **Abierto parcialmente** | Distingue correctamente borrado accidental y supresión; persiste la creación tardía de F2C-43. |
| F2C-28 | **Cerrado** | El registro único evita reutilizar hashes históricos. |
| F2C-35 | **Cerrado** | Resuelve imports privilegiados, encabezados y obtención del cliente de sesión. |
| F2C-36 | **Abierto** | Distinguir incertidumbre es correcto, pero la extensión posterior no cubre todos los fallos: F2C-43/44. |
| F2C-37 | **Cerrado** | Prohíbe acortar o vaciar el plazo mediante DML. F2C-44 lo evade sin modificarlo. |
| F2C-38 | **Cerrado en identidad y excepción** | Agrega titular y separa adquisición de confirmación. Falta corregir las salidas nuevas: F2C-46. |
| F2C-39 | **Cerrado** | Todos los hashes compiten en un único índice durable; desaparece la carrera entre tablas, también en `REPEATABLE READ`. |
| F2C-40 | **Cerrado** | `EXECUTE` solo para `tiza_student` evita el choque con `000_privileges`. |
| F2C-41 | **Cerrado** | `sessionDb` y `adminDb` completan el recorrido de los repos que reciben `RpcDb`. El recorrido de Auth abre F2C-45. |
| F2C-42 | **Cerrado** | La excepción futura queda acotada, exige migración nueva y tiene prueba prevista. |

Las razones declaradas **sí alcanzan** para exceptuar el alta de profes: solo crea cuentas, Auth impide repetir el correo y el perdedor nunca modifica la cuenta ganadora. También alcanza aceptar el riesgo de terminales manuales **en local o staging**, manteniendo el corte de ejecución exigido para producción.

La excepción mínima de `session_alive` y diferir la retención a fase 9 también están justificadas. Mantengo aceptados los riesgos ya evaluados de cuentas huérfanas sin membresía, enumeración de staff y defensa de Auth directo. Los problemas de exclusión anteriores afectan producción y el modelo de DML indicado; esas aceptaciones no los cubren.

**Veredicto: necesita otra ronda.**

### Qué se cambió

Versión 5: una sola reserva por estudiante en account_provisioning para toda escritura en Auth, que se lleva a 15 minutos antes de cada llamada y nunca se suelta (F2C-43, F2C-44); la verificación del corte de GoTrue bloquea T2.5b si no se puede probar (F2C-43); authAdmin con el fetch de 5 s como única puerta de auth-users.ts (F2C-45); salidas ok true y ok false declaradas (F2C-46). Se van internal_claim_card_password, internal_claim_provisioning, los extend y p_uncertain; entra internal_claim_account. Crear un estudiante ya no aprovisiona: la cuenta nace con la primera tarjeta.

## Ronda 5

1. **F2C-47 · Alta — El endpoint público de Auth permite escribir fuera de la reserva.**

   **Dónde:** [reserva única, línea 107](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:107), emisión y revocación de sesiones.

   **Escenario:** un estudiante autenticado puede cambiar su contraseña directamente mediante `PUT /auth/v1/user`. Esa llamada no pasa por `authAdmin()` ni por `internal_claim_account`. Supabase ofrece expresamente esa operación. [Documentación oficial](https://supabase.com/docs/reference/javascript/auth-updateuser).

   Puede empezar con una sesión válida y quedar demorada después de autenticarse. Mientras tanto, el profe cambia la contraseña, revoca las sesiones e imprime la tarjeta. La petición anterior continúa y sobrescribe esa contraseña: el recorrido consultado prepara el cambio antes de la transacción y posteriormente guarda la contraseña sin volver a exigir la existencia de la sesión. Es una carrera derivada del [handler de actualización](https://github.com/supabase/auth/blob/master/internal/api/user.go) y de [UpdatePassword](https://github.com/supabase/auth/blob/master/internal/models/user.go).

   **Propongo:** definir un control efectivo en Auth o en su base que impida cambios autónomos de credenciales de estudiantes y exija una autorización ligada al protocolo. Debe cubrir también peticiones ya autenticadas cuando empieza la emisión. Asignar implementación y prueba contra el endpoint público; esconder el botón o canalizar nuestro servidor por `authAdmin()` no cierra este camino.

2. **F2C-48 · Alta — `deleted` no queda protegido como estado terminal de aprovisionamiento.**

   **Dónde:** [«Suprimir gana», línea 136](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:136), [guardias, línea 291](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:291) y `internal_claim_account`.

   **Escenario:** la supresión marca el aprovisionamiento `deleted` mientras todavía existe el estudiante, por ejemplo mientras espera una reserva vigente. Un DML del dueño lo devuelve a `pending`. Cuando vence la reserva, `reconcile` puede reclamarlo y volver a crear Auth. El claim cumple su comprobación actual, pero ya se incumplió «desde ese momento ningún claim da ok».

   Las guardias enumeradas protegen los estados de tarjetas, emisiones e invitaciones y las columnas de reserva. No incluyen la irreversibilidad de `account_provisioning.status = 'deleted'`; las guardias heredadas tampoco la aportan mientras `student_id` siga presente. Prohibir esa transición solamente dentro de `fail` no protege el DML directo.

   **Propongo:** exigir una guardia P0004 que haga terminal `deleted`, también contra el dueño. Agregar la prueba `deleted → pending/failed/active` y una carrera con claim durante la espera de supresión.

3. **F2C-49 · Alta — El reintento por UUID puede quedar atrapado permanentemente como incierto.**

   **Dónde:** [aprovisionamiento, pasos 3–4, línea 132](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:132) y clasificación de todos los 5xx como inciertos.

   **Escenario:** Auth crea el UUID recordado, pero el proceso cae antes de vincularlo. El siguiente intento genera otro correo sintético y vuelve a ejecutar `createUser` con ese UUID. El contrato depende de reconocer «el id ya existe» para pasar a `getUserById`.

   En el [GoTrue consultado](https://github.com/supabase/auth/blob/master/internal/api/admin.go), el UUID duplicado llega al INSERT y el error transaccional se devuelve como **500**. No hay una respuesta específica equivalente al conflicto de correo. Aplicando la regla del documento, el servicio lo considera incierto, espera quince minutos y repite exactamente el mismo problema.

   **Propongo:** consultar primero el UUID recordado, bajo reserva; si existe, verificar `provisioning_id` y actualizarlo; crear solamente ante ausencia confirmada. Mantener el tratamiento conservador de resultados inciertos. Exigir la prueba contra la versión desplegada, incluyendo caída después de crear Auth y antes del vínculo.

4. **F2C-50 · Media — Entre `begin_access_cards` y el claim pueden perder las dos emisiones concurrentes.**

   **Dónde:** [pasos de emisión, línea 144](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:144).

   **Escenario:**

   - A termina `begin_access_cards`: dejó tarjeta pendiente, pero todavía no tomó la reserva.
   - B ejecuta `begin_access_cards`, encuentra la reserva libre, revoca la tarjeta de A y abandona su emisión.
   - A ejecuta primero `internal_claim_account`. Esa RPC comprueba la cuenta y el titular, pero no exige una emisión vigente: obtiene la reserva y cambia Auth.
   - B pierde el claim. A pierde `finish_access_cards` porque su emisión está abandonada.

   Ninguno imprime y la contraseña anterior ya cambió; además, quedan hasta quince minutos de espera. No requiere DML directo.

   **Propongo:** adquirir las reservas en `begin_access_cards`, dentro de la misma transacción, o vincular el claim de emisión a una tarjeta pendiente y una emisión `running`, comprobadas bajo los mismos locks. Precisar también qué representa el `leaseUntil` que devuelve `begin` si todavía no adquirió ninguna reserva.

5. **F2C-51 · Media — Falta transportar el resultado incierto y la hora de reintento hasta la pantalla.**

   **Dónde:** [mensaje prometido, línea 161](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:161), `list_group_accounts`, `applyCardPassword` y [salida de `issueAccessCards`, línea 393](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:393).

   **Escenario:** dos estudiantes quedan inciertos con reservas confirmadas en momentos distintos. La acción devuelve únicamente sus ids en `failed`. No comunica cuáles fueron inciertos ni sus `retryAt`. Al recargar, `list_group_accounts` tampoco devuelve la reserva. La pantalla no puede construir el mensaje contractual con la hora correcta.

   **Propongo:** declarar resultados por estudiante con estado y `retryAt`, y exponer esa disponibilidad en la lectura de cuentas. Completar el transporte del conflicto por estudiante: el `Failure.retryAt` singular no representa por sí solo el detalle prometido para un conjunto.

6. **F2C-52 · Media — La recuperación mediante «Imprimir de nuevo» contradice el borrado en `afterprint`.**

   **Dónde:** [conservación en memoria, línea 122](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:122), [impresión, línea 434](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:434) y criterio de T2.6b.

   **Escenario:** el profe cierra el diálogo de impresión sin obtener las hojas. La sección nueva exige conservar las tarjetas hasta cerrar la página para poder reimprimir; la sección de pantallas y T2.6b obligan a borrar sus secretos después de `afterprint`. Si el implementador cumple ese criterio, pierde la recuperación y debe esperar hasta quince minutos.

   **Propongo:** elegir una sola política y actualizar juntos comportamiento y criterios de T2.6b. Para sostener la mitigación elegida, conservar las tarjetas durante la vida de la página y borrarlas al cerrarla o mediante una acción explícita.

El estado de los nueve hallazgos abiertos queda así:

| Hallazgo | Estado en v5 | Evaluación |
|---|---|---|
| **F2C-4** | **Parcialmente cerrado** | Cierra la sobrescritura entre emisiones que respetan la reserva. La garantía completa conserva el camino de F2C-47. F2C-50 agrega una carrera de disponibilidad. |
| **F2C-7** | **Parcialmente cerrado** | `fail` no degrada `active`; falta proteger la marca de supresión frente al DML de F2C-48. |
| **F2C-24** | **Parcialmente cerrado** | El plazo anticipado y persistente resuelve al trabajador administrativo atrasado, sujeto a verificar la cota remota. Falta cubrir el escritor externo de F2C-47. |
| **F2C-25** | **Parcialmente cerrado** | Distingue borrado accidental de supresión y coordina las llamadas reservadas; la irreversibilidad de la supresión tiene el hueco de F2C-48. |
| **F2C-36** | **Cerrado en su defecto concreto** | La incertidumbre ya no libera la exclusión ni depende de una extensión posterior. F2C-49 es un problema nuevo de recuperación. |
| **F2C-43** | **Cerrado en el diseño** | Los quince minutos se guardan antes de llamar. El cierre depende de cumplir efectivamente la compuerta bloqueante de T2.5b. |
| **F2C-44** | **Cerrado en su defecto concreto** | Revocar una tarjeta pendiente ya no elimina la reserva por estudiante. |
| **F2C-45** | **Cerrado** | La regla explícita de `authAdmin()` completa el recorrido del timeout y exige probarlo. Conviene corregir la referencia vieja a `db/admin.ts` en la tabla de servicios. |
| **F2C-46** | **Cerrado** | Claim, remember y fail tienen variantes de éxito y rechazo declaradas. |

Las razones de los riesgos residuales **alcanzan** para exceptuar el alta de profesores: crea una cuenta exclusiva por correo y el perdedor no modifica la ganadora. También alcanza aceptar la ejecución manual sin corte en **local o staging**, manteniendo el requisito de ejecución acotada en producción.

La justificación temporal de quince minutos alcanza **como diseño condicionado a la verificación obligatoria** de la versión y configuración efectivas de Auth y de la cancelación de sus escrituras. No equivale a haber verificado ya esa garantía. La espera de quince minutos también es una decisión válida; F2C-51 y F2C-52 señalan contradicciones en cómo se ofrece su recuperación.

Mantengo las aceptaciones previas sobre cuentas huérfanas sin membresía, enumeración de staff, defensa de login directo y la excepción mínima de `session_alive`. Ninguna de ellas declara ni justifica las escrituras directas de credenciales de F2C-47.

**Veredicto: necesita otra ronda.**

### Qué se cambió

Versión 6: trigger en auth.users que impide al estudiante cambiar contraseña o correo fuera de una reserva, con el caso en vuelo aceptado porque solo se perjudica a sí mismo (F2C-47); deleted final (F2C-48); primero getUserById y recién con 404 createUser (F2C-49); begin_access_cards toma las reservas en su transacción y devuelve busy (F2C-50, F2C-51); nextCardAt en list_group_accounts y others con outcome y retryAt (F2C-51); las tarjetas quedan en memoria mientras la página está abierta (F2C-52); authAdmin en la tabla de servicios (F2C-45).

## Ronda 6

1. **F2C-53 · Alta — La guardia puede rechazar un login válido que recifra la contraseña.**

   **Dónde:** [guardia de `auth.users`](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:301) y criterios de T2.5a.

   **Escenario:** vence la reserva del estudiante. Supabase activa el cifrado de contraseñas almacenadas o rota su clave. El estudiante ingresa con la contraseña correcta; GoTrue la verifica y escribe una nueva representación en `encrypted_password`. El trigger exige una reserva y rechaza esa escritura: falla el login aunque nadie esté cambiando la contraseña. Ese recorrido existe en [ResourceOwnerPasswordGrant](https://github.com/supabase/auth/blob/master/internal/api/token.go) y [ReEncryptPassword](https://github.com/supabase/auth/blob/master/internal/models/user.go).

   Comparar `OLD` y `NEW` evita rechazar asignaciones sin cambios, pero **no resuelve el recifrado real**.

   **Cambio propuesto:** definir cómo convive la guardia con ese mantenimiento de Auth. Como mínimo, agregar una compuerta sobre la versión y configuración efectivas que bloquee el despliegue si ese recorrido puede ejecutarse y sigue siendo rechazado. Exigir pruebas de login y refresh sin reserva, incluyendo recifrado. No exceptuar globalmente a `supabase_auth_admin`: también ejecuta los cambios pedidos por estudiantes.

2. **F2C-54 · Alta — El nuevo control de credenciales no cubre la recreación mediante DML.**

   **Dónde:** [«Suprimir gana»](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:141), guardias de `deleted` y de `auth.users`, líneas 300–301.

   **Escenario:** la supresión deja el aprovisionamiento `deleted`, conserva su UUID y borra Auth. El dueño inserta una fila válida en `auth.users` con ese mismo UUID. No cambia el aprovisionamiento ni ejecuta ningún `UPDATE` de credenciales: ambas guardias nuevas quedan intactas y la cuenta suprimida vuelve a existir.

   También puede recrearse así una cuenta borrada accidentalmente, fuera de cualquier reserva. Son operaciones DML incluidas en el modelo solicitado; no requieren desactivar triggers ni otro DDL.

   **Cambio propuesto:** cubrir el nacimiento de una cuenta con UUID ya recordado: rechazarlo si el aprovisionamiento está `deleted` y exigir la reserva correspondiente en los estados recuperables. La comprobación debe coordinarse con `remember` y supresión bajo concurrencia. Agregar pruebas como dueño, incluyendo `DELETE` seguido de `INSERT`. La terminalidad de `deleted` por sí sola protege la fila de aprovisionamiento, no el nacimiento en Auth.

3. **F2C-55 · Baja — T2.5a conserva dos resultados incompatibles para la misma carrera.**

   **Dónde:** [criterios de T2.5a](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:574), frente al protocolo de `begin_access_cards`, líneas 151–152.

   **Escenario:** dos emisiones con **distintos `op_key`** solicitan al mismo estudiante. El protocolo nuevo exige que la segunda devuelva `busy`; el criterio todavía exige `card_issue_running` con `retryAt`. Un implementador puede cumplir una exigencia y fallar la otra.

   **Cambio propuesto:** separar los casos: reserva ajena con otra clave → `busy`; repetición del mismo `op_key` cuya emisión sigue ejecutándose → `CONFLICT card_issue_running`.

Respecto de **F2C-47**, la razón del riesgo aceptado **no alcanza tal como está escrita**. No cuestiono meramente que exista una petición en vuelo; cuestiono la afirmación de que solo puede perjudicar a su propio dueño.

El contrato ya contempla sesiones copiadas en computadoras compartidas. Con una de esas sesiones, un tercero puede iniciar el cambio de contraseña antes de la emisión y completarlo después de la rotación y revocación, mientras sigue vigente la reserva. La guardia lo permite. Después entra por colegio y usuario con la contraseña que eligió: `internal_resolve_student_login` resuelve el correo sintético nuevo por él. Rotar ese correo no impide recuperar acceso.

Propondría exigir una autorización verificable de la operación administrativa, además de la vigencia temporal. Si se decide aceptar este riesgo, debe declararse como **posible recuperación de acceso por quien copió una sesión**, y ajustar la garantía de emisión. La justificación actual de «solo autodaño» no describe ese impacto.

El estado de los hallazgos solicitados queda así:

| Hallazgo | Estado en v6 | Evaluación |
|---|---|---|
| **F2C-4** | **Parcialmente cerrado** | Serializa las emisiones administrativas. La garantía completa conserva el caso de sesión copiada explicado en F2C-47. |
| **F2C-7** | **Cerrado en su defecto concreto** | `fail` no degrada `active`; `deleted` es terminal y la supresión coordina los intentos reservados. |
| **F2C-24** | **Parcialmente cerrado** | Cierra el trabajador administrativo atrasado, condicionado a la compuerta temporal de T2.5b. La escritura pública conserva el caso de F2C-47. |
| **F2C-25** | **Cerrado para el recorrido de aprovisionamiento** | La reserva y la espera antes del borrado coordinan las llamadas del servicio. La recreación por DML queda señalada en F2C-54. |
| **F2C-47** | **Parcialmente cerrado** | Impide actualizar credenciales fuera de reserva, pero la justificación del caso permitido omite al tercero con sesión copiada. Además abre F2C-53/54. |
| **F2C-48** | **Cerrado** | La transición desde `deleted` queda prohibida también contra el dueño. |
| **F2C-49** | **Cerrado** | Consulta primero el UUID; crea solo ante 404 confirmado y conserva el tratamiento de incertidumbre. |
| **F2C-50** | **Cerrado en la carrera denunciada** | `begin` adquiere las reservas en su transacción. Queda corregir el criterio contradictorio de F2C-55. |
| **F2C-51** | **Cerrado en el contrato público** | `busy`, `others.outcome`, `retryAt` y `nextCardAt` permiten comunicar resultado y disponibilidad, también después de recargar. |
| **F2C-52** | **Cerrado** | Pantalla y ticket coinciden: memoria durante la página, reimpresión y borrado con «Listo» o al salir. |

El trigger en `auth.users` **sí es viable en Supabase**. Supabase permite expresamente crearlo, incluso con las restricciones actuales sobre esquemas administrados. Debe instalarse mediante una migración propia, sin cambiar la propiedad de `auth.users` ni tocar `auth.schema_migrations`. [Restricciones oficiales de Supabase](https://github.com/orgs/supabase/discussions/34270).

GoTrue opera como `supabase_auth_admin`, que no tiene por defecto acceso a las tablas privadas de la aplicación. Una función `SECURITY DEFINER` propiedad de `postgres`, con nombres calificados y `search_path = ''`, permite consultar la reserva sin abrir esas tablas al rol de Auth. [Guía oficial sobre permisos de triggers](https://supabase.com/kb/troubleshooting/dashboard-errors-when-managing-users-N1ls4A).

Un `UPDATE` limitado a `last_sign_in_at` no dispara `UPDATE OF encrypted_password, email`. Tampoco corresponde rechazar automáticamente un refresh por actualizar otra columna. Sin embargo, `UPDATE OF` se activa cuando esas columnas aparecen en el `SET`, aunque conserven su valor; hacen falta comparación de valores y pruebas contra el recorrido efectivo. Eso no elimina el problema de recifrado de F2C-53. [Semántica de PostgreSQL](https://www.postgresql.org/docs/current/sql-createtrigger.html).

Mantengo como suficientes las razones ya aceptadas para el alta exclusiva de profesores, la ejecución manual sin corte en local/staging y la conservación temporal de tarjetas en memoria. La justificación de quince minutos sigue siendo válida **condicionada a cumplir la verificación bloqueante de T2.5b**.

**Veredicto: necesita otra ronda.**

### Qué se cambió

Versión 7, un cambio de diseño: la contraseña del estudiante deja de vivir en Supabase Auth. Vive como hash scrypt en app.student_credentials y la verifica nuestro servidor; la sesión se abre con generateLink y verifyOtp del lado del servidor, sin correo. Emitir tarjetas es una sola transacción en la base, sin escrituras en Auth: desaparecen la reserva, los plazos, begin y finish, y los riesgos de escrituras atrasadas o inciertas sobre contraseñas (F2C-4, F2C-24, F2C-36, F2C-43, F2C-44, F2C-47, F2C-50, F2C-51). La cuenta de Auth del estudiante no tiene contraseña y un trigger impide ponérsela o cambiarle el correo, sin excepciones, así que no hay recifrado que rechazar (F2C-53) ni sesión copiada que se quede con una contraseña propia (F2C-47). Un trigger BEFORE INSERT con FOR SHARE impide que nazca la cuenta de un estudiante suprimido (F2C-54). El criterio contradictorio de T2.5a desaparece con begin (F2C-55). Sin contraseñas de estudiantes en Auth, el límite de intentos no tiene otra puerta: sale la cuenta señuelo de Auth y la rotación del correo.

## Ronda 7

1. **F2C-56 · Alta — Un login con la contraseña vieja puede abrir una sesión después de emitir la tarjeta nueva.**

   **Dónde:** [login del estudiante](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:114), emisión en la línea 158 y garantía de la línea 164.

   **Escenario:** A obtiene el hash viejo y verifica correctamente la contraseña. Se demora antes de `generateLink` o `verifyOtp`. B emite una tarjeta nueva: cambia el hash y borra todas las sesiones existentes. A continúa, completa `verifyOtp` y crea **una sesión nueva**, que `session_alive()` acepta. Quien conocía la contraseña anterior conserva acceso después de la rotación.

   El canje OTP crea la sesión sin conocer qué versión de `student_credentials` verificó nuestro servidor. [Recorrido de verificación de GoTrue](https://github.com/supabase/auth/blob/master/internal/api/verify.go).

   **Propongo:** incorporar una versión de credencial y una finalización del login coordinada con el mismo lock que usa la emisión. La sesión debe quedar autorizada únicamente si corresponde a la versión vigente; ninguna cookie debe entregarse antes de esa validación. Probar la carrera deteniendo A después de verificar scrypt y antes de crear la sesión.

2. **F2C-57 · Alta — El INSERT permite que una cuenta de estudiante nazca con contraseña o con otro correo.**

   **Dónde:** [guardia de nacimiento](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:141) y guardias de las líneas 301 y 302.

   **Escenario:** existe un UUID recordado con estado `pending`, `failed` o `active`, pero su cuenta de Auth todavía no existe o desapareció. El dueño inserta una fila válida de `auth.users` con ese UUID, una contraseña conocida y un correo elegido. El trigger de nacimiento solo rechaza `deleted`; el de actualización nunca interviene.

   La cuenta ya nace incumpliendo «nunca tiene contraseña». Emitir nuevas tarjetas tampoco elimina esa contraseña de Auth.

   **Propongo:** exigir en el nacimiento de una cuenta recordada una contraseña ausente y el correo sintético canónico. Cubrir también el orden inverso: recordar un UUID cuya fila de Auth ya existe. Probar ambos órdenes como dueño y comprobar que las cuentas de staff conservan su comportamiento.

3. **F2C-58 · Alta — Se puede recrear el UUID suprimido mediante UPDATE.**

   **Dónde:** [los dos triggers de Auth](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:300).

   **Escenario:** queda una marca `deleted` para el UUID X y Auth X ya fue borrado. El dueño inserta una fila técnica de Auth con otro UUID Y, sin referencias hijas, y ejecuta `UPDATE auth.users SET id = X WHERE id = Y`.

   No ocurre ningún INSERT de X. Tampoco cambia `email` ni `encrypted_password`. Ninguna de las condiciones contractuales rechaza la operación.

   **Propongo:** proteger las transiciones de identidad de `auth.users`, incluyendo el UUID de destino. La protección del UUID suprimido debe aplicarse también cuando una fila llega a él por UPDATE. Agregar la prueba como dueño.

4. **F2C-59 · Alta — La marca que impide renacer puede borrarse después de suprimir al estudiante.**

   **Dónde:** [terminalidad de `deleted`](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:299) y [guardia heredada `account_provisioning_kept`](/C:/Users/adrim/build101/.claude/worktrees/fase-1/supabase/migrations/20261113110000_t1_fix12.sql:44).

   **Escenario:** la supresión elimina al estudiante y deja `account_provisioning.student_id = NULL`, con estado `deleted`. La guardia heredada permite borrar esa fila porque el estudiante ya no existe. El dueño la borra y después inserta Auth con el UUID recordado: el trigger ya no encuentra la marca y permite nacer.

   Hacer terminal el estado protege UPDATE; no protege DELETE.

   **Propongo:** conservar la marca y el UUID contra DELETE mientras exista su institución, con una excepción explícita para la eliminación de esta. Probar DELETE seguido de INSERT de Auth, también concurrentemente.

5. **F2C-60 · Media — `generateLink(magiclink)` puede crear una segunda cuenta si desaparece la original.**

   **Dónde:** [apertura de sesión](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:117) y `magicLinkToken(email)` en la línea 386.

   **Escenario:** la RPC devuelve una cuenta activa, pero alguien borra Auth antes de `generateLink`. En el GoTrue consultado, `magiclink` para un correo inexistente cambia a `signup`, genera una contraseña aleatoria y crea un usuario con **otro UUID**. El trigger busca por el UUID nuevo, que no está recordado, y lo permite.

   El canje fijo como `magiclink` no corresponde al token de signup. Además queda ocupado el correo sintético necesario para recrear la identidad original. [Implementación de `adminGenerateLink`](https://github.com/supabase/auth/blob/master/internal/api/mail.go).

   **Propongo:** impedir en la base que un correo sintético nazca con un UUID diferente del que codifica y autoriza el aprovisionamiento. Validar además `data.user.id` y `verification_type` antes del canje. Un `getUserById` previo, por sí solo, conserva la carrera. Probar desaparición entre resolución y generación.

6. **F2C-61 · Media — Falta definir cómo se actualiza `student_credentials.issue_id`.**

   **Dónde:** [tabla de credenciales](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:261), pertenencia en la línea 295 y conservación en la línea 305.

   **Escenario:** al emitir la segunda tarjeta, el implementador actualiza el hash y apunta `issue_id` a la emisión nueva. La guardia lo rechaza porque declara ese campo inmutable. Borrar e insertar tampoco está permitido mientras exista el estudiante.

   Conservar el `issue_id` original permitiría renovar el hash, pero entonces ese campo identifica la primera emisión, aunque la credencial pertenezca a otra. El documento no elige esa semántica.

   **Propongo:** definir expresamente si referencia la emisión originaria o la vigente. Si es la vigente, permitir su transición bajo las condiciones de `issue_access_cards`; si es la originaria, documentarlo y nombrarlo en consecuencia.

7. **F2C-62 · Media — Los parámetros scrypt fallan con el límite de memoria predeterminado de Node.**

   **Dónde:** [formato scrypt](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:92), señuelo en la línea 83 y T2.5b.

   **Escenario:** se implementa `crypto.scrypt` con `N=32768`, `r=8`, `p=1` y las demás opciones predeterminadas. Reproduje en Node 24.20.0 `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` por exceder la memoria. Con `maxmem=64 MiB`, funciona. [Opciones oficiales de Node](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).

   **Propongo:** fijar `maxmem`, longitud de la clave derivada y validación estricta del formato, parámetros y longitudes decodificadas. Usar exactamente la misma configuración para el señuelo. Exigir además que coincidir con el señuelo nunca habilite el paso de apertura de sesión cuando los campos reales son nulos.

8. **F2C-63 · Media — La capacidad de login estudiantil no contempla el límite de `/verify`.**

   **Dónde:** [límites de Auth](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:81), `verifyOtp` en la línea 118 y T2.7.

   **Escenario:** varios estudiantes entran simultáneamente mediante el servidor y comparten su IP de salida. Pasan los contadores propios y scrypt, pero `/auth/v1/verify` aplica otro límite por IP. La documentación indica una ráfaga predeterminada de 30 verificaciones. El contrato solo prevé medir y ajustar `/token`, bajo el apartado de staff. [Límites oficiales de Auth](https://supabase.com/docs/guides/auth/rate-limits).

   **Propongo:** incluir `/verify` en la prueba de capacidad y configuración de T2.7, usando el cliente real de sesión. Definir el transporte de IP o el ajuste necesario y el tratamiento de 429. La política de envío de correos no resuelve este límite.

9. **F2C-64 · Baja — El resultado de aprovisionamiento incierto tiene dos clasificaciones.**

   **Dónde:** [paso inicial de emisión](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:153), frente a la salida de `issueAccessCards` en la línea 401 y T2.6b.

   **Escenario:** `createUser` queda incierto y el estudiante no llega a `active`. El protocolo exige devolverlo como `failed`; la definición del servicio y la pantalla contemplan `uncertain`. Dos implementadores pueden producir resultados distintos siguiendo el documento.

   **Propongo:** distinguir en ambos lugares el fallo confirmado de la incertidumbre de aprovisionamiento. Esta incertidumbre sigue siendo válida aunque hayan desaparecido las reservas de emisión.

El estado de los hallazgos solicitados queda así:

| Hallazgo | Estado en v7 |
|---|---|
| **F2C-4** | **Cerrado en su defecto concreto:** desaparece la sobrescritura tardía de contraseñas en Auth. La garantía de revocación conserva F2C-56. |
| **F2C-24** | **Cerrado en su defecto concreto:** emitir ya no depende de escrituras remotas de credenciales. |
| **F2C-47** | **Cerrado para el endpoint público y la sesión copiada.** La invariante general de cuenta sin contraseña conserva F2C-57. |
| **F2C-53** | **Cerrado en el diseño:** el recorrido estudiantil ya no verifica ni recifra una contraseña de Auth. |
| **F2C-54** | **Parcialmente cerrado:** el INSERT del UUID recordado queda coordinado con la supresión, pero permanecen F2C-58 y F2C-59. |
| **F2C-55** | **Cerrado:** desapareció el criterio contradictorio ligado a `begin`. |
| **F2C-36** | **Cerrado:** desaparece la escritura incierta de contraseña durante la emisión. |
| **F2C-43** | **Cerrado:** desaparece la extensión temporal posterior al error. |
| **F2C-44** | **Cerrado:** desaparece la exclusión dependiente de la tarjeta pendiente. |
| **F2C-50** | **Cerrado:** desaparece la separación entre `begin` y claim. |
| **F2C-51** | **Cerrado respecto de reservas y horas de reintento.** Queda la clasificación distinta señalada en F2C-64. |

Sobre las demás comprobaciones:

- **Tipos y correo:** el SDK admite `magiclink` tanto en `generateLink` como en `verifyOtp({token_hash})`. La generación administrativa construye el enlace sin enviarlo. Para una cuenta existente y confirmada, las rutas consultadas no exigen un proveedor de envío ni pasan por `requireEmailProvider`. Staff sí necesita mantener habilitado el proveedor email para entrar con contraseña. [Rutas de GoTrue](https://github.com/supabase/auth/blob/master/internal/api/api.go), [login con contraseña](https://github.com/supabase/auth/blob/master/internal/api/token.go).
- **Login y refresh:** en los recorridos consultados, la recuperación de una cuenta confirmada modifica tokens de recuperación; el refresh trabaja sobre sesiones y tokens. No encontré una reescritura de `email` o `encrypted_password` que reproduzca F2C-53 en el caso elegido. Conviene probar login y refresh contra la versión efectivamente desplegada. [Modelo de usuario](https://github.com/supabase/auth/blob/master/internal/models/user.go), [servicio de tokens](https://github.com/supabase/auth/blob/master/internal/tokens/service.go).
- **Logs:** no encontré un registro obligatorio del `hashed_token` en este flujo normal. El SDK trae `debug: false`, pero habilitarlo registra sesiones completas, con tokens, desde `_saveSession` y las notificaciones. GoTrue también puede registrar argumentos SQL con su configuración `all`. La prueba de fugas debe cubrir esos canales, además de `log.ts`. [SDK local](/C:/Users/adrim/build101/.claude/worktrees/fase-1/node_modules/@supabase/auth-js/src/GoTrueClient.ts:5289), [logging de GoTrue](https://github.com/supabase/auth/blob/master/internal/observability/logging.go).
- **Carrera INSERT/supresión:** `FOR SHARE` es adecuado para la fila recordada: entra en conflicto con el UPDATE de supresión y permite observar su resultado confirmado. El problema restante es cubrir todos los caminos y conservar esa fila. [Locks de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).
- **Hash e inventario:** el contrato restringe correctamente `internal_get_student_login` a `service_role`, excluye el hash de las proyecciones de usuario y asigna a T2.5a inventario, regla de supresión y cascada de `student_credentials`. No considero hallazgo que esos cambios todavía falten en los archivos que están migrándose.

No encontré exigencias residuales de reservas, leases, `begin/finish`, esperas de quince minutos ni rotación del correo sintético en el documento v7. Las rotaciones mencionadas corresponden a tokens de invitación. Las contradicciones que permanecen son las de **F2C-61** y **F2C-64**.

**Veredicto: necesita otra ronda.**

### Qué se cambió

Versión 8: versión de la credencial y internal_bind_student_session bajo el lock de la emisión, con verifyOtp en un cliente sin cookies y setSession recién después del bind (F2C-56); forma fija de las cuentas de estudiantes en auth.users para INSERT y UPDATE, incluido el id y el correo sintético con otro id (F2C-57, F2C-58, F2C-60); la marca deleted no se borra mientras exista la institución (F2C-59); issue_id vigente que cambia junto con el hash y la versión (F2C-61); parámetros de scrypt con maxmem y validación estricta (F2C-62); límites de /verify en T2.7 y 429 sin contar intento (F2C-63); uncertain contra failed al aprovisionar (F2C-64).

## Ronda 8

1. **F2C-65 · Alta — `createUser` sin contraseña no crea una cuenta sin contraseña.**

   **Dónde:** [aprovisionamiento, paso 3](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:150), frente al rechazo de `encrypted_password` en la línea 132.

   **Escenario:** se recuerda correctamente el UUID y el servicio llama a `auth.admin.createUser` omitiendo `password`. GoTrue **genera una contraseña aleatoria y calcula su hash** antes del INSERT. El trigger encuentra el UUID recordado y rechaza ese hash con P0004. Falla el primer aprovisionamiento de cada estudiante y también la recreación de una cuenta desaparecida.

   Este comportamiento está tanto en [GoTrue v2.186.0](https://raw.githubusercontent.com/supabase/auth/v2.186.0/internal/api/admin.go) como en el [código actual de `adminUserCreate`](https://github.com/supabase/auth/blob/master/internal/api/admin.go). Enviar `password: ""` tampoco lo evita.

   **Cambio propuesto:** definir un alta compatible con GoTrue. Una opción es que el `BEFORE INSERT`, después de validar la identidad estudiantil, **normalice incondicionalmente `NEW.encrypted_password` a NULL**; el UPDATE seguiría rechazando cualquier incorporación de contraseña. Eso exige cambiar expresamente el criterio de rechazo del INSERT. Si se quiere conservar ese rechazo, hace falta elegir otro mecanismo de alta, concretarlo y probarlo. Agregar una prueba contra Auth real que compruebe el valor persistido.

2. **F2C-66 · Alta — La “forma fija” todavía permite nacer con un correo externo.**

   **Dónde:** [condiciones de `student_auth_guard`](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:130).

   **Escenario:** existe un UUID X recordado, no suprimido y sin fila en Auth. El dueño inserta `auth.users` con X, sin contraseña y con `email = 'persona@dominio-real.example'`.

   Ninguna condición enumerada lo rechaza: el correo no es sintético, la contraseña está ausente y las otras dos condiciones corresponden a UPDATE. La cuenta nace incumpliendo el correo canónico; posteriormente tampoco puede corregirse por UPDATE. Este es un caso residual de **F2C-57**.

   **Cambio propuesto:** agregar la implicación que falta: **todo UUID recordado exige que el correo resultante sea exactamente `<id>@estudiantes.usetiza.app`**, también en INSERT. Rechazar NULL y cualquier otro dominio. Probarlo independientemente de la contraseña.

3. **F2C-67 · Alta — El orden inverso solo se controla dentro de la RPC y conserva una carrera.**

   **Dónde:** [“El otro orden”](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:137) y [reglas de `internal_remember_student_account`](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:377).

   **Escenario por DML:** existe una cuenta X con correo real y contraseña. Un estudiante pendiente todavía tiene `auth_user_id = NULL`. El dueño actualiza directamente `account_provisioning.auth_user_id = X`. No ejecuta `internal_remember_student_account`; tampoco modifica `auth.users`, por lo que sus triggers no intervienen. Las guardias heredadas permiten recordar el primer UUID y no comprueban esa forma.

   **Escenario concurrente:** incluso agregando esa comprobación al lado de `account_provisioning`, dos conexiones pueden eludir comprobaciones basadas solo en consultas: A inserta Auth X con contraseña sin confirmar; B recuerda X y no ve ese INSERT; A tampoco ve la asignación de B. Ambas confirman. `FOR SHARE` no coordina una fila que todavía no coincide con el UUID buscado. La visibilidad descrita corresponde a [Read Committed de PostgreSQL](https://www.postgresql.org/docs/current/transaction-iso.html).

   **Cambio propuesto:** exigir guardias en **ambos lados** de la relación, incluyendo INSERT/UPDATE directo de `account_provisioning`, y definir una exclusión común por UUID que cubra también la ausencia de fila. Probar ambos órdenes y la carrera con dos conexiones, bajo los niveles de aislamiento admitidos. El lock del estudiante dentro de la RPC no alcanza contra el INSERT directo de Auth.

4. **F2C-68 · Media — El protocolo de login omite la versión que necesita el bind.**

   **Dónde:** [paso 2 del login](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:115), frente a la firma de la RPC en la línea 382.

   **Escenario:** quien implementa el protocolo sigue la salida `{institutionFound, authUserId, passwordHash}`. Después debe llamar al bind con `p_version`, pero esa salida no la suministra. Quien sigue la tabla implementa otra forma. Además, la tabla conserva “los dos últimos” como campos condicionales: ahora serían `passwordHash` y `version`, dejando ambiguo `authUserId`.

   **Cambio propuesto:** fijar una sola salida `{institutionFound, authUserId, passwordHash, version}` y establecer que **los tres últimos** son NULL cuando no hay una cuenta elegible. La versión usada por el bind debe provenir de la misma lectura que devolvió el hash verificado.

5. **F2C-69 · Baja — La excepción del 429 no tiene una semántica definida en los contadores.**

   **Dónde:** [conteo previo obligatorio](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:71), frente a [429 de `/verify`](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:128).

   **Escenario:** un estudiante presenta la contraseña correcta, pero `/verify` devuelve 429 repetidamente. Cada intento ya incrementó las cuotas antes de scrypt. Tras diez respuestas puede quedar bloqueado durante quince minutos, aunque la pantalla le diga que pruebe en un minuto y el contrato indique “sin contar como intento fallido”. No existe un contador separado de fallos ni una operación de compensación.

   **Cambio propuesto:** elegir explícitamente si esos intentos consumen cuota. Si la consumen, aclararlo y devolver el plazo efectivo. Si se reintegran, definir una compensación atómica del intento concreto; borrar todas las claves con `clearSubject` también borraría intentos concurrentes ajenos.

El estado de los abiertos queda así, evaluando el **diseño contractual**, no la implementación todavía en curso:

| Hallazgo | Estado en v8 |
|---|---|
| **F2C-54** | **Cerrado** para el UUID ya recordado: lock con supresión, protección por UPDATE y conservación de la marca mientras exista la institución. |
| **F2C-56** | **Cerrado en el algoritmo** de versión y bind. Falta unificar su interfaz según F2C-68. |
| **F2C-57** | **Parcialmente cerrado**: persisten F2C-66 y F2C-67. |
| **F2C-58** | **Cerrado**: se protege el cambio de UUID, incluido el destino suprimido. |
| **F2C-59** | **Cerrado**: la marca sobrevive al estudiante mientras exista la institución. |
| **F2C-60** | **Cerrado**: el correo sintético con otro UUID se rechaza y se valida la respuesta administrativa. |
| **F2C-61** | **Cerrado**: `issue_id` identifica la emisión vigente y cambia junto con la versión. |
| **F2C-62** | **Cerrado**: parámetros, memoria, longitudes y señuelo quedan definidos. |
| **F2C-63** | **Cerrado respecto de capacidad y configuración de `/verify`**; queda precisar la excepción del 429 en F2C-69. |
| **F2C-64** | **Cerrado**: protocolo, servicio y pantalla distinguen `failed` de `uncertain`. |

Sobre **bind y `setSession`**: sí, `setSession` puede escribir cookies desde una Server Action. Lo comprobé con las versiones instaladas (`@supabase/ssr` 0.12.7 y `auth-js` 2.119.0), usando tokens ficticios y transporte simulado: ejecutó `GET /auth/v1/user` y después `cookies.setAll`. El SDK emite `SIGNED_IN` y SSR aplica el almacenamiento pendiente. Next permite escribir cookies en Server Functions. Véanse el [SDK instalado](/C:/Users/adrim/build101/.claude/worktrees/fase-1/node_modules/@supabase/ssr/src/createServerClient.ts:187) y la [guía local de cookies](/C:/Users/adrim/build101/.claude/worktrees/fase-1/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md).

No encontré una reapertura de F2C-56 en el intervalo **bind → setSession**: si la emisión ocurre ahí, elimina la sesión ya creada. `setSession` no vuelve a canjear el magiclink; si necesita refrescar, GoTrue rechaza una sesión ausente. [Recorrido de refresh](https://github.com/supabase/auth/blob/master/internal/tokens/service.go).

Sobre los **recorridos legítimos de GoTrue**, el bloqueo concreto es F2C-65. Para cuentas correctamente formadas y confirmadas, no encontré otro rechazo obligatorio en generateLink, verifyOtp o refresh: sus escrituras normales no cambian el correo ni la contraseña. Staff conserva sus recorridos mientras su UUID no quede indebidamente recordado, caso cubierto por F2C-67. El borrado **duro** es compatible; el borrado **lógico** de Auth modifica el correo y sería rechazado, por lo que conviene fijar expresamente que la supresión usa `deleteUser(..., false)`. [Implementación del borrado](https://github.com/supabase/auth/blob/master/internal/api/admin.go).

No ejecuté integración contra GoTrue local porque Docker no fue accesible; la comprobación de cookies fue simulada y las conclusiones sobre GoTrue se apoyan en su código oficial.

**Veredicto: necesita otra ronda.**

### Qué se cambió

Versión 9: el INSERT de una cuenta recordada pone encrypted_password en NULL en vez de rechazarla, con prueba contra el Auth local (F2C-65); correo canónico obligatorio para todo id recordado, también en INSERT (F2C-66); trigger en account_provisioning y advisory lock común por id en los dos lados, con 40001 fuera de READ COMMITTED (F2C-67); salida única de internal_get_student_login con version (F2C-68); un 429 de /verify con la contraseña bien limpia el sujeto (F2C-69); supresión con borrado duro en Auth.

## Ronda 9

1. **F2C-70 · Media — Falta fijar el orden entre el advisory lock y `FOR SHARE`.**

   **Dónde:** [locks comunes, línea 138](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:138) y [guardia de nacimiento, línea 163](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:163).

   **Escenario:** X ya está recordado y su cuenta de Auth falta. Si el INSERT de Auth ejecuta primero la guardia que toma el advisory, puede ocurrir:
   - A toma el advisory de X.
   - B ejecuta `UPDATE account_provisioning SET auth_user_id = auth_user_id`: bloquea la fila y su trigger espera el advisory.
   - A llega al `FOR SHARE` y espera esa fila.

   Hay un interbloqueo. El contrato no fija el orden de ejecución de las dos guardias de Auth; PostgreSQL lo determina por **nombre del trigger**, no por nombre de función ni orden de creación. No afirmo que toda implementación vaya a caer: falta excluir contractualmente esta implementación. [Orden de triggers](https://www.postgresql.org/docs/17/trigger-definition.html).

   **Cambio propuesto:** fijar el orden completo, incluidos los locks de fila anteriores al trigger. Para la fila recordada existente, ejecutar su `FOR SHARE` antes del advisory de Auth, y conservar la comprobación de forma posterior al advisory. Establecer los nombres que garantizan ese orden y probar el escenario anterior con dos conexiones.

2. **F2C-71 · Baja — El chequeo previo de `remember` todavía puede terminar en P0004 en vez de `{ok:false}`.**

   **Dónde:** [“El otro orden”, línea 145](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:145).

   **Escenario:** `internal_remember_student_account` comprueba que Auth X no existe. Antes de que su UPDATE llegue al trigger, otra transacción inserta Auth X con correo externo y contraseña, y confirma. Como X todavía no estaba recordado, ese INSERT es válido. El trigger de aprovisionamiento adquiere después el advisory, encuentra la cuenta incompatible y levanta P0004.

   La integridad queda protegida, pero no se cumple la respuesta contractual `{ok:false}` “antes de llegar al trigger”.

   **Cambio propuesto:** exigir que la RPC adquiera la misma exclusión antes de su comprobación previa, siguiendo el orden resuelto en F2C-70. Mantener P0004 para el DML directo y probar que esta carrera mediante la RPC devuelve `{ok:false}`.

3. **F2C-72 · Media — La recuperación prometida para una cuenta `active` desaparecida no tiene un recorrido definido.**

   **Dónde:** [recreación, línea 169](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:169), [selector de reconciliación, línea 387](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:387) y [servicio, línea 431](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:431).

   **Escenario:** se borra manualmente Auth de un estudiante cuyo aprovisionamiento sigue `active`. `reconcile` lo excluye porque solo selecciona `pending` y `failed`. Emitir tarjetas tampoco exige comprobar Auth para cada cuenta `active`: permite interpretar “aprovisionar a quien le falte” según ese estado. El estudiante puede quedar sin poder entrar y sin recuperación mediante el comando previsto.

   **Cambio propuesto:** incluir expresamente en la reconciliación las filas `active` cuyo UUID recordado falta en `auth.users`, y exigir su recreación con ese mismo UUID. Probarlo mediante `admin:reconcile`.

4. **F2C-73 · Media — La cascada del grupo contradice la conservación de la credencial.**

   **Dónde:** [FK de emisiones al grupo, línea 263](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:263), [FK de credenciales a emisiones, línea 297](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:297) y [guardia de conservación, línea 332](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:332).

   **Escenario:** un estudiante pertenece a A y B; su credencial vigente proviene de una emisión de A. El dueño borra A, conservando al estudiante. La cascada intenta borrar emisión y credencial, pero la guardia prohíbe borrar esta última mientras exista el estudiante. O se rechaza la eliminación que el documento contempla por cascada, o se debilita esa conservación. Los triggers también se ejecutan durante las cascadas. [Comportamiento de PostgreSQL](https://www.postgresql.org/docs/17/trigger-definition.html).

   **Cambio propuesto:** definir expresamente que un grupo con emisiones referenciadas por credenciales solo se archiva, y alinear la regla de memoria y las pruebas con esa prohibición de DELETE. Si debe poder eliminarse, habrá que conservar la emisión y desacoplarla de esa cascada.

El estado de los abiertos solicitados es:

| Hallazgo | Estado en v9 |
|---|---|
| **F2C-57** | **Cerrado respecto de la forma fija:** no encontré una secuencia admitida que confirme correo no canónico o contraseña persistida. |
| **F2C-65** | **Cerrado en el diseño:** normalizar el INSERT a NULL evita el rechazo anterior. |
| **F2C-66** | **Cerrado:** exige correo canónico para todo UUID recordado, incluido INSERT y NULL. |
| **F2C-67** | **Cerrado para integridad concurrente.** Quedan los problemas de orden y respuesta de F2C-70/71. |
| **F2C-68** | **Cerrado:** salida única y versión tomada de la misma lectura del hash. |
| **F2C-69** | **Cerrado:** el 429 cuenta como acierto; el ajuste de `clearSubject` aporta la IP para limpiar también el par. |

Sobre **GoTrue y el NULL**: no encontré una incompatibilidad nueva en el código consultado. Después de crear el usuario, el alta actualiza rol, metadatos y confirmación mediante escrituras parciales; esas operaciones no vuelven a guardar `encrypted_password`. La autenticación contempla expresamente una contraseña NULL. Esto respalda el cambio, aunque la prueba contra Auth local sigue siendo necesaria. [Alta administrativa](https://raw.githubusercontent.com/supabase/auth/v2.186.0/internal/api/admin.go), [modelo de usuario](https://raw.githubusercontent.com/supabase/auth/v2.186.0/internal/models/user.go).

No ejecuté integración: Docker no fue accesible en esta sesión.

**Veredicto: necesita otra ronda.**

### Qué se cambió

Versión 10: un solo trigger en auth.users que toma la fila de account_provisioning FOR SHARE antes del advisory, y el mismo orden en el trigger de account_provisioning y en remember (F2C-70, F2C-71); reconcile recrea las cuentas active que faltan en Auth (F2C-72); un grupo con emisiones no se borra, se archiva, con FK NO ACTION (F2C-73).

## Ronda 10

1. **F2C-74 · Alta · Bloqueante — Una asignación recién confirmada puede quedar sin el `FOR SHARE` que necesita la supresión.**

   **Dónde:** [orden de locks, línea 139](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:139) y [supresión, línea 165](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:165).

   **Escenario:**

   - B recuerda X en una fila cuyo `auth_user_id` era NULL. Tiene la fila y el advisory de X, sin confirmar.
   - A empieza un INSERT de Auth con X y su correo canónico. Su primer `FOR SHARE WHERE auth_user_id = X` no encuentra la asignación sin confirmar; por tanto, no bloquea esa fila. Después espera el advisory.
   - B confirma. A obtiene el advisory y sus consultas siguientes encuentran X recordado y no suprimido. Permite el INSERT, normalizando la contraseña a NULL.
   - A deja su transacción abierta. C marca el aprovisionamiento `deleted`: puede hacerlo porque A nunca tomó el lock de esa fila. C intenta borrar Auth X, todavía invisible por estar sin confirmar, y termina.
   - A confirma: queda una cuenta de Auth nacida después de la supresión.

   El advisory coordina el nacimiento con **recordar**, pero la supresión que solo actualiza `status` no toma ese advisory. La lectura posterior no adquiere retroactivamente el lock omitido. Es una consecuencia de las [reglas de visibilidad de READ COMMITTED](https://www.postgresql.org/docs/17/transaction-iso.html).

   **Cambio propuesto:** exigir que toda fila usada para autorizar el nacimiento esté efectivamente bloqueada hasta el commit. Una solución compatible con el orden elegido es comprobar, después del advisory, que las filas encontradas coincidan con las bloqueadas inicialmente; si apareció una asignación nueva, abortar con `40001` y reintentar la transacción completa. **Volver a tomar `FOR SHARE` después del advisory sin más reintroduciría F2C-70.** Agregar la carrera de tres conexiones.

2. **F2C-75 · Alta · Bloqueante — El OTP público permite abrir una sesión estudiantil sin pasar por scrypt ni por el bind.**

   **Dónde:** [«Estudiantes: no hay otra puerta»](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:81), [apertura y bind](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:119) y [criterio de sesión viva](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:349).

   **Escenario:** un atacante conoce el correo sintético por una sesión copiada. Un login legítimo genera el magiclink, pero `/verify` devuelve 429 o el proceso cae antes del canje. Queda un token vigente.

   En GoTrue consultado, tanto v2.186.0 como `master`, `generateLink` obtiene ese token de un OTP numérico mediante `GenerateOtp(config.Mailer.OtpLength)`; la configuración commiteada usa **seis dígitos y una hora**. El atacante puede probar códigos directamente en `/auth/v1/verify`, repartiendo los intentos entre IPs. Esos intentos no consumen el límite por sujeto de Tiza. Si acierta, Auth entrega una sesión que nunca pasó por `internal_bind_student_session`, pero que `session_alive()` acepta por existir en `auth.sessions`. Véanse [generación del token](https://github.com/supabase/auth/blob/master/internal/api/mail.go), [canje público](https://github.com/supabase/auth/blob/master/internal/api/verify.go) y [límites de verificación por IP](https://supabase.com/docs/guides/auth/rate-limits).

   Esto no equivale a adivinar un secreto aleatorio de 256 bits: el hash conserva el espacio de búsqueda del OTP.

   **Cambio propuesto:** convertir el bind en una condición persistente de acceso estudiantil. Registrar las sesiones habilitadas exclusivamente por el servidor después de verificar scrypt y exigir ese registro en las RPC, vinculado al usuario y a la versión vigente. Una sesión obtenida directamente de Auth debe carecer de acceso a datos. Esto requiere definir almacenamiento, guardias y responsabilidades antes de repartir. Aumentar solamente el límite de `/verify` para soportar al colegio agrava este camino.

3. **F2C-76 · Media · Resoluble en T2.5b — `provisionStudent(provisioningId)` no recibe la identidad necesaria para completar el recorrido.**

   **Dónde:** [RPC de cuentas](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:388) y [firma del servicio](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:423).

   **Escenario:** la primera emisión llama a `provisionStudent` con el id de aprovisionamiento. El paso 1 consulta `internal_get_student_accounts`, que recibe **ids de estudiantes**. Al terminar, `internal_link_student_user` también necesita el id del estudiante. La firma no lo entrega y no hay una búsqueda acotada por `provisioningId` definida para obtenerlo.

   **Cambio propuesto:** pasar `studentId` y `provisioningId`, o recibir `studentId` y resolver su aprovisionamiento con la RPC existente. Los llamadores ya conocen ambos datos. Es un ajuste de interfaz local a T2.5b; no necesita otra decisión de arquitectura ni una RPC global de búsqueda.

4. **F2C-77 · Media · Resoluble en T2.5b — La autorización aparece después de los primeros efectos privilegiados.**

   **Dónde:** [emisión, pasos 1 y 3](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:178).

   **Escenario:** un pedido manipulado incluye estudiantes de otro grupo o institución. Siguiendo literalmente la secuencia, el servicio consulta las RPC internas y aprovisiona sus cuentas antes de que `issue_access_cards` rechace el pedido. No obtiene tarjetas, pero ya produjo altas y vínculos con `service_role` sin autorización del actor sobre esos estudiantes.

   **Cambio propuesto:** antes de aprovisionar, llamar con la sesión a `list_group_accounts` y exigir que todos los ids solicitados pertenezcan al conjunto autorizado. Si alguno no corresponde, terminar antes de invocar los servicios admin. La emisión mantiene su autorización final. La RPC y los archivos necesarios ya están dentro del alcance de T2.5b; agregar una prueba que compruebe **cero llamadas administrativas** ante un pedido ajeno.

El estado de los abiertos queda así:

| Hallazgo | Estado en v10 |
|---|---|
| **F2C-70** | **Cerrado para el interbloqueo denunciado:** fila antes del advisory y un único trigger de Auth. La fila que aparece después abre F2C-74. |
| **F2C-71** | **Cerrado:** `remember` toma la exclusión antes de comprobar; el caso incompatible devuelve `{ok:false}`. |
| **F2C-72** | **Cerrado:** selector y servicio incluyen expresamente cuentas `active` ausentes de Auth y conservan el UUID. |
| **F2C-73** | **Cerrado:** FK `NO ACTION` y conservación de emisiones alineadas con archivar el grupo. |
| **F2C-54** | **Reabierto parcialmente por F2C-74:** permanece el nacimiento tardío cuando el primer lock no vio la asignación. |
| **F2C-11 / F2C-27** | **Reabiertos respecto del acceso directo por OTP**, según F2C-75. La prueba de contraseñas contra `/token` sí queda eliminada. |
| **F2C-65 a F2C-69** | Mantienen su cierre contractual. |

En la pasada completa no encontré otro bloqueo de diseño. Las referencias residuales a «dos triggers en `auth.users`» —líneas 330 y 611— se pueden corregir en la revisión del ticket: el algoritmo principal define inequívocamente uno solo.

No ejecuté integración: el acceso a Docker está denegado. Las carreras descritas son análisis del protocolo contractual; las conclusiones sobre OTP están contrastadas con el código oficial de Auth.

**Veredicto: necesita otra ronda.**

### Qué se cambió

Versión 11: el trigger de account_provisioning toma el advisory también cuando cambia el status, así marcar deleted espera a un INSERT en Auth sin confirmar (F2C-74); app.student_sessions registra las sesiones que abrió el servidor y session_alive las exige para cuentas de estudiante, así una sesión obtenida adivinando el OTP de un magic link no lee nada (F2C-75); provisionStudent recibe studentId (F2C-76); issueAccessCards autoriza con list_group_accounts antes de cualquier llamada admin (F2C-77).

## Ronda 11

1. **F2C-78 · Alta — El registro estudiantil puede sobrevivir al cierre de sesión y habilitar su resurrección por DML.**

   **Dónde:** [garantía de revocación](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:64), [tabla `student_sessions`](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:307) y [criterio de `session_alive`](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:362).

   **Escenario:** el estudiante tiene una sesión S registrada con la versión vigente. Sale: Auth elimina S de `auth.sessions`, pero el contrato no elimina su registro en `student_sessions`: no hay FK hacia Auth ni limpieza vinculada a ese DELETE. El dueño reinserta mediante DML la fila de Auth con el mismo UUID. Una copia del access token anterior, todavía sin vencer, vuelve a cumplir ambas condiciones de `session_alive`: existe S y conserva un registro con versión vigente. No necesita otro bind. Las guardias de `auth.users` no intervienen.

   Esto entra en el modelo de amenazas indicado y reabre parcialmente **F2C-9**.

   **Cambio propuesto:** vincular `student_sessions.session_id` con `auth.sessions(id)` mediante FK `ON DELETE CASCADE`, o una guardia equivalente que retire el registro en toda eliminación de la sesión. Incluir logout, revocación administrativa y borrado de cuenta. Probar como dueño: registrar, salir, restaurar solamente la fila de Auth y comprobar que el JWT viejo sigue rechazado.

2. **F2C-79 · Media — La autorización previa permite leer cuentas sandbox, pero eso no autoriza aprovisionarlas.**

   **Dónde:** [preautorización de la emisión](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:179), [permisos de las RPC](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:399) y [matriz contractual](C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/domain/permissions/matrix.ts:133).

   **Escenario:** el visitante de un sandbox pide tarjetas para estudiantes de su propio grupo. `list_group_accounts` está permitido para `sandbox_anonymous`, mientras que `issue_access_cards` está expresamente prohibido. La comprobación previa puede pasar, pero el servicio empieza el aprovisionamiento antes del rechazo final. Su algoritmo solo exige detenerse ante `deleted`; no contempla `not_applicable`, que la fase 1 usa precisamente para impedir cuentas reales en sandboxes.

   Además, falta definir cómo representa esa lectura las filas `not_applicable`, porque su salida solo admite `pending`, `active` y `failed`.

   **Cambio propuesto:** hacer que la preautorización devuelva una decisión de emisión calculada por la base —por ejemplo, `canIssueCards`— y exigirla antes de cualquier llamada administrativa. Definir la representación del sandbox y hacer que `provisionStudent` descarte `not_applicable` antes de llamar a Auth. Agregar el caso sandbox a la prueba de **cero llamadas administrativas**. Es un cierre pendiente de **F2C-77**.

3. **F2C-80 · Media — El cliente permitido no expone el método necesario para canjear el magic link.**

   **Dónde:** [fábrica del cliente](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:419) y [`exchangeMagicLink`](C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:431).

   **Escenario:** T2.7 entrega `authAdmin()`, definido como `auth.admin`, y el contrato obliga a `auth-users.ts` a usar exclusivamente esa interfaz. T2.3 debe implementar allí `exchangeMagicLink` mediante `verifyOtp`, pero ese método pertenece a `auth`, no a `auth.admin`. El implementador debe incumplir la restricción o pedir un cambio fuera de su alcance. La [API oficial de `verifyOtp`](https://supabase.com/docs/reference/javascript/auth-verifyotp) confirma esa ubicación.

   **Cambio propuesto:** asignar a T2.7 una fábrica adicional para el cliente de canje, nuevo por operación, sin cookies, con `persistSession: false`, `autoRefreshToken: false`, `debug: false` y el mismo timeout de cinco segundos. Autorizar expresamente su uso en T2.3 y probar también el timeout del canje.

El estado de los abiertos queda así:

| Hallazgo | Estado en v11 |
|---|---|
| **F2C-74** | **Cerrado para la carrera denunciada:** cambiar `status` toma el advisory; la supresión espera al INSERT y después puede borrarlo. |
| **F2C-75** | **Cerrado para el OTP directo:** una sesión nueva sin registro no accede a las RPC. F2C-78 señala otro problema de ciclo de vida. |
| **F2C-76** | **Cerrado:** `provisionStudent` recibe `studentId` y `provisioningId`. |
| **F2C-77** | **Parcialmente cerrado:** rechaza estudiantes ajenos antes de las llamadas admin; falta el caso sandbox de F2C-79. |
| **F2C-11 / F2C-27** | **Cerrados respecto del bypass estudiantil por Auth:** no hay contraseña en Auth y el OTP directo no obtiene registro. |
| **F2C-54** | **Cerrado para el nacimiento tardío denunciado:** se mantienen la marca y la exclusión con supresión. |
| **F2C-9** | **Reabierto parcialmente** por F2C-78 para logout seguido de restauración mediante DML. |

Sobre el **refresh**: **sí, conserva el `session_id`** en el código oficial consultado. GoTrue genera el nuevo JWT pasando `&session.ID`; cambia los tokens, pero mantiene la sesión. Por tanto, el registro válido sobrevive al refresh y una sesión sin registro continúa bloqueada. No hace falta repetir el bind. Conviene exigir una integración que compruebe ambos casos y la revocación después del refresh. [Código oficial de GoTrue v2.186.0](https://github.com/supabase/auth/blob/v2.186.0/internal/tokens/service.go#L531-L535).

En la pasada completa no encontré otro bloqueo contractual adicional.

**Veredicto: necesita otra ronda.**

### Qué se cambió

Versión 12: student_sessions con FK a auth.sessions on delete cascade (F2C-78); canIssueCards y accountStatus none en list_group_accounts, exigidos antes de cualquier llamada admin (F2C-79); otpExchangeClient en repos/admin/db.ts para el canje del magic link, a cargo de T2.3 (F2C-80).

## Ronda 12

1. **F2C-81 · Alta — La revocación sigue siendo reversible mediante DML.**

   **Dónde:** [sesión vigente, línea 62](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:62), [FK nueva, línea 310](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:310) y [guardias del registro, línea 350](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:350).

   **Escenario:** un profe sale y Auth borra su sesión S. El dueño reinserta S con el mismo usuario. Su JWT anterior, todavía vigente, vuelve a pasar `session_alive()`: para staff alcanza con que exista S.

   Para estudiantes, la FK corrige el escenario exacto de F2C-78: restaurar **solo** `auth.sessions` ya no alcanza. Pero el dueño puede restaurar también el registro eliminado de `student_sessions`: S existe y la credencial conserva su versión. Cumple las condiciones de inserción enumeradas. «Solo escribe el bind» no tiene definido un mecanismo que lo garantice frente al DML del dueño.

   **Cambio propuesto:** conservar memoria de los identificadores de sesión revocados y rechazar su reutilización, tanto en Auth como en el registro estudiantil. Proteger esa memoria frente a modificación, borrado, TRUNCATE y carreras; conservarla al menos mientras pueda existir un JWT correspondiente vigente. Cubrir también cambios de identificador para que no eludan la memoria. Probar restauración de staff y restauración de ambas filas estudiantiles.

2. **F2C-82 · Alta — La FK acredita existencia, pero falta vincular la sesión con su usuario.**

   **Dónde:** [bind, línea 120](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:120), [registro, línea 350](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:350) y [criterio de sesión viva, línea 364](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:364).

   **Escenario:** S es una sesión registrada del estudiante A. El dueño cambia `auth.sessions.user_id` a B, otra cuenta existente. La FK por `id` permanece satisfecha y el registro estudiantil no cambia. Después, `internal_revoke_user_sessions(A)` no encuentra S y no la borra. El JWT de A conserva S y, según las condiciones escritas, sigue pasando: la sesión existe y su registro tiene la versión vigente de A.

   **Cambio propuesto:** exigir explícitamente toda la correspondencia: `JWT.sub = auth.sessions.user_id = cuenta vinculada al estudiante registrado`. El bind y la guardia de inserción deben comprobar esa misma identidad. Proteger también el cambio de titular en `auth.sessions`, o invalidar su registro cuando ocurra, con coordinación concurrente. Agregar la prueba anterior como dueño.

   Una FK solo garantiza la relación entre las columnas que referencia; aquí no incluye al titular. [Restricciones de PostgreSQL](https://www.postgresql.org/docs/17/ddl-constraints.html).

3. **F2C-83 · Baja — `accountStatus: none` describe incorrectamente el sandbox existente.**

   **Dónde:** [salida de `list_group_accounts`, línea 401](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2.md:401), frente a [fase 1, línea 201](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-1.md:201).

   **Escenario:** `create_student` en un sandbox conserva una fila de aprovisionamiento con estado `not_applicable`. La v12 define `none` como «sin fila de aprovisionamiento: un sandbox». Al consultar ese estudiante hay una fila, pero su estado no pertenece al enum de salida. La proyección contractual queda incompleta.

   **Cambio propuesto:** definir expresamente `not_applicable → accountStatus: none`. Distinguir una ausencia inesperada de aprovisionamiento en una escuela. Mantener `canIssueCards: false` y el descarte previo a Auth, que sí están correctamente exigidos.

El estado de los abiertos queda así:

| Hallazgo | Estado en v12 |
|---|---|
| **F2C-78** | **Cerrado para su escenario exacto:** la cascada elimina el registro y restaurar solo Auth no lo recupera. La garantía general conserva F2C-81. |
| **F2C-79** | **Cerrado en autorización y efectos privilegiados:** exige `canIssueCards` y descarta `not_applicable` antes de Auth. Queda la representación de F2C-83. |
| **F2C-80** | **Cerrado:** fábrica adicional, configuración, timeout y alcance de T2.3 explícitos. |
| **F2C-9** | **Parcialmente cerrado:** funciona la revocación ordinaria; bajo el modelo de DML indicado permanecen F2C-81 y F2C-82. |
| **F2C-77** | **Cerrado en la preautorización**, incluido sandbox. |
| **F2C-75 / F2C-11 / F2C-27** | Mantienen el cierre del bypass público: un OTP directo sin registro no obtiene acceso. |

La FK nueva **no exige conceder acceso general a `app` al rol de Auth**: PostgreSQL ejecuta la cascada con los derechos del dueño de la tabla referenciante. [Implementación de integridad referencial](https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/utils/adt/ri_triggers.c). También extiende la protección contra TRUNCATE: sin incluir la tabla hija se rechaza por la FK; con `CASCADE`, interviene su `no_truncate`. [Semántica de TRUNCATE](https://www.postgresql.org/docs/17/sql-truncate.html).

La reactivación de la guardia de enlace en toda la suite está asignada expresamente a T2.5a. No considero su estado actual un hallazgo contractual adicional. En la pasada completa no encontré otro bloqueo distinto de los anteriores.

**Veredicto: necesita otra ronda.**

### Qué se cambió

Versión 13: app.revoked_sessions con un trigger AFTER DELETE en auth.sessions, y rechazo de un id revocado al insertar en auth.sessions y en student_sessions (F2C-81); id y user_id de auth.sessions no cambian, y session_alive exige user_id = sub y el registro del mismo estudiante (F2C-82); not_applicable se muestra como none (F2C-83). Lo implementa T2.5a.
