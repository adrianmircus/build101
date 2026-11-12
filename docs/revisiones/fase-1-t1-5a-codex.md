# Revisión de Codex de T1.5a y T1.7b

Encontré dos bloqueantes en T1.5a. T1.7b no presenta hallazgos independientes.

1. **P-1 · Alta · La copia admite campos estructurales prohibidos dentro de `graph`.**  
   [20261113000000_t1_5a_publish.sql:111](supabase/migrations/20261113000000_t1_5a_publish.sql:111)

   Se copia `q.options` íntegro. Los validadores SQL de edición y generación restringen las claves de cada opción, pero dentro de `graph` solo exigen un objeto. **Escenario:** una opción con `graph: {"functions":[],"correctOptionId":"B","recipients":["<uuid>"]}` puede entrar por RPC, aprobarse y publicarse. La copia incumple el esquema cerrado y la garantía estructural de fugas; las pruebas actuales solo usan opciones simples.

   **Corrección:** validar recursivamente `GraphSpec` en SQL y construir una proyección cerrada. Agregar una regresión que recorra edición/generación → aprobación → publicación con campos prohibidos anidados. Corregir mediante una migración nueva.

2. **P-2 · Media · Se fija una política pedagógica sin respaldo contractual.**  
   [20261113000000_t1_5a_publish.sql:127](supabase/migrations/20261113000000_t1_5a_publish.sql:127)

   `readAloud` equivale exactamente a «incluye dislexia». El comentario de `data/profiles/dyslexia.md` atribuye la lectura a la plataforma, pero no establece esa exclusividad ni impide desactivarla. **Escenario:** toda versión con dislexia congela la ayuda activada; cualquier otra la congela desactivada, sin una elección docente representable. La prueba consolida esa decisión sin justificarla.

   **Corrección:** establecer explícitamente la política aprobada en el contrato y derivar el valor de ella, incluyendo cualquier elección docente prevista. Cubrir ambos valores y sus condiciones.

3. **P-3 · Baja · Queda indefinido el estado del práctico después de publicar.**  
   [20261113000000_t1_5a_publish.sql:291](supabase/migrations/20261113000000_t1_5a_publish.sql:291)

   Publicar termina sin cambiar `assessments.status`. **Escenario:** existen publicación e intentos, pero `get_assessment` y `list_assessments` siguen devolviendo `draft`. No lo considero bloqueante porque T1.5a no prescribe expresamente esa transición.

   **Corrección:** definir el significado del estado agregado cuando se publican versiones. Si corresponde actualizarlo, tomar el lock necesario sobre el práctico desde el comienzo; evitar una actualización tardía después de bloquear versiones y asignaciones.

El resto de T1.5a resulta consistente por inspección:

- **Precondiciones:** revisión → contenido completo → aprobación → preguntas por ejercicio → clave → inscripción → consentimiento, con sus códigos y razones. Dar `content_incomplete` antes de `not_approved` satisface el caso obligatorio de la versión typed pendiente.
- **Idempotencia:** identidad basada en los argumentos originales, advisory lock antes de locks de filas y replay de `op_attempts` guardado, incluso después de ediciones o publicaciones posteriores.
- **Copia e intentos:** instrucciones de la versión; proyecciones explícitas para ejercicios y preguntas, con la excepción P-1. Cada intento conserva la clave de su publicación; solo los `opened` se mueven con la clave nueva.
- **Locks y guardias:** orden compatible con T1.4c y con asignación → intento → borrador de T1.5b. No identifiqué una inversión entre esos caminos. Guardias invoker compatibles con `tiza_student`, probadas como dueño con `P0004`; distinción `NOT_FOUND`/`FORBIDDEN` coherente.
- **Decisiones aceptables:** clave actual por defecto en gaze, sin exigir su aprobación y comparando revisiones; ≥1 pregunta por ejercicio; consentimiento ante cualquier generación existente; cero destinatarios produce cero intentos; asignaciones retiradas intactas.

T1.7b mantiene wrappers sobre `callRpc`, sin reglas de negocio y con `opId`/`opKey` aportados por el llamador. Los repos de contenido y clave cubren aislamiento entre instituciones. Las generaciones usan el cliente admin en los caminos exitosos; Postgres restringe sus cuatro RPC a `service_role`.

Pasaron lint, ambos chequeos de tipos —el general con caché incremental desactivada— y **550 pruebas unitarias**. Docker denegó acceso: pgTAP, integración y mutaciones sin locks quedaron sin ejecutar. Las pruebas `NOWAIT` pueden detectar estáticamente locks omitidos o retrasados, pero no doy por comprobada su sensibilidad experimental. El worktree permanece limpio.

Veredicto: no listo (bloquean P-1 y P-2).
