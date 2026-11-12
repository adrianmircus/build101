# Revisión de Codex de cierre de la fase 1, ronda 1

Encontré **una alta, tres medias y una baja**. No edité archivos. Revisé las definiciones finales de las migraciones; además, PostgreSQL local respondió por TCP y confirmé, en transacciones `READ ONLY`, que sus **189 funciones de `app` y `api` coinciden con el repositorio**.

1. **F1-1 — alta — Sigue abierta la inferencia del perfil propio.**  
   **Ubicación:** [fase-1.md:205](docs/contratos/fase-1.md:205), [needs.sql:203](supabase/migrations/20261112140000_t1_3a_needs.sql:203), [student_dto.sql:59](supabase/migrations/20261113050000_t1_5d_student_dto.sql:59).  
   **Problema:** llamar a `interface` “modo de accesibilidad” no elimina su derivación determinista: `motor → gaze`; sin motor, `dysgraphia → voice`. El contrato reconoce que la excepción sigue pendiente de confirmación del usuario.  
   **Escenario:** `student_home.interface = "gaze"` permite deducir que está registrado `motor`, contrariando la prohibición de CLAUDE.md sobre deducir el perfil propio. Persiste T15d-3.  
   **Fix:** resolver expresamente la decisión de producto. Para mantener la prohibición actual, la accesibilidad debe poder elegirse independientemente del perfil; aceptar la inferencia requiere aprobar y armonizar la excepción documental.

2. **F1-2 — media — La validación duplicada de GraphSpec acepta valores inválidos.**  
   **Ubicación:** [fix7.sql:130](supabase/migrations/20261113060000_t1_fix7.sql:130).  
   **Problema:** `proyección = original` no equivale a `is_graph_spec(original)`: los `null` usados para señalar hojas inválidas también pueden venir en el original.  
   **Escenario:** la expresión de `student_save_draft` acepta `{"functions":[{"expr":null}],"points":[]}` y `{"functions":null,"points":null}`. Confirmado contra PostgreSQL: el predicado devuelve `true` y `app.is_graph_spec` devuelve `false`. La escritura puede conservar el gráfico, mientras que `student_task` después lo omite.  
   **Fix:** usar `app.is_graph_spec` al guardar y `app.project_graph` seguido del validador al leer. Conceder a `tiza_student` EXECUTE por nombre sobre estos helpers **SECURITY INVOKER**, incluidos sus helpers puros transitivos, es un diseño más seguro de mantener: no amplía acceso a tablas ni presta privilegios de `postgres`. Agregar regresiones para hojas, elementos y listas `null`.

3. **F1-3 — media — Todavía hay entradas esperables que terminan en errores SQL crudos.**  
   **Ubicación:** [identity_groups.sql:399](supabase/migrations/20261112100000_t1_2a_identity_groups.sql:399), [identity_groups.sql:161](supabase/migrations/20261112100000_t1_2a_identity_groups.sql:161), [identity_fix.sql:112](supabase/migrations/20261112120000_t1_2a_fix.sql:112).  
   **Problema:** `add_group_staff` no valida `p_role`. Las internas de institución y membresía también delegan reglas de entrada en restricciones de tabla.  
   **Escenario:** agregar un docente válido, todavía fuera del grupo, con rol `"admin"` produce `23514`; con rol nulo, `23502`. Si ya tiene fila de staff, el rol nulo puede devolver éxito porque `v_staff.role <> NULL` no entra al `IF`. Crear una institución `school` con vencimiento también alcanza un CHECK, incluso pasando el esquema actual del repo.  
   **Fix:** validar nulos, enums y combinaciones de campos antes de escribir; responder mediante `app.raise_error`, con razones y textos registrados. Probar también las RPC directamente, evitando depender solamente de zod.

4. **F1-4 — media — Faltan guardias de pertenencia en tablas ya utilizadas.**  
   **Ubicación:** [groups_students.sql:174](supabase/migrations/20261111130200_groups_students.sql:174), [delivery.sql:164](supabase/migrations/20261111130700_delivery.sql:164), [app_schema.sql:97](supabase/migrations/20261111130000_app_schema.sql:97).  
   **Problema:** `touch_row` congela `id`, institución y creación, pero no `enrollments.group_id/student_id`, `group_staff.group_id/user_id` ni `submissions.attempt_id`. La guardia de entregas solo comprueba si ya fueron entregadas.  
   **Escenario:** una escritura privilegiada puede mover una inscripción o un borrador a otro padre de la misma institución sin disparar `P0004`, reatribuyendo datos históricos. Los grants actuales impiden al estudiante efectuar ese UPDATE, pero falta la invariante de base exigida por el checklist.  
   **Fix:** agregar guardias específicas y pruebas como propietario que exijan `P0004`; conservar únicamente las excepciones documentadas de supresión.

5. **F1-5 — baja — El inventario de razones no coincide con el SQL efectivo.**  
   **Ubicación:** [reasons.ts:16](lib/domain/errors/reasons.ts:16), por ejemplo [fix4.sql:154](supabase/migrations/20261112200000_t1_fix4.sql:154).  
   **Problema:** se levanta **`forbidden`** sin entrada en `REASON_MESSAGES`. Los textos **`not_implemented`** y **`already_enrolled`** no son levantados por ninguna definición SQL final. El fallback evita un fallo visible por `forbidden`.  
   **Escenario:** nuevas razones pueden quedar sin texto específico sin que falle ninguna comprobación.  
   **Fix:** registrar `forbidden`, retirar o justificar las entradas reservadas y comprobar automáticamente la correspondencia.

El **grafo de bloqueos**, expandiendo helpers, triggers y escrituras, queda así. `S` significa SHARE, `U` UPDATE y `NKU` NO KEY UPDATE; los conjuntos se ordenan por id donde corresponde.

| Familia de RPC | Camino de bloqueos |
|---|---|
| Crear grupo, estudiante, práctico, ejercicio o versión | Advisory de operación → padres → filas nuevas |
| Editar/archivar/restaurar grupo; modificar staff | Grupo U → staff cuando corresponde |
| Editar/archivar/restaurar estudiante | Estudiante U |
| Inscribir / desinscribir | Advisory de inscripción → grupo S → estudiante S para alta / inscripción U para baja |
| Necesidades | Advisory de operación → estudiante U → necesidades U |
| Notas | Advisory de operación para alta → estudiante S → nota |
| Registrar / revocar consentimiento | Advisory de consentimiento → estudiante S → archivo S → consentimiento U; revocar toma advisory → consentimiento U |
| Editar práctico y originales | Grupo S → práctico U → originales U → versiones U |
| Configuración de versión | Grupo S → práctico U → versión U → generaciones U → ejercicios adaptados U |
| Destinatarios / archivo de versión | Grupo S → práctico U → versión U → destinatarios; altas toman advisory de inscripción → estudiante S |
| Editar contenido o clave de pregunta | Grupo S → práctico S → versión U → ejercicio U → pregunta U → clave de pregunta U → clave global |
| Aprobar/rechazar versión | Grupo S → práctico S → versión U |
| Crear generación | Advisory de operación → grupo S → práctico S → versión U → generaciones U → ejercicios U → clave cuando corresponde |
| Registrar salida / terminar generación | Versión U → generación U → ejercicios U → preguntas/claves o clave global |
| Editar/confirmar clave global | Grupo S → práctico S → versión U → generaciones U → clave U |
| Registrar revisión generada | Versión U → generación U → clave U |
| Publicar | Advisory de operación → grupo S → práctico NKU → versión U → advisories de inscripción y estudiantes S → asignaciones U → intentos U |
| Empezar/guardar/entregar; calificar | Asignación U → intento U → borrador U → calificación U |
| Abrir intento | Actualiza únicamente el intento |
| Identidad | Advisory de identidad → membresía; vincular cuenta toma advisory de cuenta → estudiante U → aprovisionamiento U → advisory de identidad |

Las lecturas restantes no toman locks explícitos de fila; algunas agregan auditoría. **No encontré un ciclo de deadlock realizable entre las RPC actuales ni una adquisición tardía incompatible de un padre.** La inversión aparente grupo ↔ advisory de inscripción usa SHARE compatible. Las actualizaciones posteriores de versiones o asignaciones reutilizan locks ya adquiridos. El `NKU` inicial de publicación conserva la compatibilidad necesaria con los KEY SHARE de FK.

Sobre **privilegios efectivos**:

| Rol | Objetos propios de Tiza |
|---|---|
| `anon` | Sin uso de `app/api/public`, sin ejecución de RPC |
| `authenticated` | Uso de `api`, ejecución de 64 RPC; sin acceso directo a tablas |
| `service_role` | Ejecución de las nueve `internal_*`; sin acceso a `app` |
| `tiza_student` | Ocho RPC propias; lecturas filtradas por RLS y escrituras por columna del protocolo de intentos |

Las **45 tablas de `app` fuerzan RLS**. Las **73 RPC son SECURITY DEFINER con search_path vacío**. `api` no contiene tablas ni vistas, y es el único esquema configurado para REST.

Los privilegios estudiantiles alcanzan para las RPC actuales: lectura de sus filas y publicaciones; de consentimientos, solo vigencia; UPDATE limitado en asignaciones e intentos; INSERT/UPDATE limitado en borradores; ningún DELETE. No encontré acceso a necesidades, claves, generaciones ni datos de otros estudiantes.

Hay una excepción fuera de `api`: **`supabase_functions.http_request()`**, perteneciente a Supabase, conserva EXECUTE para `authenticated`. Devuelve `trigger`, no es una RPC invocable normalmente y su esquema no está expuesto por REST. También permanecen grants administrados por Supabase en sus propios esquemas; las revocaciones del proyecto no eliminan todos los privilegios de toda la instalación.

En **duplicación**, las tres proyecciones inline coincidieron con `app.project_graph` en los **78 casos comparados**. La lectura también coincidió con validar la proyección. El defecto comprobado es la condición de guardado de F1-2.

En **consistencia y producto**, no encontré otra discrepancia en NOT_FOUND/FORBIDDEN ni altas omitidas respecto del inventario de idempotencia. El conteo efectivo usa `char_length`, incluso mediante `app.js_length`; los límites de documentos completos siguen expresados intencionalmente en bytes. Las generaciones nuevas no incorporan automáticamente nombres ni ids de estudiantes a `inputs`; estos siguen siendo JSON libre suministrado por código interno. La redacción previa al proveedor queda pendiente del puente de IA previsto para otra fase.

Sobre **CI**, no identifiqué otro bloqueo estático específico de Ubuntu: `pg` está declarado, el setup obtiene las variables de Supabase, los tipos normalizan LF y Playwright instala Chromium y sus dependencias. Esto **no certifica que los tres jobs pasen**: ejecuté typecheck, lint y **550 pruebas unitarias**, todos verdes. No ejecuté cobertura, build, Playwright, pgTAP, integración, regeneración de tipos ni migraciones desde cero. Docker denegó acceso; las comprobaciones SQL ejecutadas fueron exclusivamente de lectura.

Veredicto: fase no lista — bloqueantes: F1-1, F1-2, F1-3 y F1-4.
