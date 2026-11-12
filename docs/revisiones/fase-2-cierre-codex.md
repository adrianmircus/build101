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
