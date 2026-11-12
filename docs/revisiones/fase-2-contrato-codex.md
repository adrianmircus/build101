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
