# Revisión de Codex de cierre de la fase 1, ronda 2

Queda un bloqueo **medio: F1-4**.

| Hallazgo | Estado | Resultado |
|---|---|---|
| F1-1 | **Resuelto bajo la decisión indicada** | No queda derivación activa del perfil: solo `set_student_interface` escribe el ajuste. Los valores preexistentes conservan su correlación histórica; la confirmación de producto sigue pendiente. |
| F1-2 | **Resuelto** | Guardado con `is_graph_spec`; lectura con proyección y validación. Los ocho helpers nuevos son **SECURITY INVOKER, IMMUTABLE y sin acceso a tablas**, incluidas sus dependencias. |
| F1-3 | **Resuelto** | Las entradas señaladas validan antes de escribir y devuelven razones registradas. No encontré otro parámetro de RPC delegado únicamente a una restricción de tabla. |
| F1-4 | **Parcial — media** | Las tres guardias originales están corregidas, pero quedan columnas de pertenencia desprotegidas. |
| F1-5 | **Resuelto** | Inventario alineado. Una razón literal nueva sin registrar hace fallar la comparación SQL; lo comprobé mediante una mutación en memoria. |

**F1-4 sigue bloqueando por dos huecos:**

- [student_pseudonyms_frozen](supabase/migrations/20261113070000_t1_fix8.sql:615) solo protege `student_id`. Esta tabla **no tiene `touch_row`**: un seudónimo desvinculado, sin referencias de feedback, puede cambiar `institution_id` mediante UPDATE privilegiado sin `P0004`.
- [account_provisioning_frozen](supabase/migrations/20261113070000_t1_fix8.sql:629) tampoco congela `auth_user_id` una vez fijado. Puede sustituirse por otro UUID libre, reatribuyendo la cuenta conservada para reconciliación y supresión.

Los grants actuales impiden esos UPDATE a los clientes, pero falta la invariante de base exigida por F1-4. Corresponde completar las guardias y probar ambos cambios como propietario.

El **grafo de locks no incorpora ciclos nuevos**: `set_student_interface` toma estudiante `FOR UPDATE`; los helpers y las nuevas guardias no agregan locks. En privilegios hay **74 RPC definer**: `authenticated` pasa de 64 a **65**, `service_role` conserva nueve internas y `tiza_student` sus ocho RPC más los ocho helpers puros. Se mantienen las **45 tablas con RLS forzada**, sin nuevas lecturas de perfiles o claves.

No encontré otra alta/media en `dbafd38..HEAD`. Verifiqué PostgreSQL mediante transacciones `READ ONLY`, incluidas las 26 funciones de la migración y casos inválidos de GraphSpec. No repetí la suite informada por el orquestador. Worktree intacto.

Veredicto: fase no lista — bloqueante: F1-4 (media).

## Ronda 3

**F1-4 sigue parcial (media).** `student_pseudonyms` queda corregida y el cambio directo de `auth_user_id` dispara `P0004`, pero quedan huecos:

- **En el fix:** [fix9:31](supabase/migrations/20261113080000_t1_fix9.sql:31) permite `auth_user_id: A → NULL → B`, incluso manteniendo `status = 'active'`. El contrato documenta **conservar el UUID** tras borrar Auth; no existe FK que lo ponga en NULL. Hay que congelarlo una vez establecido y ajustar la prueba que acepta vaciarlo.
- **Pertenencia:** [generations_guard](supabase/migrations/20261112220000_t1_4d_generations.sql:51) permite cambiar `requested_by` por otro usuario; [invitations_frozen](supabase/migrations/20261113070000_t1_fix8.sql:755) permite cambiar `email`, reatribuyendo el destinatario incluso después de aceptar.
- **Identidad de operación:** siguen editables `account_provisioning.op_key/op_identity`, `operations.op_key/kind` e `import_runs.op_key`. Permiten reasignar la identidad que sostiene los reintentos; faltan guardas y pruebas `P0004`.

El barrido de las **45 tablas** también encontró identidades técnicas sin congelar: `subjects.id`, `rate_limits.key/window_start` y `student_rpc_windows.id/txid`.

Verificación exclusivamente `READ ONLY`: catálogo, restricciones y evaluación de guardas vigentes sobre variables sintéticas. No ejecuté UPDATE ni repetí pgTAP. Worktree intacto; ninguna alta identificada.

Veredicto: fase no lista

## Ronda 4

**F1-4 sigue parcial (media): quedan dos reasignaciones `A → NULL → B` sin `P0004`.**

- [students.user_id](supabase/migrations/20261113070000_t1_fix8.sql:649): la guardia permite vaciar la cuenta y después vincular otra. Reatribuye el estudiante; congelar `account_provisioning.auth_user_id` no bloquea este camino.
- [invitations.accepted_by](supabase/migrations/20261113090000_t1_fix10.sql:79): incluso con la invitación aceptada, permite borrar el actor y fijar otro. La transición documentada a NULL no justifica la posterior reasignación a B.

Hay que distinguir la vinculación inicial de una vinculación previa eliminada y probar ambos recorridos completos.

El resto de lo señalado en ronda 3 queda corregido. No encontré otra alta/media en el diff: quitar la FK de `generations.requested_by` respeta C7 y la RPC conserva la validación inicial del actor; ningún RPC vigente cambia `institutions.kind/code` ni `files.bucket/path/purpose`. Esas guardas tampoco alteran el orden documentado de supresión.

Barrido de las 45 tablas y comprobación en PostgreSQL **READ ONLY**: las 52 funciones de triggers coinciden con las migraciones. Evalué las guardas sobre variables sintéticas, sin UPDATE ni modificaciones del worktree; no repetí las suites informadas.

Veredicto: fase no lista

## Ronda 5

**F1-4 sigue abierta: queda un rodeo de severidad media en `students.user_id`.**

Para un estudiante S vinculado a A:

1. Como propietario, poner su aprovisionamiento en `status = 'deleted', student_id = NULL`: las guardias actuales lo permiten.
2. Borrar Auth A: la cascada deja `S.user_id = NULL`.
3. Llamar a `internal_link_student_user(S, B)`, fuera del modo supresión, con B libre y sin conflicto de roles.

La [nueva guardia](supabase/migrations/20261113100000_t1_fix11.sql:20) ya no encuentra la memoria porque busca por `student_id`. El [RPC](supabase/migrations/20261112130000_t1_2b_fix.sql:60) obtiene `v_status = NULL` y continúa; el trigger posterior actualiza cero filas. **S termina vinculado a B aunque el aprovisionamiento conserve A.** Requiere la escritura privilegiada inicial, como los hallazgos anteriores de F1-4.

Hay que conservar esa memoria asociada mientras exista S y rechazar la vinculación si falta aprovisionamiento. Agregar la regresión completa pasando por el RPC.

**Invitaciones queda resuelta.** Tampoco encontré un bloqueo nuevo para borrar Auth y después el estudiante, cumpliendo los pasos previos de supresión. No identifiqué otra alta/media en el diff.

Verificación exclusivamente `READ ONLY`: evalué las guardias vigentes con registros sintéticos y contrasté catálogo y fuentes —212 funciones coinciden—. No ejecuté escrituras ni repetí las suites informadas; worktree intacto.

Veredicto: fase no lista

## Ronda 6

**F1-4 sigue abierta: queda un rodeo de severidad media mediante TRUNCATE**, bajo el mismo supuesto de escritura como propietario de las rondas anteriores.

La [guardia nueva](supabase/migrations/20261113110000_t1_fix12.sql:52) cubre DELETE, pero TRUNCATE no la ejecuta. El catálogo confirma que tampoco hay trigger de TRUNCATE ni FK entrantes que lo impidan.

Partiendo de S vinculado a A:

1. Truncar `app.account_provisioning`.
2. Insertar un aprovisionamiento nuevo para S, con `auth_user_id = NULL` y estado `pending`.
3. Borrar Auth A: S queda con `user_id = NULL`.
4. Ejecutar `internal_link_student_user(S, B)`: la fila existe y ya no recuerda A; las guardias permiten vincular B.

**Hace falta rechazar TRUNCATE y agregar esta regresión completa.** Los roles de API no tienen ese privilegio.

Los otros caminos revisados quedan cerrados: una fila de otro estudiante no sustituye la memoria, `institution_id` está congelado y el orden «marcar deleted → borrar Auth → borrar estudiante» sigue siendo compatible.

Verificación exclusivamente `READ ONLY`: catálogo y evaluación sintética de las guardias; no ejecuté el recorrido con escrituras ni repetí las suites. Las 213 funciones coinciden con las migraciones. No encontré otra alta/media en el diff; worktree intacto.

Veredicto: fase no lista

## Ronda 7

**F1-4 sigue abierta: queda un rodeo de severidad media mediante INSERT**, dentro del modelo indicado.

Como propietario, con cuentas A y B libres:

1. Insertar S en `app.students` con `user_id = A`, sin aprovisionamiento. La memoria solo se registra [después de UPDATE](supabase/migrations/20261113100000_t1_fix11.sql:43).
2. Borrar Auth A: la FK deja `S.user_id = NULL`.
3. Insertar su aprovisionamiento con `auth_user_id = NULL`. La [guardia nueva](supabase/migrations/20261113120000_t1_fix13.sql:41) lo acepta porque S ya está desvinculado.
4. Ejecutar `internal_link_student_user(S, B)`: acepta B y la registra como primera cuenta, olvidando A.

S permanece existente durante todo el recorrido. No requiere DDL ni desactivar triggers. Hay que rechazar el INSERT de estudiantes ya vinculados, o garantizar que ese INSERT registre obligatoriamente la primera cuenta, y agregar la regresión.

**El rodeo de TRUNCATE queda cerrado:** confirmé las 45 tablas con el trigger correcto habilitado. No identifiqué otra alta/media en el diff.

Verificación en PostgreSQL `READ ONLY`, mediante catálogo y guardias instaladas sobre registros sintéticos; no ejecuté el recorrido con escrituras ni repetí las suites informadas. Worktree intacto.

Veredicto: fase no lista


## Ronda 8

**Quedan tres caminos de severidad media; ninguna alta identificada.** Fix14 cierra el INSERT señalado en ronda 7, pero falta cubrir concurrencia y dos actores precargados.

1. **Primera cuenta: carrera entre UPDATE directos del propietario.** Partiendo de S desvinculado y su aprovisionamiento con `auth_user_id = NULL`:

   - T2 escribe `auth_user_id = B` y mantiene la transacción abierta.
   - T1 escribe `S.user_id = A`. La guardia lee la versión comprometida del aprovisionamiento, todavía NULL, y permite vincular.
   - El [trigger posterior](supabase/migrations/20261113100000_t1_fix11.sql:37) espera a T2. Cuando T2 confirma, PostgreSQL reevalúa `auth_user_id IS NULL`: actualiza **cero filas**, sin error.
   - T1 confirma: **S está vinculado a A, pero recuerda B**. Borrar Auth A y ejecutar `internal_link_student_user(S,B)` permite cambiar de cuenta sin borrar S.

   La [guardia previa](supabase/migrations/20261113110000_t1_fix12.sql:67) no bloquea el aprovisionamiento. La RPC sí lo bloquea, pero el DML directo está en alcance. Hace falta comprobar y registrar la memoria atómicamente, con regresión de dos conexiones.

2. **`invitations.accepted_by`: INSERT pendiente con A → aceptación con B.** No hay guardia de INSERT ni CHECK que impida `status='pending', accepted_at=NULL, accepted_by=A`. Después, la [excepción de aceptación](supabase/migrations/20261113100000_t1_fix11.sql:62) permite sustituir A por B al fijar `accepted_at`. Ambos estados pasan los CHECK. Hay que impedir el actor anticipado y permitir su establecimiento únicamente desde NULL.

3. **`consents.revoked_by`: INSERT vigente con A → revocación con B.** Análogo: `status='granted', revoked_at=NULL, revoked_by=A` es admisible; la [guardia](supabase/migrations/20261112160000_t1_fix2.sql:237) permite reemplazar A por B durante `granted → revoked`. Requiere la misma protección de nacimiento y primer establecimiento.

La matriz completa del vínculo queda así:

| Tabla | INSERT | UPDATE | DELETE | TRUNCATE |
|---|---|---|---|---|
| `students` | Solo sin cuenta, fix14; UPSERT también pasa por esta guardia. | Identidad congelada. Primer vínculo exige aprovisionamiento; A→B rechazado; A→NULL exige que desaparezca `app_users`. **Queda la carrera 1.** | Termina la vida de S; sujeto a sus FK. | Rechazado, fix13. |
| `account_provisioning` | FK y unicidades; fix13 exige coincidencia si S ya está vinculado. Puede anticipar la cuenta mientras S está desvinculado. | Cuenta fijada inmutable; pertenencia e identidad congeladas; `student_id` solo se vacía cuando S desaparece. **NULL→cuenta participa en la carrera 1.** | Rechazado mientras existan S e institución, fix12. Permitido tras su desaparición. | Rechazado, fix13. |
| `app_users` | Exige Auth existente; no vincula estudiantes automáticamente. | ID congelado por `touch_row`. | Vacía `students.user_id`; conserva la memoria del aprovisionamiento. Recrear A solo habilita A. | Rechazado, fix13. |
| `auth.users` | No crea vínculo automáticamente. | Cambiar el ID referenciado falla por FK; no existe cascada de UPDATE hacia otra cuenta. | Cascada a `app_users`, luego desvinculación; conserva la memoria. | Sin CASCADE, las FK lo impiden; con CASCADE alcanza tablas `app` y lo rechaza fix13. |
| `memberships` | Agrega acceso, sin escribir vínculo ni memoria; controla incompatibilidad estudiante/staff. | Usuario e institución inmutables; rol/revocación no alteran la memoria. | Quita acceso, sin desvincular ni borrar memoria. | Rechazado, fix13. |

Los cascades tampoco ofrecen otro rodeo secuencial:

- **Borrar estudiante:** el aprovisionamiento debe estar `deleted`; su FK vacía únicamente `student_id` y conserva A. Se eliminan dependientes con CASCADE; seudónimos y archivos todavía vinculados impiden el borrado hasta cumplir los pasos previos.
- **Borrar institución:** elimina S y su aprovisionamiento. La excepción de `account_provisioning_kept` permite esa destrucción conjunta; si otra FK falla, se revierte todo.
- **Borrar cuenta:** conserva S y A recordada, salvo que sea el propietario de un sandbox, cuya eliminación también destruye la institución.
- **DELETE y recreación con el mismo UUID:** inicia otra vida de fila; el contrato conserva la memoria mientras S existe, sin imponer una tumba permanente después de borrarlo.

En el resto del barrido:

- `created_by` de grupos/prácticos/versiones, `reserved_by`, `operations.requested_by`, `import_runs.user_id`, `invited_by`, `student_notes.author_user_id` y `consents.recorded_by`: permiten A→NULL incluso directamente; bloquean A→B y NULL→B.
- Invitaciones ya aceptadas y consentimientos ya revocados bloquean la reasignación posterior, incluso tras borrar la cuenta. Los huecos son los nacimientos anticipados descritos.
- `student_pseudonyms.student_id`: permite desvincular con `unlinked_at`, nunca reasignar ni revincular. Su FK no desvincula automáticamente; DELETE depende de referencias y TRUNCATE está bloqueado.
- Actores históricos y `generations.requested_by`: inmutables y sin FK que los vacíe; la redacción no permite cambiarlos. `grades.graded_by` cambia legítimamente al recalificar.

Verificación exclusivamente **READ ONLY**: las **216 funciones instaladas coinciden con las migraciones** y las **45 tablas tienen el trigger correcto de TRUNCATE habilitado**. Evalué las guardias sobre registros sintéticos; la carrera se deduce del orden de lecturas y locks, sin ejecutarla con escrituras. No repetí las suites informadas. Worktree intacto.

Veredicto: fase no lista


## Ronda 9

Sí: **los tres caminos de ronda 8 quedan cerrados**.

- **Primera cuenta:** el lock del aprovisionamiento y la comprobación posterior impiden confirmar un vínculo con memoria distinta. La regresión cubre ambos órdenes y reproduce el fallo anterior.
- **`accepted_by` y `revoked_by`:** nacen nulos; las guardias de transición impiden precargarlos, reemplazarlos o reasignarlos tras vaciarlos.
- **Locks:** no identifiqué ciclos nuevos entre RPC y triggers. Comparten estudiante → aprovisionamiento; la nueva consulta inversa al estudiante no toma locks. Tampoco hay FK entrantes al aprovisionamiento que añadan conflictos.
- **REPEATABLE READ:** una modificación concurrente posterior al snapshot provoca `40001`, sin permitir confirmar la inconsistencia; requiere reintentar la transacción completa. [Comportamiento documentado por PostgreSQL](https://www.postgresql.org/docs/17/transaction-iso.html#XACT-REPEATABLE-READ).

Revisé nuevamente la matriz de ronda 8: **no quedan altas/medias abiertas ni encontré nuevas en el diff**. Confirmé en catálogo las 218 funciones contra las migraciones y las 45 tablas con protección de TRUNCATE habilitada.

Verificación exclusivamente de lectura; no repetí las suites informadas. Worktree limpio.

Veredicto: fase lista para push

