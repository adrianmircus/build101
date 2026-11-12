# Revisión de Codex de la tanda 1 de la fase 1

La tanda tiene **ocho hallazgos de severidad media y dos de severidad baja**. Revisión sobre `15ce02f`, incluidos ambos merges; sin cambios en archivos.

1. **W1-1 — media — [docs/PRIVACIDAD-DATOS.md:260](docs/PRIVACIDAD-DATOS.md:260). El inventario conserva texto que debería redactar.**  
   **Problema:** en versiones compartidas indica conservar `config`, `version_exercises.changes` y `version_questions.stem/options` —líneas 260, 274 y 286—, aunque admiten texto libre. Contradice `erasure.ts:15`, que exige redactar cualquier texto que nombre al estudiante.  
   **Escenario:** se borra a Paula, pero quedan intereses, motivos de adaptación o preguntas que la nombran explícitamente.  
   **Fix:** especificar redacción de esos campos y subcampos, conservando el contenido correspondiente a los demás destinatarios; agregar ejemplos negativos a las pruebas.

2. **W1-2 — media — [20261112100000_t1_2a_identity_groups.sql:51](supabase/migrations/20261112100000_t1_2a_identity_groups.sql:51). El trigger permite saltarse la exclusión estudiante/staff.**  
   **Problema:** se dispara al modificar `role` o `revoked_at`, pero no `user_id`; `touch_row` tampoco congela ese campo.  
   **Escenario:** reasignar una membresía docente mediante `UPDATE ... SET user_id = <estudiante>` deja ambas condiciones activas sin ejecutar la comprobación. No encontré una RPC actual que haga esa reasignación, pero la invariante prometida por el trigger queda abierta.  
   **Fix:** incluir `user_id` en el disparador o declararlo inmutable, y probar esta actualización.

3. **W1-3 — media — [20261112100000_t1_2a_identity_groups.sql:216](supabase/migrations/20261112100000_t1_2a_identity_groups.sql:216). La repetición de `internal_add_membership` puede devolver un id nulo.**  
   **Problema:** después de `ON CONFLICT DO NOTHING` recupera la membresía activa sin lock. `internal_revoke_membership` no participa del advisory lock usado por el trigger.  
   **Escenario:** una repetición encuentra la membresía existente; otra transacción la revoca antes del `SELECT` posterior. La primera devuelve `{"id":null}`, incompatible con su contrato de salida. Hallazgo estático; no ejecuté esta carrera.  
   **Fix:** serializar agregar y revocar con el mismo lock y orden de adquisición; agregar una prueba con dos sesiones.

4. **W1-4 — media — [20261112100000_t1_2a_identity_groups.sql:433](supabase/migrations/20261112100000_t1_2a_identity_groups.sql:433). `remove_group_staff` omite validar la membresía del destinatario.**  
   **Problema:** T1.2a exige para agregar y quitar staff que la persona sea docente o admin activo de esa institución; en caso contrario, `INVALID not_a_member`. Solo agregar lo comprueba.  
   **Escenario:** se revoca la membresía de un docente y luego quitarlo del grupo tiene éxito, aunque ya no cumple esa condición.  
   **Fix:** aplicar también la validación al quitar, preservando la repetición idempotente; probar destinatarios revocados y sin membresía.

5. **W1-5 — media — [20261112100000_t1_2a_identity_groups.sql:33](supabase/migrations/20261112100000_t1_2a_identity_groups.sql:33). El conflicto estudiante/staff sale fuera del protocolo de errores.**  
   **Problema:** los triggers levantan `23514` para una incompatibilidad de negocio esperada. El contrato exige `app.raise_error`; `parseRpcError` solo reconoce los errores esperados con `P0001` y código válido.  
   **Escenario:** intentar agregar una membresía docente a un estudiante produce un fallo inesperado para el repositorio, en vez de un rechazo de negocio reconocible. Las pruebas actuales fijan precisamente el `23514`.  
   **Fix:** emitir un error de aplicación estable o traducir esta restricción en las RPC correspondientes, y comprobar código y razón completos.

6. **W1-6 — media — [010_identity_groups.test.sql:285](supabase/tests/010_identity_groups.test.sql:285). Falta la cobertura obligatoria por RPC y de concurrencia.**  
   **Problema:** las negativas están repartidas entre funciones, pero la regla común exige cada rol denegado y aislamiento institucional para cada RPC. Por ejemplo, `restore_group` no se prueba como estudiante ni desde otra institución; `remove_group_staff` tampoco como estudiante. Los triggers solo se ejercitan secuencialmente.  
   **Escenario:** una regresión específica de esos caminos, o eliminar los advisory locks dejando los chequeos de existencia, puede conservar verdes las 117 aserciones.  
   **Fix:** completar los casos por RPC y añadir pruebas coordinadas de ambas direcciones de la carrera estudiante/staff.

7. **W1-7 — media — [inventory.ts:69](lib/domain/permissions/inventory.ts:69). Las columnas agregadas mediante migraciones posteriores quedan invisibles.**  
   **Problema:** el parser solo procesa `CREATE TABLE`; `006_inventory` compara tablas, no columnas.  
   **Escenario:** agregar `ALTER TABLE app.students ADD COLUMN undocumented_personal_data text` no obliga a actualizar el inventario. Lo comprobé inyectando esa migración en memoria: los nueve chequeos del inventario siguieron pasando.  
   **Fix:** comparar también las columnas del esquema aplicado desde pgTAP y enlazar esa lista con el documento, o soportar explícitamente las alteraciones del esquema.

8. **W1-8 — media — [inventory.test.ts:110](lib/domain/permissions/inventory.test.ts:110). La comparación no garantiza qué campo se desvincula.**  
   **Problema:** para una regla `unlink` basta con encontrar alguna acción `desvincula`; no verifica que corresponda al vínculo correcto.  
   **Escenario:** cambié en memoria `student_pseudonyms.student_id` a `conserva / no personal` y su `id` a `desvincula / no queda`. Los nueve chequeos siguieron pasando, aunque el documento ordenaría conservar el vínculo identificador.  
   **Fix:** incorporar expectativas explícitas por campo para desvinculación y redacción, con pruebas negativas que intercambien esas acciones.

9. **W1-9 — baja — [20261112100000_t1_2a_identity_groups.sql:432](supabase/migrations/20261112100000_t1_2a_identity_groups.sql:432). La regla declarada para archivados es asimétrica.**  
   **Problema:** las pruebas dicen que el staff queda congelado hasta restaurar el grupo, pero quitar staff no consulta `archived_at`.  
   **Escenario:** en un grupo archivado se rechaza agregar un docente, pero se permite quitarlo.  
   **Fix:** bloquear también la eliminación bajo el lock del grupo, o documentar y probar expresamente esa excepción.

10. **W1-10 — baja — [docs/PRIVACIDAD-DATOS.md:264](docs/PRIVACIDAD-DATOS.md:264). Procedencia de instrucciones mal descrita.**  
    **Problema:** agrupa `instructions_written_by` con `created_by` como “Ids de profes”. El primero referencia una generación, según la FK de `20261111130600_generations.sql:222`.  
    **Escenario:** quien implemente la supresión interpreta incorrectamente la procedencia y sus referencias.  
    **Fix:** separar ambos campos y describir `instructions_written_by` como id de generación, nulo tras escritura manual.

No encontré discrepancias adicionales en actor desde sesión, aislamiento tenant en las autorizaciones revisadas, elección general de `NOT_FOUND`/`FORBIDDEN`, CAS de grupos bajo lock, `rpc_begin()` al inicio ni grants de `internal_*` exclusivos para `service_role`. La razón `forbidden`, los conflictos por segundo owner/cambio de rol y restringir el retiro del owner al admin son compatibles con el contrato.

Pasaron **typecheck, lint y 527 pruebas unitarias**. **pgTAP no se ejecutó:** Supabase quedó bloqueado al escribir telemetría y Docker denegó acceso a su API. Las conclusiones SQL y de concurrencia son estáticas. El worktree quedó limpio.

Veredicto: tanda no lista — bloqueantes: W1-1, W1-2, W1-3, W1-4, W1-5, W1-6, W1-7 y W1-8.
