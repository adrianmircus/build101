# Revisión de Codex de T1.3a

Encontré dos bloqueos en la prueba de reconstrucción. No identifiqué una fuga efectiva en las RPC actuales; sí caminos por los que una regresión podría pasar inadvertida.

1. **T13a-1 · Media — El detector no reconoce destinatarios fuera de su lista de claves.**  
   [supabase/tests/013_reconstruction.test.sql:77](supabase/tests/013_reconstruction.test.sql:77). `leaks` busca claves y valores conocidos, pero no identifica relaciones entre versiones y estudiantes. **Escenario:** una respuesta contiene `{"version_recipients":[{"version_id":"…","student_id":"…"}]}`; el detector devuelve vacío aunque revele destinatarios. Las comprobaciones de claves exactas solo cubren algunas respuestas. **Corrección:** validar recursivamente proyecciones permitidas por RPC y contexto, y agregar controles negativos que filtren asociaciones versión–estudiante bajo distintas claves.

2. **T13a-2 · Media — Los datos de prueba no ejercitan todas las fuentes sensibles.**  
   [supabase/tests/013_reconstruction.test.sql:64](supabase/tests/013_reconstruction.test.sql:64) y [línea 104](supabase/tests/013_reconstruction.test.sql:104). Se cargan necesidades, pero ninguna versión con configuración y destinatarios ni entradas de generaciones. Además, `update_student`, `archive_student` y `restore_student` operan sobre `s5`, que no tiene necesidades. **Escenario:** una RPC agrega datos sensibles únicamente cuando existen esas filas; las llamadas siguen funcionando y la prueba queda verde porque nunca entra en ese camino. **Corrección:** sembrar esas fuentes y ejecutar las operaciones sobre estudiantes con necesidades. Incluir mutaciones negativas que demuestren que cada filtración hace fallar la prueba.

3. **T13a-3 · Baja — El guard controla nombres, no firmas.**  
   [supabase/tests/013_reconstruction.test.sql:156](supabase/tests/013_reconstruction.test.sql:156). El inventario considera cubierta cualquier función cuyo `proname` aparezca en `answers`. **Escenario:** una nueva sobrecarga de una RPC existente recibe `EXECUTE` para `authenticated`; queda exenta aunque nunca se invoque. **Corrección:** registrar y comparar firmas completas mediante `regprocedure`, incluyendo las excepciones auditadas. El guard sí detecta nombres nuevos.

La migración cumple, por inspección estática, los puntos principales: lock de operación → estudiante → necesidades; identidad almacenada y comparada bajo lock; CAS de revisión; catálogo actual correcto; prioridad `motor → gaze`, `dysgraphia → voice`, resto `standard`; y propiedad inmutable de la fila. Las lecturas construyen respuesta y conjunto auditado conjuntamente, y un fallo de auditoría aborta la transacción. Inclusión tiene alcance institucional, el admin necesita ser staff, y las distinciones `NOT_FOUND`/`FORBIDDEN` son coherentes.

Considero válidas las decisiones de registrar cada escritura aceptada aunque no cambie valores, ordenar perfiles y apoyos, admitir replays de estudiantes archivados, rechazar íntegramente pedidos mixtos y limitar la lectura grupal a inscripciones actuales de estudiantes no archivados. La duplicación del catálogo coincide con el contrato; falta una comprobación automática SQL–TypeScript, aunque actualmente ambas listas coinciden. Las tres razones nuevas tienen mensajes adecuados.

Pasaron lint, ambos chequeos de tipos —sin generar caché incremental— y **539 tests de Vitest**. Docker denegó acceso al motor: pgTAP quedó revisado estáticamente. El árbol de trabajo permanece limpio.

Veredicto: ticket no listo (bloqueantes: T13a-1, T13a-2)
