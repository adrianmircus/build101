# Revisión de Codex de T1.5b

No encontré hallazgos independientes que ameriten un id T15b. No repetí los hallazgos de T1.5a.

Por inspección:

- Las cuatro `student_*` se definen dentro de la ventana, quedan bajo `tiza_student` y no agregan privilegios ni helpers definer.
- Empezar, guardar y entregar usan asignación → intento → borrador, releen bajo lock y evalúan el momento con `clock_timestamp()`. Comparan la revisión del borrador; entregar congela las respuestas y el replay conserva fecha y marca de atraso.
- Los ids ajenos se rechazan sin distinguir existencia. Las respuestas y razones visibles no incorporan perfiles, claves ni datos de otros estudiantes.
- `021b` cubre estado × momento × operación, con las excepciones declaradas de idempotencia y lectura de intentos reemplazados.
- Las pruebas `NOWAIT` comprueban el orden entre padres e hijos. Las carreras comprueban resultados además de esperas. No observé inversión con publicación, incluido que esta tome primero assessment → version.

Acepto `attempt_closed` para retirados/reemplazados, el replay de empezar a cualquier momento y que `open` deje los reemplazados para T1.5d. El lock explícito del borrador es redundante entre escritores que respetan el lock de asignación, pero conserva el protocolo. El límite defensivo es razonable; técnicamente limita `answers` a **5.000.000 bytes**, no el documento completo con `choices`.

Pasaron ambos chequeos de tipos —sin escritura incremental—, lint y **550 pruebas unitarias**. Docker denegó acceso: pgTAP, integración y mutaciones sin locks quedaron sin ejecutar; su sensibilidad está evaluada estáticamente. No modifiqué archivos y el worktree sigue limpio.

Veredicto: ticket listo
