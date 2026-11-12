# Revisión de Codex de T1.F2 y T1.6c

Encontré **un bloqueante en las pruebas**.

**F2-1 — Media — La prueba de identidad congelada da un falso positivo.**  
En [014_notes_consents.test.sql:492](supabase/tests/014_notes_consents.test.sql:492), el `UPDATE` corre como `authenticated`, que carece de acceso al esquema `app`: falla con `42501` antes de alcanzar el trigger. **Quitando la guardia de `op_key`/`op_identity`, la prueba seguiría pasando.** Debe ejecutar cada cambio como propietario, exigir `P0004` y comprobar que falla al retirar la guardia. La implementación SQL sí congela ambas columnas por inspección.

| Hallazgo anterior | Estado | Comprobación |
|---|---|---|
| R-1 | **Resuelto** | Valida el host efectivo y rechaza `hostaddr`/`service`; pasaron los 16 casos del guard. |
| R-2 | **Resuelto** | `clock_timestamp()` después de los locks; regresión obligatoria, sin tolerar `23514`. |
| R-3 | **Resuelto** | Captura la hora después de bloquear estudiante, archivo y consentimiento; agrega la carrera de vencimiento. |
| R-4 | **Resuelto** | Impide reatribuir ambos actores tras borrarlos; pruebas privilegiadas específicas. |

El resto de T1.F2 y T1.6c cumple por inspección: identidad SHA256 original, unicidad por autor, firma y registro sincronizados, inventario actualizado, repos sobre `callRpc`, aislamiento y comprobaciones de `audit_log` con request id. Sin otros hallazgos alta/media.

Pasaron **typecheck, lint y 540 pruebas unitarias**. Docker denegó acceso: pgTAP, integración y carreras quedaron revisados estáticamente; no pude ejecutar la comprobación retirando locks. Árbol de trabajo limpio.

Veredicto: no listo (bloqueante: F2-1).
