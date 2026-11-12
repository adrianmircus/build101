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
