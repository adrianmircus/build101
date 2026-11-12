# Lecciones de las revisiones de la fase 1

Lo que Codex encontró una y otra vez en los tickets de base (T1.2a, T1.2b). Todo ticket de base de la fase 1 lo cumple antes de pedir revisión. Las revisiones completas están en `docs/revisiones/fase-1-*.md`.

## Idempotencia

- La identidad de una operación (`op_key` u `op_id`) se guarda tal como fue al crearla: la RPC, el recurso exacto y los datos que la definen. Nunca se reconstruye desde datos que pueden cambiar después (un username, una inscripción actual).
- Se compara bajo el lock, con esa identidad guardada. Misma identidad: devuelve el resultado guardado. Otra: `CONFLICT op_key_reused`.
- Vale también en un sandbox. Si una tabla no tiene dónde guardar la operación en ese caso, se escala como cambio de contrato; no se deja sin idempotencia.

## Carreras

- `INSERT … ON CONFLICT DO NOTHING` seguido de un `SELECT` sin lock puede devolver nada si otra transacción borra o cierra la fila en el medio. Primero se toma el lock que serializa ese par (por ejemplo grupo y estudiante, o institución y usuario), después se consulta y se escribe.
- Una restricción única que dos transacciones pueden disputar (por ejemplo `students.user_id`) se serializa con un lock antes de comprobar, o se traduce a un error del protocolo. Nunca llega un `23505` crudo al repo.
- El mismo lock y el mismo orden en todas las operaciones que tocan ese par, también en los triggers.
- Las carreras se prueban de verdad, con dos conexiones: pruebas de integración en `tests/integration/races/` con los helpers de `tests/integration/support/` (`pg`). La primera transacción queda abierta con sus locks, la segunda arranca en otra conexión, se espera a verla bloqueada en `pg_stat_activity` y recién ahí se confirma la primera. Una prueba con `pg_locks` dentro de pgTAP no alcanza: no demuestra que el lock se toma antes de leer.
- Antes de dar por buena una prueba de carrera, se comprueba que falla sin el lock.
- Las fechas que se comparan con otras filas bajo lock usan `clock_timestamp()`, no `now()`: `now()` es la hora de inicio de la transacción, que puede ser anterior a la fila que se espera (pasó con `unenroll_student`).

## Errores

- Todo error esperado sale por `app.raise_error(código, razón)`, también desde triggers. Nada de `23514`, `23505` ni excepciones de Postgres para reglas de negocio.
- Cada razón nueva se suma a `lib/domain/errors/reasons.ts` con su texto, sin datos del usuario.
- No queda código muerto que atrape errores que ya no ocurren.

## Validación

- Las validaciones de longitud, formato y rango no dejan pasar `NULL`: en SQL, `length(NULL) < 3` es `NULL` y no entra al `IF`. Los nulos se rechazan explícitamente con `INVALID`.
- Las columnas que identifican a quién pertenece una fila (`user_id`, `student_id`, `institution_id`, `publication_id`…) son inmutables, con una guardia que lo hace cumplir.

## Pruebas

- La matriz de permisos se prueba por RPC, no repartida entre funciones: para cada RPC, cada rol que la niega según `lib/domain/permissions/matrix.ts`, un usuario de otra institución y sin sesión, comprobando código y razón completos y que no cambió nada.
- Cada regla de estado tiene su prueba en los dos sentidos (por ejemplo, en un grupo archivado se rechaza agregar y también quitar, o se documenta por qué no).
- Una prueba tiene que fallar si se rompe lo que dice probar.
