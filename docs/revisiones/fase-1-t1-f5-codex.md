# Confirmación de Codex de T1.F5

- **P-1 — parcial; sigue bloqueando, alta.** `is_graph_spec` reproduce las restricciones de GraphSpec y no identifiqué retornos `NULL` en los validadores nuevos. Sin embargo, [project_graph](supabase/migrations/20261113020000_t1_fix5.sql:260) copia las hojas con `->`/`#>` sin comprobar sus tipos. Por ejemplo:
  `{"functions":[{"expr":{"correctOptionId":"B"}}],"points":[]}`.
  Este gráfico podía entrar por las RPC anteriores y conserva `correctOptionId` al publicarse después del fix. También sobreviven objetos arbitrarios en coordenadas, etiquetas y límites. **La proyección todavía permite JSON anidado prohibido.** Falta validar el resultado proyectado y rechazar o sanear datos anteriores; 020c solo ensucia claves adicionales, manteniendo hojas válidas.

- **P-2 — resuelto.** `readAloud: true` universal tiene respaldo contractual y coincide con la UI: botón para quienes no usan mirada y lectura por voz para mirada. Evita que ese indicador distinga perfiles. La futura elección docente queda explícitamente fuera del contrato actual.

- **P-3 — resuelto.** El estado pasa a `published` bajo el lock inicial. `FOR NO KEY UPDATE` es adecuado: serializa publicaciones, conflictos con `FOR SHARE`/`FOR UPDATE` y mantiene compatibilidad con los `KEY SHARE` de las FK, evitando el ciclo descrito. No subir la revisión resulta coherente con el alcance documentado y no permite sobrescribir el estado mediante `update_assessment`.

No encontré otra alta/media independiente en el diff usando el checklist de lecciones. `aids` queda cerrado; las RPC de DTO estudiantil siguen siendo stubs, por lo que su salida efectiva aún no puede verificarse.

Pasaron **lint, ambos chequeos de tipos y 550 pruebas unitarias**. Docker denegó acceso: SQL, carreras y sensibilidad de las pruebas revisados estáticamente. Worktree limpio, sin ediciones.

Veredicto: no listo — bloquea P-1 (alta).
