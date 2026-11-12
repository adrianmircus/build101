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
