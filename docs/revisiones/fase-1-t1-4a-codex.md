# Revisión de Codex de T1.4a

Encontré dos bloqueantes y dos observaciones menores. No edité archivos.

1. **T14a-1 — Media — [20261112170000_t1_4a_assessments.sql:407](supabase/migrations/20261112170000_t1_4a_assessments.sql:407). Cambiar `topic_id` no marca `stale`.**  
   La condición solo compara etiqueta y cuerpo. **Escenario:** cambiar la unidad curricular de un ejercicio ya adaptado sube su revisión, pero sus versiones siguen figurando vigentes, contrariando T1.4a. La prueba de tema usa `e3`, que no tiene versiones, y oculta el problema. **Corrección:** incluir `topic_id` en la comparación y probar el cambio sobre un ejercicio adaptado, verificando las versiones afectadas y sus copias intactas.

2. **T14a-2 — Media — [assessments.test.ts:206](tests/integration/races/assessments.test.ts:206). La carrera de `stale` no demuestra el orden de locks de versiones.**  
   Todas las operaciones compiten por el mismo práctico y quedan serializadas antes de llegar a las versiones. **Escenario:** eliminar `app.lock_versions(v_ids)` y dejar el `UPDATE` adquirir locks sin orden conservaría verde esta prueba; tampoco participa un árbol versión → generación → ejercicios adaptados. **Corrección:** agregar competencia entre conexiones que ejercite esos locks y varias versiones, y comprobar que una mutación que rompa su orden haga fallar la prueba, como exige la checklist.

3. **T14a-3 — Baja — [015_assessments.test.sql:313](supabase/tests/015_assessments.test.sql:313). El caso de listado vacío pasa por una denegación.**  
   Llama como `teach` al grupo `go_n`, cuyo docente es `other`. Recibe `NOT_FOUND`; extraer `items` produce nulo y el conteo termina en cero. **Escenario:** el supuesto caso feliz pasa aunque la lectura falle. **Corrección:** llamar como `other` y comprobar explícitamente ausencia de error, `items = []` y `total = 0`.

4. **T14a-4 — Baja — [reasons.ts:22](lib/domain/errors/reasons.ts:22). El mensaje ofrece una restauración inexistente.**  
   **Escenario:** editar un práctico archivado muestra «Restauralo para cambiarlo», aunque no tiene restauración. **Corrección:** usar un mensaje neutral o una razón específica para este recurso.

Considero válidas las decisiones sobre revisiones independientes, altas sin `stale`, archivo irreversible, unidades del programa y límite de 200 ejercicios. No observé una inversión actual de locks: los ejercicios originales y los adaptados son tablas distintas. T1.4b deberá bloquear el práctico antes de copiar ejercicios.

Pasaron lint, ambos chequeos de tipos —sin escritura incremental— y 540 pruebas unitarias. Docker denegó acceso; SQL y carreras se revisaron estáticamente. `p_op_key` queda excluido de los bloqueantes por tu indicación.

Veredicto: ticket no listo — bloqueantes: T14a-1, T14a-2.
