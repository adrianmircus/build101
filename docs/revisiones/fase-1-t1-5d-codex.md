# Revisión de Codex de T1.5d

Encontré tres bloqueantes y una debilidad menor en la prueba.

1. **T15d-1 — Alta — [migración:182](supabase/migrations/20261113050000_t1_5d_student_dto.sql:182).**  
   **Problema:** `student_task` reconstruye `options[].id` y `text`, pero copia `graph` íntegro; comprobar que sea un objeto no garantiza las claves ni los tipos permitidos.  
   **Escenario:** una publicación anterior a F5/F6 conserva `graph.correctOptionId`, `recipients` o un objeto dentro de `expr`. Las correcciones de publicación afectan las publicaciones nuevas; esta lectura entrega el contenido histórico contaminado. Las pruebas actuales usan opciones sin gráficos y no lo detectan.  
   **Corrección:** reconstruir el gráfico hoja por hoja, validando tipos y claves en cada nivel, y agregar una prueba con una publicación histórica contaminada. Hacerlo sin ampliar los privilegios de `tiza_student`.

2. **T15d-2 — Media — [migración:194](supabase/migrations/20261113050000_t1_5d_student_dto.sql:194).**  
   **Problema:** `draft.answers` y `draft.choices` salen como subárboles completos. Hay una vía vigente para devolver respuestas que incumplen el DTO estricto.  
   **Escenario:** `student_save_draft` permite cualquier objeto en `answers.<ejercicio>.graph` —[validación:189](supabase/migrations/20261113010000_t1_5b_attempts.sql:189)—. Un estudiante puede guardar `graph: {"errors":[]}` mediante la RPC y la lectura lo devuelve. `ownContent` exime palabras de perfil, no claves adicionales ni errores de esquema. Esto demuestra una ruptura del contrato, aunque el contenido provenga del propio estudiante.  
   **Corrección:** proyectar también las respuestas y sus gráficos, resolver los datos incompatibles mediante un error controlado y probar guardar→leer con ese caso.

3. **T15d-3 — Alta; conflicto de contrato — [migración:59](supabase/migrations/20261113050000_t1_5d_student_dto.sql:59).**  
   **Problema:** la interfaz permite deducir el perfil propio. Su derivación es determinista: `motor`→`gaze`, y, sin `motor`, `dysgraphia`→`voice` —[derivación:203](supabase/migrations/20261112140000_t1_3a_needs.sql:203)—.  
   **Escenario:** recibir `student_home.interface = "gaze"` permite concluir que está registrado `motor`. El chequeo de fugas pasa porque esos valores están permitidos; comparar claves y ayudas tampoco detecta esta inferencia.  
   **Corrección:** resolver expresamente la contradicción entre T1.5d, que exige esa fuente, y `CLAUDE.md:33`, que prohíbe permitir la deducción. Una opción compatible con conservar `students.interface` como fuente es convertirla en una preferencia de accesibilidad independiente del perfil. Hasta resolverlo no puede certificarse la garantía solicitada.

4. **T15d-4 — Baja — [student-dto-support.ts:16](tests/integration/student-dto-support.ts:16).**  
   **Problema:** ambos `create_version` reciben `profiles: ["motor"]`. Los estudiantes sí tienen perfiles reales distintos, pero las configuraciones de sus versiones no.  
   **Escenario:** una regresión que derive las ayudas del perfil de la versión podría producir ayudas iguales para ambos y superar la comparación de integración.  
   **Corrección:** parametrizar la configuración y publicar la versión del estudiante con dislexia usando `["dyslexia"]`.

Acepto las decisiones restantes: `FORBIDDEN not_a_student` para lecturas sin identificador y `NOT_FOUND` para intentos ajenos; título desde el tema compartido; voz→`standard`/`typed` sin consentimiento vigente; lectura pura; borrador vacío con revisión 1 antes de empezar; atraso calculado para intentos pendientes y conservado para entregados; lista limitada al intento vigente, ocultando retirados no entregados.

Por inspección, los cuatro RPC quedan dentro de la ventana, pertenecen a `tiza_student` y no agregan privilegios. RLS y los filtros preservan el aislamiento; las notas parten de correcciones existentes y excluyen detalles de errores. La matriz de momentos coincide con el dominio. No encontré exposición adicional de otros estudiantes mediante fechas, estados, cantidades u orden.

Pasaron ambos chequeos de tipos sin escritura incremental, lint y **550 pruebas unitarias**. Docker denegó acceso: pgTAP e integración quedaron revisados estáticamente. No modifiqué archivos; el worktree sigue limpio.

Veredicto: ticket no listo — bloqueantes: T15d-1, T15d-2 y T15d-3.
