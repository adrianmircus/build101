# Revisión de Codex de T1.3b, la reconstrucción y las carreras

Encontré tres bloqueantes y una observación menor. No modifiqué archivos.

1. **R-1 — Media — El helper permite conectarse a una base remota.**  
   [tests/integration/support/db.ts:27](tests/integration/support/db.ts:27). La expresión regular valida el host escrito en la autoridad de la URL, pero `pg` admite que `?host=` lo sustituya. **Escenario:** `postgresql://postgres:postgres@localhost:54322/postgres?host=db.remota.example` pasa el guard y dirige las escrituras fuera de localhost. Confirmé que la expresión lo acepta y que el [parser de pg prioriza ese parámetro](https://github.com/brianc/node-postgres/blob/master/packages/pg-connection-string/index.js#L36-L51). **Corrección:** validar el host efectivo y rechazar parámetros que cambien el destino; agregar ese caso negativo.

2. **R-2 — Media — La suite tolera una baja de inscripción que falla con concurrencia.**  
   [tests/integration/races/enrollment.test.ts:65](tests/integration/races/enrollment.test.ts:65); causa en [20261112130000_t1_2b_fix.sql:256](supabase/migrations/20261112130000_t1_2b_fix.sql:256). `unenroll_student` sigue usando `now()`, y las pruebas mantienen el fallo con `it.fails` y toleran `23514`. **Escenario:** la transacción de baja empieza antes que la de alta, pero ejecuta después: `ended_at < started_at`, PostgreSQL rechaza la operación y el estudiante queda inscripto. **Corrección:** una migración nueva que use `clock_timestamp()` después de adquirir los locks; convertir la prueba en obligatoria y eliminar la tolerancia.

3. **R-3 — Media — El vencimiento se valida antes de terminar las esperas por locks.**  
   [20261112150000_t1_3b_notes_consents.sql:367](supabase/migrations/20261112150000_t1_3b_notes_consents.sql:367). `v_now` se captura después del advisory lock, pero antes del `FOR SHARE` del estudiante y del archivo. **Escenario:** `set_student_needs` mantiene bloqueada la fila; `record_consent` valida un vencimiento próximo, espera hasta después de ese vencimiento y finalmente inserta el consentimiento como aceptado. **Corrección:** capturar y validar la hora después de las adquisiciones que pueden bloquear, antes de escribir; agregar una carrera con vencimiento durante esa espera.

4. **R-4 — Baja — La guardia permite reatribuir consentimientos después de borrar una cuenta.**  
   [20261112150000_t1_3b_notes_consents.sql:75](supabase/migrations/20261112150000_t1_3b_notes_consents.sql:75). Las condiciones permiten pasar `recorded_by` de `NULL` a otra cuenta y hacer lo mismo con `revoked_by` en un consentimiento ya revocado. **Escenario:** tras el `SET NULL` por eliminación de cuenta, una escritura privilegiada puede inventar una nueva autoría sin disparar la guardia. Las RPC actuales no exponen esa escritura. **Corrección:** congelar `recorded_by` salvo su paso a nulo; permitir asignar `revoked_by` únicamente al revocar por primera vez; probar ambos casos después del borrado.

El resto cumple por inspección estática:

- **T1.3b:** permisos de notas por autor y staff, denegación a inclusión, aislamiento institucional, distinción `NOT_FOUND`/`FORBIDDEN`, CAS y auditoría de ambas lecturas. La matriz prueba denegaciones por cada RPC y ausencia de cambios.
- **T13a-1/2/3:** resueltos. Hay siembra de necesidades, configuraciones, destinatarios y entradas de generación; mutaciones negativas de respuestas reales; detección de pares bajo claves arbitrarias y guard por firma completa, con una sobrecarga negativa.
- **T1.R:** usa conexiones y transacciones distintas, espera observable y aserciones que distinguen advisory locks de bloqueos por índices o filas. La estructura cubre W1-6/W2-5; no pude ejecutar aquí la comprobación quitando locks. Permanece R-2.
- **N1:** corregido en la regla, inventario y prueba de consistencia. La ejecución de la supresión corresponde a T9.5.

Acepto las decisiones indicadas: comparación con el consentimiento activo, reconocimiento del reintento de revocación, conservación del estado `granted` al vencer, lock por estudiante y ausencia de paginación. No bloqueo por el `p_op_key` de notas pendiente.

Pasaron lint y **540 pruebas unitarias**. Ambos chequeos de tipos quedaron bloqueados por la ausencia local de `pg`. Docker denegó acceso: pgTAP y carreras revisados estáticamente. Árbol de trabajo limpio.

Veredicto: no listo (bloqueantes: R-1, R-2 y R-3).
