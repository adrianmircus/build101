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
