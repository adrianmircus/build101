# Revisión de Codex de T1.4b

Encontré dos bloqueantes nuevos. No modifiqué archivos; excluí F3-1…F3-4 y la carrera que están restaurando.

- **T14b-1 · Media · [20261112190000_t1_4b_versions.sql:361](supabase/migrations/20261112190000_t1_4b_versions.sql:361). Cambiar la configuración conserva generaciones vigentes de la configuración anterior.**  
  **Escenario:** hay una generación de ejercicio `running`; se cambia el perfil o `answer_mode`. Solo sube la revisión de `versions`: permanecen `current_generation_id`, la revisión del ejercicio y su procedencia. Con el protocolo C3, una salida anterior todavía cumple las condiciones para aplicarse. Marcar `stale` no invalida esa salida.  
  **Corrección:** invalidar las generaciones de adaptación afectadas bajo locks en orden versión → generaciones → ejercicios, recalcular el estado y probar que las salidas anteriores quedan `obsolete`.

- **T14b-2 · Media · [20261112190000_t1_4b_versions.sql:358](supabase/migrations/20261112190000_t1_4b_versions.sql:358). La detección de contenido omite las instrucciones editadas.**  
  **Escenario:** una versión sin generación tiene sus ejercicios vacíos y `pending`, pero el docente ya editó sus instrucciones (`instructions_revision > 1`). Cambiar la configuración deja `stale = false`, aunque conserva contenido escrito para la configuración anterior. C2 incluye las instrucciones en el contenido de la versión.  
  **Corrección:** incluir las instrucciones modificadas en `v_has_content`, distinguiéndolas de la copia inicial; agregar el caso a `016`, sembrando ese estado como dueño.

Considero razonables `keep_changed`, `no_exercises`, conservar revisión ante el mismo conjunto registrando igualmente el evento, y `CONFLICT recipient_in_other_version`. Guardar `data.recipients` permite comparar la identidad original; la supresión deberá retirar también esos ids, además de `added` y `removed`.

Archivar cerrando destinatarios sin evento adicional es compatible con este contrato. **No retira publicaciones existentes**: estas conservan sus intentos y acceso según el protocolo de entrega. Ese comportamiento deberá quedar probado al implementar publicación y retiro.

No detecté otros bloqueantes en creación/replay, diferencias de destinatarios, unicidad, permisos, aislamiento institucional, proyecciones, auditoría, guardias como dueño ni las adiciones de `013`.

Pasaron ambos chequeos de tipos sin escritura incremental, lint y **541 pruebas unitarias**. Docker denegó acceso; SQL y carreras se revisaron estáticamente.

Veredicto: ticket no listo — bloqueantes: T14b-1, T14b-2.
