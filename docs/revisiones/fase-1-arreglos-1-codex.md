# Confirmación de Codex de los arreglos de T1.2a, T1.2b y callRpc

Los fixes funcionales corrigen los escenarios originales, pero quedan dos brechas de pruebas y un problema nuevo de privacidad.

| ID | Estado | Motivo |
|---|---|---|
| W1-2 | **resuelto** | `user_id` queda inmutable; la reasignación se rechaza y tiene pruebas. |
| W1-3 | **resuelto** | Agregar y revocar toman el mismo lock de identidad antes de operar sobre la membresía. |
| W1-4 | **resuelto** | Quitar staff valida membresía activa; conserva la repetición idempotente cuando ya fue retirado. |
| W1-5 | **resuelto** | La incompatibilidad devuelve `P0001 / CONFLICT / role_conflict`, reconocido por el repositorio. |
| W1-6 | **parcial** | Amplía la matriz por RPC, pero faltan las carreras coordinadas estudiante/staff. |
| W1-9 | **resuelto** | Quitar staff de un grupo archivado devuelve `INVALID archived` bajo el lock del grupo. |
| W2-1 | **resuelto** | La identidad persistida conserva grupo y username originales; renombrar o agregar inscripciones ya no la modifica. |
| W2-2 | **resuelto** | Sandbox persiste el `op_key`, repite el resultado original y rechaza su reutilización incompatible. |
| W2-3 | **resuelto** | Alta y baja comparten el lock del par antes de consultar; cierra la intercalación que producía `id:null`. |
| W2-4 | **resuelto** | El lock global por cuenta serializa vinculaciones entre instituciones; también traduce `unique_violation`. |
| W2-5 | **parcial** | Mejora permisos, pero la cobertura de concurrencia tiene falsos positivos concretos. |
| W2-6 | **resuelto** | Nombre, username y clave nulos se rechazan explícitamente con `INVALID`. |
| W2b-1 | **resuelto** | Captura lanzamiento síncrono y rechazo del builder; traduce errores esperados y descarta mensajes, detalles y causas originales. |

**Los tests con `pg_locks` no alcanzan para cerrar W1-6/W2-5.** Comprueban posesión del lock al finalizar, pero no su adquisición antes de las lecturas ni el resultado entre transacciones. Además, en [011:591](supabase/tests/011_students.test.sql:591), `enroll_student` ya tomó el lock antes de probar `unenroll_student`: eliminar el lock de la baja dejaría esa aserción verde. La limitación de `dblink` justifica otro mecanismo de prueba, no sustituye las carreras requeridas.

Sobre **`FORBIDDEN` para un estudiante ajeno al grupo: no es aceptable según el contrato**, que exige `NOT_FOUND` cuando el recurso no es visible. Revelaría la existencia del grupo, aunque por sí solo no identifica otros estudiantes ni sus perfiles. **El código actual sí aplica `NOT_FOUND` en ese caso.** La aparente excepción proviene del fixture: [011:588](supabase/tests/011_students.test.sql:588) inscribe `sf2` en `g_f`; la matriz posterior lo describe incorrectamente como ajeno.

**N1 — media, nuevo: conservar `op_identity` tras la supresión permite comprobar usernames candidatos.** [El inventario](docs/PRIVACIDAD-DATOS.md:151) lo declara «no personal» porque incluye un UUID aleatorio. Sin embargo, los grupos permanecen y sus UUID son conocidos: basta calcular `sha256(grupo + ':' + username)` para candidatos. Lo confirmé con datos sintéticos. Debe quedar nulo al suprimir al estudiante, conservando la marca `deleted` y el `op_key`, con su correspondiente prueba.

El cambio aditivo de contrato es razonable: `op_identity` estabiliza la operación y `not_applicable` evita aprovisionar sandbox; el enum de dominio ya está actualizado. Su retención necesita corregir N1.

Pasaron tipos general y estricto sin escritura incremental, lint y **541 pruebas unitarias**. Docker denegó acceso: SQL revisado estáticamente, sin ejecutar pgTAP. Sin modificaciones; árbol limpio.

Veredicto: arreglos no listos — bloqueantes: W1-6, W2-5 y N1.
