# Confirmación de Codex de T1.F4

Revisado «Merge T1.F4» (`71481fb`). Los seis hallazgos quedan **resueltos por inspección**:

- **F3-1 — resuelto.** Contrato, inventario y pruebas eliminan ambas columnas aun después de editar a texto neutro; incluyen inscripciones históricas. La guardia permite anularlas en cualquier fila institucional durante la supresión: aceptable como capacidad interna, con el alcance concreto a cargo de T9.5. Recrear una fila al repetir el alta después queda documentado.
- **F3-2 — resuelto.** Autorización y forma preceden al replay; materia habilitada y tema actual se comprueban después. Las pruebas cubren referencias eliminadas, identidad distinta, altas nuevas y actor sin autorización.
- **F3-3 — resuelto.** Comprueba orden físico inverso, desactiva recorridos por índices y agrega competencia con versión → generación → ejercicios. Quitar o invertir los locks haría fallar el `NOWAIT` sobre `high`. No pude ejecutar esa mutación.
- **F3-4 — resuelto.** Dos conexiones exigen espera `advisory`, respuesta idéntica y un solo grupo/propietario. Sin advisory, la espera por unicidad no satisface la prueba.
- **T14b-1 — resuelto.** Invalida generaciones `version` y `exercise`, limpia referencias y procedencia, y recalcula estado bajo locks ordenados. C3 rechazaría sus salidas tardías. Conservar `answer_key` es coherente mientras no cambie el contenido: su validez exige comparar snapshots, además del flag `stale`.
- **T14b-2 — resuelto.** Incluye `instructions_revision > 1`; prueba tanto instrucciones editadas como copia inicial sin contenido.

No detecté nuevas issues **alta/media** frente al checklist.

El [SQL final](supabase/migrations/20261112200000_t1_fix4.sql:196) contiene también T14b: una instalación nueva no necesita el `psql` adicional. No pude verificar que la base aplicada en dos pasos coincida con ese archivo.

Pasaron ambos chequeos de tipos sin escritura incremental, lint y **550 pruebas unitarias**. Docker denegó acceso: pgTAP y carreras revisados estáticamente. Árbol de trabajo limpio.

Veredicto: listo
