# Revisión de Codex de T1.4c

- **T14c-1 · Media · [version-ops.test.ts:73](tests/integration/races/version-ops.test.ts:73). Las carreras de `set_question_key` no verifican su lock de versión.**  
  **Problema:** ambos casos compiten por la misma pregunta. Por inspección, seguirían pasando al quitar `lock_version_tree` de esa RPC: el `SELECT … FOR UPDATE` de la pregunta todavía serializa los pedidos y permite releer la clave. Tampoco comprueban `held.probe`.  
  **Escenario:** esa regresión permitiría tomar pregunta → ejercicio → versión. Otro escritor que conserve versión → ejercicio → pregunta podría formar un deadlock, sin que estas pruebas lo detecten. Incumple la checklist de que la carrera falle sin el lock.  
  **Corrección:** agregar una carrera que mantenga bloqueada únicamente la versión, arranque `set_question_key` y compruebe mediante `NOWAIT` que todavía no tomó la pregunta ni el ejercicio. Verificar en una base descartable que quitar o retrasar `lock_version_tree` hace fallar la prueba.

No detecté otros bloqueantes en la implementación revisada. Los `FOR SHARE` de grupo y práctico preceden al árbol y mantienen el orden de T1.4a/T1.F4 y del archivo; no encontré una inversión actual ni una conversión posterior del lock del práctico.

Considero válidas las decisiones sobre comparar los datos originales del evento sin hash, devolver la clave actual como no-op con cualquier revisión y generar un `op_id` propio para cada cambio efectivo. Anular la procedencia del ejercicio ante cambios de pregunta o clave protege C3. Retirar la aprobación al rechazar y dejar `pending` un cuerpo compuesto por espacios, tabulaciones o saltos de línea también es coherente.

El resto del CAS, las revisiones en cascada, `answer_keys.stale`, el replay del resultado guardado, aprobación completa, motivos, `get_version.keys`, aislamiento, errores, guardias como dueño y adiciones a `013` quedan cubiertos por inspección.

Pasaron ambos chequeos de tipos con escritura incremental desactivada, lint y **550 pruebas unitarias**. Docker denegó acceso: pgTAP, carreras y la mutación indicada se revisaron estáticamente. No modifiqué archivos.

Veredicto: ticket no listo — bloqueantes: T14c-1.
