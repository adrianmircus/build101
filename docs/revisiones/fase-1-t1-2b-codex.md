# Revisión de Codex de T1.2b

Revisado T1.2b del merge `b6ad267` (`d9fe547`), sin editar archivos. Los dos archivos siguen iguales a ese merge. No repito los hallazgos W1.

1. **W2-1 — media — [20261112110000_t1_2b_students.sql:165](supabase/migrations/20261112110000_t1_2b_students.sql:165). La identidad del `op_key` depende de datos mutables.**  
   **Problema:** identifica la creación por el username actual y cualquier inscripción del estudiante; no conserva el grupo original.  
   **Escenario:** crear en G1 con K, inscribir después en G2 y reutilizar K en G2 devuelve éxito, aunque debería responder `CONFLICT op_key_reused`. Cambiar el username también hace que un reintento exacto del pedido original deje de reconocerse.  
   **Fix:** conservar la identidad original y el resultado de la operación, compararlos bajo el lock y probar ambos escenarios. Los casos actuales solo comprueban la identidad antes de modificarla.

2. **W2-2 — media — [20261112110000_t1_2b_students.sql:185](supabase/migrations/20261112110000_t1_2b_students.sql:185). El sandbox pierde la idempotencia de creación.**  
   **Problema:** no guarda K en ningún lado. La excepción «sin provisioning» no elimina la regla común de idempotencia.  
   **Escenario:** repetir exactamente una creación con K devuelve `username_taken`; reutilizar K con otro username crea otro estudiante.  
   **Fix:** persistir la operación también en sandbox, sin aprovisionar cuentas reales. Si requiere ampliar el contrato, escalar esa necesidad. La prueba de la línea 171 repite el username con una clave nueva: no verifica este comportamiento.

3. **W2-3 — media — [20261112110000_t1_2b_students.sql:304](supabase/migrations/20261112110000_t1_2b_students.sql:304). `enroll_student` puede devolver `{"id":null}`.**  
   **Problema:** entre `ON CONFLICT DO NOTHING` y la recuperación del id, `unenroll_student` puede finalizar la inscripción. Los locks compartidos del grupo no lo impiden.  
   **Escenario:** A no encuentra inscripción; B crea una y confirma; el INSERT de A encuentra conflicto; B da la baja y confirma antes del SELECT posterior de A. A devuelve un id nulo, incompatible con `Created`.  
   **Fix:** serializar altas y bajas del mismo par grupo/estudiante con un lock común adquirido antes de consultar. Agregar una prueba coordinada entre sesiones; las actuales son secuenciales.

4. **W2-4 — media — [20261112110000_t1_2b_students.sql:96](supabase/migrations/20261112110000_t1_2b_students.sql:96). Dos vinculaciones concurrentes escapan del protocolo de errores.**  
   **Problema:** bloquear el estudiante no serializa dos estudiantes distintos que intentan usar la misma cuenta. El chequeo previo puede pasar en ambos y solo se captura `check_violation`.  
   **Escenario:** dos llamadas vinculan S1 y S2 al mismo usuario; una termina y la otra obtiene `23505` por `students.user_id`, en lugar del `CONFLICT op_key_reused` que devuelve el caso secuencial.  
   **Fix:** serializar por la cuenta antes de comprobar su disponibilidad o traducir específicamente esa restricción única. Probar la carrera tanto dentro de una institución como entre instituciones.

5. **W2-5 — media — [011_students.test.sql:215](supabase/tests/011_students.test.sql:215). Falta cobertura obligatoria de permisos en las RPC nuevas.**  
   **Problema:** las negativas están distribuidas entre funciones, pero el contrato las exige por RPC. Faltan, por ejemplo, inclusión y otra institución para `archive_student`, estudiante para `restore_student`, y estudiante y otra institución para `unenroll_student`.  
   **Escenario:** permitir indebidamente archivar a inclusión o dar bajas a estudiantes puede conservar verdes las 182 aserciones. Tampoco se detectaría eliminar el advisory lock de `create_student`: no hay concurrencia.  
   **Fix:** completar la matriz por función y añadir pruebas entre sesiones para idempotencia, vinculación y altas/bajas. Este hallazgo corresponde a `011`, no a la cobertura de T1.2a ya señalada en W1.

6. **W2-6 — baja — [20261112110000_t1_2b_students.sql:206](supabase/migrations/20261112110000_t1_2b_students.sql:206). Los campos nulos evitan las validaciones.**  
   **Problema:** las condiciones de longitud y regex producen `NULL`, que no entra al `IF`.  
   **Escenario:** `update_student(S, revisión_actual, NULL, username_actual)` responde éxito sin cambiar nada; otras combinaciones terminan en errores SQL sin traducir. PostgREST permite enviar esos nulos directamente.  
   **Fix:** rechazarlos explícitamente con `INVALID` y agregar pruebas equivalentes para creación y edición.

En lectura estática, las autorizaciones y el aislamiento institucional son coherentes; las proyecciones tienen las claves esperadas, sin needs, perfiles ni interface, y la paginación conserva el total. Son compatibles conservar inscripciones al archivar, vincular sin subir la revisión y responder `FORBIDDEN` al estudiante inscripto en las lecturas de grupo. La idempotencia de altas/bajas es una decisión válida, pero necesita resolver W2-3.

Pasaron ambos chequeos de TypeScript —con incremental desactivado para evitar escrituras—, lint y **537 pruebas unitarias**. **No ejecuté pgTAP:** Docker deniega acceso a su API. Los hallazgos SQL y las intercalaciones de concurrencia son estáticos.

Veredicto: ticket no listo — bloqueantes: W2-1, W2-2, W2-3, W2-4 y W2-5.
