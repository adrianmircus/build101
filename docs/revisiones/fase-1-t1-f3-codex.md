# Revisión de Codex de T1.F3

- **F3-1 · Alta · [PRIVACIDAD-DATOS.md:241](docs/PRIVACIDAD-DATOS.md:241). La supresión puede conservar el hash de texto personal anterior.** Escenario: crear «Para Paula», editarlo a texto neutro y después suprimir a Paula. Como el texto actual no requiere redacción, el contrato conserva `op_identity`, que permite comprobar nombres candidatos mediante SHA256. También afecta ejercicios y configuraciones históricas. **Corrección:** eliminar conservadoramente esas identidades durante la supresión, independientemente del contenido actual; probar crear → editar → suprimir y corregir su clasificación como «no personal».

- **F3-2 · Media · [20261112180000_t1_fix3_op_keys.sql:279](supabase/migrations/20261112180000_t1_fix3_op_keys.sql:279). El replay depende de referencias mutables.** `clean_exercise` comprueba el tema contra el programa actual antes de buscar `op_key`. Si se elimina esa unidad, repetir el alta original devuelve `unknown_topic`. `create_group` tiene el equivalente con `subjects.enabled` en la línea 137. **Corrección:** mantener autorización y validaciones de forma primero, pero validar esas referencias después de descartar un replay; agregar ambos casos.

- **F3-3 · Media · [assessment-version-locks.test.ts:17](tests/integration/races/assessment-version-locks.test.ts:17). T14a-2 queda parcialmente resuelto.** Insertar `high` antes que `low` no garantiza el orden del `UPDATE`: un recorrido por índice puede encontrar `low` primero y mantener verde la prueba aun eliminando `app.lock_versions`. Tampoco participa una generación. **Corrección:** controlar el plan del caso negativo, comprobar que retirar/invertir los locks hace fallar la prueba y cubrir la competencia con el árbol versión → generación → ejercicios.

- **F3-4 · Baja · [assessment-op-keys.test.ts:11](tests/integration/races/assessment-op-keys.test.ts:11). Falta la carrera de `create_group`.** Quitar su advisory lock no queda detectado por los casos secuenciales actuales; dos altas iguales terminarían en un `23505` para una conexión. **Corrección:** añadir dos conexiones, exigir espera `advisory`, mismo resultado y una sola fila de grupo y propietario.

No encontré otra alta omitida: las exclusiones por claves naturales, CAS y unicidad son razonables. Firmas, repos, grants, `rpc_begin` y contratos T1.4b+ están alineados. La guardia limita correctamente la anulación a una supresión vigente de la institución y transacción correspondientes. T14a-1, -3 y -4 están corregidos.

Pasaron lint, ambos chequeos de tipos sin escritura incremental y **541 pruebas unitarias**. Docker denegó acceso: SQL y carreras revisados estáticamente. Sin cambios en archivos.

Veredicto: no listo — bloqueantes: F3-1, F3-2, F3-3.
