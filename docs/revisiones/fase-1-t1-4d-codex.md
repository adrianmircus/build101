# Revisión de Codex de T1.4d

Encontré dos bloqueantes.

1. **T14d-1 — Alta — [20261112220000_t1_4d_generations.sql:345](supabase/migrations/20261112220000_t1_4d_generations.sql:345). Una salida incompleta puede aplicarse y borrar preguntas.**  
   **Problema:** los validadores pueden devolver `NULL`, pero `WHEN NOT v_valid` solo descarta `false`.  
   **Escenario:** enviar `gaze_questions` con `{}` a una generación vigente y fresca produce `v_valid = NULL`. La RPC decide `applied`, elimina las preguntas existentes, inserta cero y aumenta las revisiones. Para `exercise` e `instructions`, `{}` intenta escribir texto nulo y falla, perdiendo también el registro de la salida. Además, una pregunta sin `options` puede superar el validador y terminar en una violación `NOT NULL`.  
   **Corrección:** validar explícitamente todos los campos obligatorios y hacer que los validadores siempre devuelvan un booleano; usar `v_valid IS NOT TRUE` como respaldo. Agregar casos de campos ausentes que comprueben `discarded`, conservación íntegra del destino y replay sin efectos. El cambio del `CASE` solo no resuelve las preguntas sin opciones.

2. **T14d-2 — Media — [generations-create.test.ts:26](tests/integration/races/generations-create.test.ts:26). Las carreras de creación no demuestran el lock temprano de versión.**  
   **Problema:** `waitedOn !== null` acepta cualquier espera. Al quitar `lock_version_tree`, permanecen los locks explícitos de generaciones y ejercicios, las FK y las escrituras posteriores sobre la versión.  
   **Escenario:** la convivencia de ejercicios distintos puede seguir pasando por una espera posterior. Por inspección, los casos del mismo ejercicio y versión contra ejercicio también pueden serializarse en los ejercicios y ejecutar después el reemplazo correctamente. Eso deja sin detectar una regresión que tome generación/ejercicio antes de versión y permita deadlocks con escritores que conservan el orden contractual.  
   **Corrección:** mantener bloqueada únicamente la versión, iniciar la creación en otra conexión y comprobar con `NOWAIT` que todavía no tomó generaciones ni ejercicios. Verificar en una base descartable que quitar o retrasar el lock inicial rompe esa prueba. Que el caso de ejercicios distintos pase sin él es aceptable como prueba de convivencia; no acredita el orden de locks.

En la implementación actual no encontré inversión de locks con las ediciones T1.4c ni con `update_version_config` de T1.F4. La búsqueda bajo advisory lock, las revisiones capturadas bajo lock, el reemplazo por tipo, las guardias, los permisos exclusivos de `service_role` y los mensajes de razones son coherentes. Con salidas válidas, los duplicados devuelven lo guardado y las generaciones cerradas o reemplazadas no vuelven a aplicar. El cierre es único y solo `done` escribe `generated`.

Considero válidas las decisiones de comparar identidad sin hash —aceptando `CONFLICT` tras redactar los inputs—, poner todos los ejercicios bajo una generación de versión y crear/reutilizar `answer_keys` con vigencia propia. Conservar `versions.stale` por salida es prudente: una salida parcial no acredita que toda la versión corresponda al original y la configuración vigentes.

Pasaron ambos chequeos de tipos, con escritura incremental desactivada, lint y **550 pruebas unitarias**. Docker denegó acceso; pgTAP, carreras y sensibilidad a la eliminación de locks se revisaron estáticamente. No edité archivos.

Veredicto: ticket no listo — bloqueantes: T14d-1, T14d-2.
