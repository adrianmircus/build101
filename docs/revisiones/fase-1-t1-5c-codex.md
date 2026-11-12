# Revisión de Codex de T1.5c

No encontré hallazgos T15c que reportar. Excluí el P-1 en curso.

Por inspección:

- El listado usa claves cerradas, sin vincular estudiantes con versiones ni revelar configuración.
- La lectura para corregir rechaza borradores, devuelve la clave del intento y audita una vez con el estudiante mostrado.
- La corrección relee bajo `lock_attempt_tree`, bloquea después la nota, valida ejercicios de la publicación y aplica CAS y replay según lo acordado.
- La asignación vigente pasa de `submitted` a `graded`; retirados y reemplazados conservan su estado.
- Permisos, aislamiento institucional, razones y guardias como dueño están cubiertos.
- Las pruebas NOWAIT comprueban el orden entre asignación, intento, borrador y nota. No observé inversión de locks con publicar o entregar.

Pasaron ambos chequeos de tipos —sin caché incremental—, lint y **550 pruebas unitarias**. Docker denegó acceso: pgTAP, carreras y mutaciones quitando locks quedaron evaluadas estáticamente, sin ejecución.

No modifiqué archivos; el worktree sigue limpio.

Veredicto: ticket listo
