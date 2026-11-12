# Revisión de cierre de la fase 2 (Codex)

## Ronda 1

1. **F2-1 — Alta — Se puede habilitar una sesión sin pasar por el bind.**  
   **Dónde:** [guardia de student_sessions:24](/C:/Users/adrim/build101/.claude/worktrees/fase-1/supabase/migrations/20261114130000_t2_5a_student_accounts.sql:24), [prueba que permite el INSERT:372](/C:/Users/adrim/build101/.claude/worktrees/fase-1/supabase/tests/040_f2_contract.test.sql:372).  
   **Escenario:** una sesión obtenida mediante `verifyOtp` directo inicialmente no lee datos. El dueño inserta su registro en `app.student_sessions` con el estudiante y la versión vigentes; la guardia lo acepta y `session_alive()` habilita esa sesión. No necesita escribir en `auth.sessions`: alcanza con DML sobre una tabla de app, incluido en el modelo.  
   **Cambiaría:** hacer efectiva la exclusividad del bind como escritor, además de validar la versión. Agregaría esta prueba como dueño, esperando rechazo.

2. **F2-2 — Alta — El DML directo puede instalar una contraseña elegida.**  
   **Dónde:** [student_credentials_frozen:189](/C:/Users/adrim/build101/.claude/worktrees/fase-1/supabase/migrations/20261114100000_f2_contract.sql:189), [control positivo:347](/C:/Users/adrim/build101/.claude/worktrees/fase-1/supabase/tests/040_f2_contract.test.sql:347).  
   **Escenario:** el dueño actualiza `password_hash`, cambia `issue_id` y aumenta `version` en uno. La guardia acepta un hash de una contraseña conocida sin ejecutar `issue_access_cards`. Después puede entrar por el login normal. Tampoco se ejecutan la rotación de tarjetas, el cierre de sesiones ni la auditoría de emisión. Contradice que la credencial solo se escribe dentro de esa RPC.  
   **Cambiaría:** restringir efectivamente ese escritor y probar que un UPDATE directo con forma válida también se rechaza.

3. **F2-3 — Alta — Las API de IA aceptan sesiones revocadas y cuentas sin membresía.**  
   **Dónde:** [proxy.ts:30](/C:/Users/adrim/build101/.claude/worktrees/fase-1/proxy.ts:30), [clasificación por correo:23](/C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/server/auth/session-proxy.ts:23), [generate:41](/C:/Users/adrim/build101/.claude/worktrees/fase-1/app/api/generate/route.ts:41).  
   **Escenario:** el proxy deja pasar cualquier claim clasificado como staff. Una cookie copiada antes del logout conserva un JWT firmado hasta su vencimiento; también pasa una cuenta de Auth sin membresías, como la que deja un alta interrumpida. Las rutas de IA restantes no llaman a `getActor()` ni verifican permisos antes de gastar.  
   **Cambiaría:** exigir autorización real dentro de cada entrada o servicio de IA y probar ambos casos antes de invocar al proveedor.

4. **F2-4 — Alta — Las contraseñas de las tarjetas sobreviven a salir de la pantalla.**  
   **Dónde:** [AccessCardsScreen.tsx:35](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/access-cards/AccessCardsScreen.tsx:35), [limpieza:40](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/access-cards/AccessCardsScreen.tsx:40).  
   **Escenario:** después de emitir, el usuario sigue un enlace interno y vuelve. `pagehide` no se dispara en esa navegación. Con Cache Components, Next conserva el estado mediante Activity, según la [guía local:982](/C:/Users/adrim/build101/.claude/worktrees/fase-1/node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md:982). Las tarjetas quedan retenidas y el efecto de impresión puede ejecutarse otra vez al volver.  
   **Cambiaría:** borrar los secretos al desactivar la pantalla, descartar respuestas pendientes que lleguen después y evitar imprimir por la mera reactivación del efecto. Probaría navegación interna y regreso.

5. **F2-5 — Media — Una sesión revocada puede dejar al usuario atrapado en redirecciones.**  
   **Dónde:** [proxy.ts:53](/C:/Users/adrim/build101/.claude/worktrees/fase-1/proxy.ts:53), [getActor:30](/C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/server/auth/actor.ts:30), [requireViewer:15](/C:/Users/adrim/build101/.claude/worktrees/fase-1/app/estudiante/viewer.ts:15).  
   **Escenario:** emitir una tarjeta elimina la sesión del estudiante, pero su navegador conserva el JWT vigente. `/estudiante` lo manda al login porque la base rechaza la sesión; el proxy del login lo devuelve a `/estudiante` por sus claims. También ocurre con staff sin actor válido. El estudiante no consigue escribir la contraseña nueva.  
   **Cambiaría:** resolver o limpiar la sesión inválida antes de redirigir desde el login. Agregaría un recorrido de navegador con una tarjeta emitida mientras la sesión anterior sigue abierta.

6. **F2-6 — Media — Perder la respuesta de creación del grupo permite duplicarlo.**  
   **Dónde:** [createSteps.ts:38](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/institution/createSteps.ts:38), [useCreateFlow.ts:46](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/institution/useCreateFlow.ts:46), [prueba:56](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/institution/createSteps.test.ts:56).  
   **Escenario:** `create_group` confirma y se pierde su respuesta. La clave se conserva únicamente cuando llega un resultado exitoso; el reintento genera otra y crea un segundo grupo. La prueba titulada «el reintento usa la misma clave» la extrae del mock y la introduce manualmente, cosa que el flujo real no hace.  
   **Cambiaría:** guardar el intento antes del pedido y mantenerlo ante una respuesta incierta. Probaría el hook completo con confirmación seguida de pérdida de respuesta.

7. **F2-7 — Media — La página completa no respeta la geometría de impresión A4/A6.**  
   **Dónde:** [layout de institución:9](/C:/Users/adrim/build101/.claude/worktrees/fase-1/app/institucion/layout.tsx:9), [PrintSheets.tsx:35](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/access-cards/PrintSheets.tsx:35), [prueba:140](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/access-cards/AccessCardsView.test.tsx:140).  
   **Escenario:** la hoja mide 210 × 296 mm, pero su ancestro mantiene padding horizontal, superior e inferior durante la impresión. El conjunto excede A4 y obliga a desbordar, reducir o fragmentar el contenido. La prueba solo cuenta etiquetas y busca el texto de `@page`; no comprueba dimensiones ni paginación.  
   **Cambiaría:** eliminar las restricciones de todos los ancestros en impresión y verificar un PDF de cuatro y cinco tarjetas desde la ruta completa.

8. **F2-8 — Media — Los recorridos nuevos de cierre siguen deshabilitados.**  
   **Dónde:** [staff-auth.spec.ts:29](/C:/Users/adrim/build101/.claude/worktrees/fase-1/tests/e2e/staff-auth.spec.ts:29), [student-auth.spec.ts:10](/C:/Users/adrim/build101/.claude/worktrees/fase-1/tests/e2e/student-auth.spec.ts:10), [institution.spec.ts:39](/C:/Users/adrim/build101/.claude/worktrees/fase-1/tests/e2e/institution.spec.ts:39).  
   **Escenario:** todos los casos nuevos de esos archivos tienen `skip`, individualmente o por suite. Un `check` verde no valida login real, recuperación, invitaciones, creación desde el panel ni las comprobaciones de axe y 320 px previstas allí. Tampoco hay un recorrido efectivo de impresión de tarjetas.  
   **Cambiaría:** preparar datos y correos durante la corrida, activar los recorridos y agregar impresión, revocación y navegación con secretos retenidos.

9. **F2-9 — Media — Los límites de Auth se aumentaron sin la medición exigida.**  
   **Dónde:** [config.toml:220](/C:/Users/adrim/build101/.claude/worktrees/fase-1/supabase/config.toml:220), [notas:7](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2-notas.md:7), [valores estimados:17](/C:/Users/adrim/build101/.claude/worktrees/fase-1/docs/contratos/fase-2-notas.md:17).  
   **Escenario:** T2.7 exige medir `/token`, `/verify` y el comportamiento de `Sb-Forwarded-For`. Las notas reconocen que no se midieron y que 300/600 son estimaciones. En staff, las llamadas públicas directas a Auth eluden los contadores propios, por lo que aumentar ese límite también amplía esa puerta.  
   **Cambiaría:** completar y registrar la medición antes de cerrar el criterio.

10. **F2-10 — Media — La falta de configuración de correo no impide arrancar.**  
    **Dónde:** [getMailSender:24](/C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/server/mail/index.ts:24), [sendMail:42](/C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/server/services/invitations.ts:42), [prueba:79](/C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/server/mail/mail.test.ts:79).  
    **Escenario:** sin `RESEND_API_KEY`, producción puede arrancar y crear invitaciones. La validación ocurre recién al enviar y su excepción se convierte en `mail_failed`. La prueba «no arranca» solo invoca la fábrica, sin comprobar el arranque.  
    **Cambiaría:** validar la configuración en la inicialización del servidor, antes de aceptar operaciones, con una prueba de ese punto de entrada.

11. **F2-11 — Baja — Las tarjetas tienen dos landmarks principales anidados y el mismo id.**  
    **Dónde:** [layout:9](/C:/Users/adrim/build101/.claude/worktrees/fase-1/app/institucion/layout.tsx:9), [página de tarjetas:20](/C:/Users/adrim/build101/.claude/worktrees/fase-1/app/institucion/[institutionId]/grupos/[groupId]/tarjetas/page.tsx:20).  
    **Escenario:** ambos renderizan `<main id="main-content">`. La estructura de landmarks queda inválida y el destino del enlace para saltar al contenido es ambiguo.  
    **Cambiaría:** conservar un solo `main` y comprobar accesibilidad sobre la página completa.

**Veredicto: necesita otra ronda.**

## Ronda 2

1. **F2-12 — Media — Los E2E nuevos no pueden arrancar en CI.**  
   **Dónde:** [playwright.config.ts:42](/C:/Users/adrim/build101/.claude/worktrees/fase-1/playwright.config.ts:42), [support/env.ts:27](/C:/Users/adrim/build101/.claude/worktrees/fase-1/tests/e2e/support/env.ts:27), [ci.yml:40](/C:/Users/adrim/build101/.claude/worktrees/fase-1/.github/workflows/ci.yml:40).  
   **Escenario:** cargar la configuración de Playwright ejecuta `supabase status`. El job `punta-a-punta` instala dependencias y Chromium, pero no levanta Supabase ni Mailpit. El stack del job `base` corre en otro runner. La suite falla antes de comenzar, incluida la demo guiada.  
   **Cambiaría:** preparar el stack local, con Mailpit y las migraciones aplicadas, dentro del job de Playwright.

2. **F2-13 — Media — Una respuesta perdida al crear un estudiante todavía permite duplicarlo.**  
   **Dónde:** [student-accounts.ts:49](/C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/server/services/student-accounts.ts:49), [createFlowState.ts:80](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/institution/createFlowState.ts:80).  
   **Escenario:** `create_student` confirma, pero su respuesta se pierde. El servicio convierte esa incertidumbre en una fila `failed`; el reducer elimina el intento. Al reintentar se manda otra clave y aparece `username_taken`. Si el admin sigue la indicación de cambiar el usuario, crea otro estudiante para la misma persona. Reproduje la secuencia con el servicio y el reducer reales, simulando la pérdida de respuesta.  
   **Cambiaría:** conservar la identidad de cada fila ante resultados inciertos. Reintentar debe recuperar el estudiante ya creado, manteniendo su clave y su índice originales. La prueba actual de respuesta perdida cubre la acción completa, no esta pérdida entre servidor y RPC.

3. **F2-14 — Media — Recuperar la contraseña puede terminar cambiando la de otra cuenta.**  
   **Dónde:** [RecoveryFlow.tsx:31](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/staff/RecoveryFlow.tsx:31), [staff-auth.ts:74](/C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/server/services/staff-auth.ts:74).  
   **Escenario:** se verifica el enlace de A y queda abierto el formulario. En otra pestaña del mismo navegador se sale de A y se entra como B. Al guardar desde el formulario original, `setNewPassword` cambia la contraseña de B y cierra sus otras sesiones: solo recibe la contraseña y usa la sesión actual. La verificación de A no está vinculada a esa escritura.  
   **Cambiaría:** vincular la recuperación al usuario y a la sesión verificados mediante un contexto opaco validado en servidor; rechazar el envío si cambiaron. Agregaría el recorrido con dos pestañas. Evitar consumir dos veces el token, como hace T2.10, debe conservar esa vinculación.

4. **F2-15 — Media — El E2E de recuperación corrige el enlace que debería comprobar.**  
   **Dónde:** [staff-auth.spec.ts:99](/C:/Users/adrim/build101/.claude/worktrees/fase-1/tests/e2e/staff-auth.spec.ts:99), [recovery.html:6](/C:/Users/adrim/build101/.claude/worktrees/fase-1/supabase/templates/recovery.html:6), [config.toml:164](/C:/Users/adrim/build101/.claude/worktrees/fase-1/supabase/config.toml:164).  
   **Escenario:** Playwright usa por defecto el puerto 3100, pero el correo se arma con `SiteURL`, configurado en 3000. La prueba extrae únicamente el token y construye otra URL sobre el servidor probado. Pasa aunque abrir el correo lleve a un servidor inexistente o a otro checkout.  
   **Cambiaría:** alinear la configuración del origen y los redirects permitidos, y navegar a la URL completa recibida en Mailpit. Esa prueba debe fallar si el enlace apunta al destino equivocado.

5. **F2-16 — Baja — Cancelar la revocación pierde el foco.**  
   **Dónde:** [InvitationRow.tsx:42](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/institution/InvitationRow.tsx:42), [useInvitationRow.ts:65](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/institution/useInvitationRow.ts:65).  
   **Escenario:** con teclado, se abre «Revocar» y se activa «No, dejarla». El botón enfocado se desmonta y no se devuelve el foco al disparador. El E2E comprueba el foco inicial y luego corre axe; ninguna comprobación detecta esta pérdida.  
   **Cambiaría:** devolver el foco al botón «Revocar» de esa fila y comprobarlo después de cancelar.

El estado de los anteriores queda así:

| Hallazgo | Estado |
|---|---|
| F2-1 y F2-2 | Cerrados por la exclusión explícita del modelo de amenazas. |
| F2-3 | Cerrado: las rutas de IA consultan al actor antes de llamar al proveedor. |
| F2-4 | Corregido: limpieza al desactivar y descarte de respuestas tardías; impresión fuera del efecto. Falta el E2E de navegación y regreso. |
| F2-5 | Corregido: el login consulta al actor y dispone de limpieza sin volver al área protegida por los claims solos. |
| F2-6 | Cerrado para la creación del **grupo**. F2-13 describe el problema restante en estudiantes. |
| F2-7 | Corregida la geometría de los ancestros. Las pruebas todavía no verifican un PDF de cuatro y cinco tarjetas desde la ruta completa. |
| F2-8 | Cerrada la deshabilitación: los recorridos están activos y usan servicios locales reales. F2-12 bloquea su ejecución en CI. |
| F2-9 | Pendiente aceptado para T1.0; no lo considero bloqueante. |
| F2-10 | **Parcialmente abierto**, por la divergencia explicada abajo. |
| F2-11 | Cerrado: queda un único `main` en tarjetas. |

**F2-10 conserva un escenario concreto:** con `NODE_ENV=production`, `MAIL_DRIVER=mailpit`, sitio y secreto válidos, pero sin `RESEND_API_KEY`, [startup-config.ts:30](/C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/server/startup-config.ts:30) permite arrancar. Después, [mail/index.ts:26](/C:/Users/adrim/build101/.claude/worktrees/fase-1/lib/server/mail/index.ts:26) exige esa clave en toda producción y rechaza el envío. Lo confirmé con una sonda en memoria. Unificaría la validación del arranque y la selección del emisor; también rechazaría drivers desconocidos.

Pasaron los dos chequeos de TypeScript con `--noEmit --incremental false`. Las sondas usaron dependencias simuladas y no escribieron datos. No ejecuté build, pgTAP ni Playwright, por lo que la impresión, la accesibilidad y la demo no tienen validación nueva de navegador en esta revisión.

## Ronda 3

1. **F2-17 · Alta · Las contraseñas del login sobreviven a la navegación y al logout.**  
   **Dónde:** [useStudentLogin.ts:46](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/student/useStudentLogin.ts:46), [SignOutButton.tsx:38](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/staff/SignOutButton.tsx:38) y [StaffLoginForm.tsx:33](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/staff/StaffLoginForm.tsx:33).  
   **Escenario:** el estudiante entra y después sale en una computadora compartida. El login conserva contraseña, `reveal` y `busy`: no hay limpieza y ambas navegaciones usan el router. La [guía local de Next:255](/C:/Users/adrim/build101/.claude/worktrees/fase-1/node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md:255) confirma que Activity conserva estado y valores de formularios incluso al cambiar la autenticación. Al recuperar esa pantalla, otra persona puede revelar la contraseña; además, el botón puede seguir ocupado. El formulario de staff tampoco limpia su contraseña.  
   **Cambiaría:** borrar secretos y estado transitorio al desactivar los formularios y completar el ingreso; usar navegación completa al salir para descartar el estado del usuario anterior. Agregaría un E2E de entrar, salir y comprobar campos vacíos y botón habilitado, sin recargas intermedias.

2. **F2-18 · Media · «Saltar al contenido» rompe invitaciones y recuperación.**  
   **Dónde:** [fragmentToken.ts:9](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/staff/fragmentToken.ts:9), [InvitationFlow.tsx:43](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/staff/InvitationFlow.tsx:43) y [RecoveryFlow.tsx:45](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/staff/RecoveryFlow.tsx:45).  
   **Escenario:** con una invitación válida abierta, alguien usa el enlace de teclado «Saltar al contenido». El `hashchange` vuelve a leer el fragmento y sustituye el token por `main-content`. La invitación pasa a «Falta algo en este enlace». En recuperación se verifica ese texto como token y aparece el estado vencido. Axe no detecta este fallo funcional.  
   **Cambiaría:** distinguir tokens de anclas internas, ignorar `#main-content` y conservar el token válido. Probaría el enlace de salto en ambos recorridos.

3. **F2-19 · Media · Abrir otro QR en la misma pestaña mantiene la tarjeta anterior.**  
   **Dónde:** [CardLanding.tsx:30](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/student/CardLanding.tsx:30).  
   **Escenario:** se abre `/t#A`, se limpia el fragmento y queda el formulario de A. Después se pega `/t#B` en esa misma pestaña. Es una navegación dentro del documento: el efecto no vuelve a leerlo, mantiene los datos de A y deja B en la barra. También ocurre al abrir una tarjeta válida después de una inválida.  
   **Cambiaría:** procesar cambios de fragmento válidos, reiniciar el formulario para la nueva tarjeta y descartar respuestas anteriores. Agregaría el recorrido A → B sin recargar.

El estado de los anteriores queda así:

| Hallazgo | Estado |
|---|---|
| F2-1 y F2-2 | Cerrados por la exclusión explícita del modelo. |
| F2-3, F2-5, F2-6 y F2-11 | Cerrados; sin regresiones identificadas. |
| F2-4 | Corrección conservada. Sigue faltando el E2E de navegación interna y regreso con secretos. |
| F2-7 | Corrección de ancestros conservada. Sigue faltando verificar PDF de cuatro y cinco tarjetas; el E2E actual imprime dos y comprueba visibilidad. |
| F2-8 | Recorridos activos; resuelto también su impedimento de infraestructura en CI. |
| F2-9 | Pendiente aceptado para T1.0, no bloqueante. |
| F2-10 | Cerrado: arranque y selección del emisor comparten validación; rechazan drivers desconocidos. |
| F2-12 | Cerrado en código: el job levanta Supabase con Mailpit y aplica migraciones. |
| F2-13 | **Parcialmente abierto**, escenario abajo. |
| F2-14 | Cerrado para el cambio de A a B: el `userId` verificado se compara antes de escribir. |
| F2-15 | **Abierto:** todavía se sustituye el origen del enlace. |
| F2-16 | Cerrado: devuelve el foco al disparador y el E2E lo comprueba después de cancelar. |

**F2-13 — escenario restante:** `create_student` confirma y se pierde la respuesta. La fila queda `uncertain`, pero editar su usuario le asigna otro `slot` en [createFlowState.ts:59](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/institution/createFlowState.ts:59). Confirmar crea otro estudiante para la misma persona. La propia [prueba de integración:64](/C:/Users/adrim/build101/.claude/worktrees/fase-1/tests/integration/accounts/lost-answer.test.ts:64) espera dos inscripciones después de esa secuencia. También se permite volver a los nombres cuando todas las respuestas son inciertas: se pierde el intento y la previsualización sugiere usuarios nuevos. Resolvería los intentos inciertos antes de permitir cambiar su identidad o reiniciar el flujo. El reintento sin editar sí quedó corregido.

**F2-15 — escenario restante:** el correo apunta a `localhost:3000`, mientras Playwright escucha en 3100. [staff-auth.spec.ts:102](/C:/Users/adrim/build101/.claude/worktrees/fase-1/tests/e2e/staff-auth.spec.ts:102) comprueba que el origen coincide con `site_url`, pero luego navega solamente a `pathname + hash`. Sigue pasando aunque el enlace recibido no abra la aplicación probada. Alinearía ambos orígenes y navegaría a `link.href` completo.

Pasaron ambos chequeos de TypeScript sin emitir archivos. Las sondas en memoria confirmaron la sustitución por `main-content`, la identidad nueva al editar una fila incierta, la lectura única del QR y la coherencia de configuración de correo. No ejecuté Playwright, pgTAP, integración ni build; la demo y la impresión no tienen validación nueva de navegador en esta ronda. No modifiqué archivos.

## Ronda 4

1. **F2-20 — Alta — Los formularios de invitación conservan contraseñas al navegar.**  
   **Dónde:** [InviteSignIn.tsx:33](C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/staff/InviteSignIn.tsx:33), [InviteNewAccount.tsx:47](C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/staff/InviteNewAccount.tsx:47).  
   **Escenario:** un profe escribe su contraseña para aceptar una invitación, sigue «Olvidé mi contraseña» y vuelve atrás. Activity conserva el formulario y el estado de «Mostrar». Estos formularios no tienen la limpieza incorporada a `StaffLoginForm` y `NewPasswordForm`; otra persona puede recuperar y revelar lo escrito. En el alta ocurre siguiendo «términos» o «privacidad».  
   **Cambiaría:** aplicar la misma limpieza al desactivar ambos formularios, reiniciar visibilidad y estado pendiente, y cubrir ida y vuelta mediante navegación interna.

2. **F2-21 — Media — Cambiar de QR no invalida un login pendiente de la tarjeta anterior.**  
   **Dónde:** [CardLanding.tsx:38](C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/student/CardLanding.tsx:38), [useStudentLogin.ts:25](C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/student/useStudentLogin.ts:25).  
   **Escenario:** se envía el login correcto de A y, mientras espera, se abre `/t#B`. El flujo desmonta el formulario de A y comienza a leer B. Si después completa el login de A, su continuación todavía ejecuta `router.push("/estudiante")`: termina entrando como A después de haber cambiado de tarjeta. La generación nueva protege las respuestas de `readCard`, pero no el login. Confirmé la navegación tardía con el hook real y dependencias simuladas.  
   **Cambiaría:** coordinar el cambio de tarjeta con el login en curso, incluyendo sus cookies; no habilitar el flujo de B mientras una respuesta de A pueda establecer la sesión. Agregar un recorrido con esa respuesta demorada.

3. **F2-22 — Media — Un enlace malformado puede dejar activa la recuperación de otra cuenta.**  
   **Dónde:** [fragmentToken.ts:18](C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/staff/fragmentToken.ts:18), [listener:35](C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/staff/fragmentToken.ts:35).  
   **Escenario:** está abierto el formulario de recuperación de A y se pega en esa pestaña un enlace de B con el token truncado. `isTokenShaped` lo considera un ancla y el listener lo ignora: permanecen el formulario, el `userId` y la sesión de A. Guardar cambia la contraseña de A. La sonda confirmó que un `pkce_` válido de A permanece retenido después de recibir uno truncado de B.  
   **Cambiaría:** distinguir las anclas internas conocidas, como `#main-content`, de un token inválido. Un enlace inválido nuevo debe invalidar el contexto anterior y mostrar el error. El soporte de `pkce_` no presenta por sí mismo un problema de longitud en el borde servidor.

**F2-13 sigue parcialmente abierto.**  
En [useCreateFlow.ts:45](C:/Users/adrim/build101/.claude/worktrees/fase-1/components/institution/useCreateFlow.ts:45), perder la respuesta completa de la Server Action solo muestra un aviso: no marca las filas como inciertas. Entonces [editRow:44](C:/Users/adrim/build101/.claude/worktrees/fase-1/components/institution/createFlowState.ts:44) permite cambiar el usuario y asigna otro `slot`; también permite volver a los nombres.

Lo reproduje con los pasos y el reducer reales, simulando una confirmación cuya respuesta se pierde: `flags` quedó vacío y el reintento editado envió el mismo `opKey` con otro `slot`, creando dos estudiantes en el servidor simulado. Marcaría las filas enviadas como pendientes de resolución antes del pedido y conservaría esa condición ante una respuesta incierta. También bloquearía su edición mientras el pedido está en curso.

El estado de los anteriores queda así:

| Hallazgos | Estado |
|---|---|
| F2-1 y F2-2 | Cerrados por exclusión explícita del modelo. |
| F2-3, F2-5, F2-6, F2-10, F2-11, F2-12, F2-14 y F2-16 | Correcciones conservadas; sin regresiones identificadas. |
| F2-4 | Ahora incluye E2E de navegación interna y regreso sin contraseñas ni reimpresión. |
| F2-7 | Ahora incluye PDF desde la ruta completa para cuatro y cinco tarjetas, verificando una y dos páginas. |
| F2-8 | Recorridos activos e infraestructura prevista en CI. |
| F2-9 | Pendiente aceptado para T1.0, no bloqueante. |
| F2-13 | **Parcialmente abierto**, escenario anterior. |
| F2-15 | Corregido: puerto predeterminado 3000 y navegación a `link.href` completo. Con otro puerto, ese caso se omite explícitamente. |
| F2-17 | Corregido en los logins originales; F2-20 señala los formularios de invitación omitidos. |
| F2-18 | Corregido para «Saltar al contenido»; F2-22 describe el problema nuevo con fragmentos inválidos. |
| F2-19 | Corregido el reemplazo A→B sin login pendiente; queda la carrera F2-21. |

Pasaron ambos chequeos de TypeScript sin emitir archivos. No ejecuté build, pgTAP, integración ni Playwright: la demo guiada, accesibilidad e impresión tienen revisión de código, pero no validación nueva de navegador en esta ronda.

**Veredicto: necesita otra ronda.**

## Ronda 5

1. **F2-23 — Media, bloqueante — El cambio de QR continúa aunque falle cerrar la sesión anterior.**  
   **Dónde:** [login-attempt.ts:16](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/student/login-attempt.ts:16) y [login-guard.ts:29](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/student/login-guard.ts:29).  
   **Escenario:** se envía el login de A, se abre el QR de B y termina correctamente el login de A. `discard()` llama a salir, pero ignora su `Result`. Si ese pedido no llega al servidor y devuelve `UNAVAILABLE`, `ticket.finish()` igualmente libera la espera: aparece B mientras permanece una sesión utilizable de A. Reproduje que el guard habilita la tarjeta nueva ante ese error.  
   **Cambiaría:** exigir un cierre confirmado antes de habilitar B; ante un resultado incierto, mostrar el problema y permitir reintentar la limpieza. Agregaría el caso de fallo del logout a las pruebas.

2. **F2-24 — Baja, se puede hacer después — La prueba de F2-20 no comprueba los formularios.**  
   **Dónde:** [useInviteSubmit.test.ts:24](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/staff/useInviteSubmit.test.ts:24).  
   **Escenario:** la prueba comprueba que cambia `formKey` mediante un simulador de hooks. Seguiría pasando si se quitara `key={formKey}` de ambos formularios y volvieran a conservar las contraseñas. No navega ni inspecciona campos o visibilidad.  
   **Cambiaría:** añadir los recorridos reales de invitación → recuperación/términos → atrás, comprobando contraseña vacía, tipo `password` y botón habilitado. La corrección actual está conectada correctamente; esta carencia no bloquea.

De los anteriores, estos dos siguen parcialmente abiertos:

- **F2-13 — Media, bloqueante — Todavía hay una ventana de edición mientras se crea el grupo.**  
  **Dónde:** [createSteps.ts:78](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/institution/createSteps.ts:78) y [CreateReview.tsx:41](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/institution/CreateReview.tsx:41).  
  **Escenario:** se confirma un grupo nuevo y, mientras espera `createGroup`, se cambia un usuario: todavía no hay flags `sending`, por lo que la edición sigue habilitada y asigna otro `slot`. La continuación envía las filas originales. Si confirma y pierde la respuesta, el reducer marca como incierta la fila **editada**. Reintentar envía otro slot y crea otro estudiante. Lo reproduje: mismo `opKey`, slots 0 y 1, dos estudiantes para la misma persona.  
  **Cambiaría:** congelar filas y regreso desde el comienzo de la confirmación, antes de esperar al grupo, manteniendo la identidad del pedido completo. La corrección funciona cuando el grupo ya está resuelto.

- **F2-22 — Media, bloqueante — Un enlace nuevo terminado únicamente en `#` conserva la recuperación anterior.**  
  **Dónde:** [fragmentToken.ts:55](/C:/Users/adrim/build101/.claude/worktrees/fase-1/components/auth/staff/fragmentToken.ts:55).  
  **Escenario:** está abierta la recuperación de A y se abre en esa pestaña el enlace de B recortado hasta `/ingresar/profesor/nueva#`. Ese cambio produce un fragmento vacío; el listener lo ignora. Permanecen formulario, `userId` y sesión de A: guardar cambia su contraseña. La sonda confirmó que no se notifica el cambio y se conserva el token anterior; la prueba actual incluso espera que se ignore.  
  **Cambiaría:** invalidar también ante un `hashchange` explícito hacia vacío, conservando por separado la reutilización inicial necesaria después de limpiar la barra. Los tokens truncados **no vacíos** sí quedaron corregidos.

El estado completo queda así:

| Hallazgos | Estado |
|---|---|
| F2-1 y F2-2 | Cerrados por la exclusión explícita del modelo. |
| F2-3 a F2-8, F2-10 a F2-12, F2-14 a F2-16 | Correcciones conservadas; sin regresiones identificadas. |
| F2-9 | Pendiente aceptado para T1.0; no bloqueante. |
| F2-13 | Parcialmente abierto: espera de creación del grupo. |
| F2-17 a F2-19 | Correcciones originales conservadas. |
| F2-20 | Cerrado en código; F2-24 señala la cobertura pendiente. |
| F2-21 | Corregida la espera normal; parcialmente abierto por F2-23. |
| F2-22 | Parcialmente abierto para el fragmento vacío. |

Pasaron ambos chequeos de TypeScript sin emitir archivos y el lint de los archivos revisados de T2.F5. Las reproducciones usaron código real y dependencias simuladas en memoria. No ejecuté build, pgTAP, integración ni Playwright: demo guiada, accesibilidad e impresión tienen revisión de código, sin validación nueva de navegador en esta ronda. El árbol de trabajo sigue limpio.
