# Revisión de Codex: docs/PLATAFORMA.md, ronda 1 (10/11/2026)

Revisión independiente, solo lectura. 23 hallazgos: 15 altos y 8 medios. Todos se incorporaron al spec en la ronda 1 (ver «Cambios por la revisión» al final de docs/PLATAFORMA.md).

Resumen de los hallazgos:

1. Alta. Storage: la política por institución deja a estudiantes y profes sin relación descargar consentimientos.
2. Alta. Faltan GRANT/REVOKE explícitos por tabla, columna y función; RPC internas ejecutables por `authenticated`.
3. Alta. El DTO del estudiante no está definido: `Question.answer` (lib/contract.ts) y `stepsOf` usa `version.profiles` (lib/solve/steps.ts).
4. Alta. El worker toma un segundo trabajo con 20 s libres cuando una llamada puede tardar 45 s.
5. Alta. Máquina de estados de jobs incompleta: lease, intentos al reclamar, muerte del worker, fallo después de cancelar.
6. Alta. `finish_version_if_complete` concurrente: dos últimos ejercicios en paralelo pueden dejar la versión sin `ready`.
7. Alta. Falta una identidad inmutable de generación (`generation_id`) y la vigencia frente a ediciones.
8. Alta. Las entregas no apuntan a una revisión publicada inmutable; los ejercicios no tienen id estable.
9. Alta. read-pdf y syllabus/units (300 s) y results/analyze (120 s) quedan fuera de jobs.
10. Alta. Demo: usuarios anónimos pueden crear sandboxes sin límite, instituciones reales, y Supabase no purga anónimos.
11. Alta. El tope de IA se registra después del gasto; faltan reserva atómica, concurrencia por institución y global.
12. Alta. Con SELECT directo sobre perfiles no se puede garantizar el registro de accesos.
13. Alta. El consentimiento no se vuelve a chequear al ejecutar un trabajo ni cancela pendientes al revocarse.
14. Alta. Los backups y el PITR no cubren Storage.
15. Alta. El email sintético sin institución choca con la unicidad por institución.
16. Media. `app_users` con `institution_id` impide que una profe trabaje en dos colegios.
17. Media. Subida firmada: falta reservar el archivo y validar el contenido real.
18. Media. El plan B de `after()` es incompleto: el worker también depende de `after()`.
19. Media. Dependencias invertidas entre tickets (T1.4 necesita T2.1, T3.9 necesita jobs, `analyze_group` sin ticket, T2.8 borra auth que usa /api/tts).
20. Media. Contratos SQL sin RLS contradicen la regla; worktrees que comparten el mismo Supabase local.
21. Media. Altas en Auth no son atómicas con las tablas; «Ver como Paula» sin mecanismo concreto.
22. Media. Importar datos del navegador necesita servicio con idempotencia; previews que comparten staging.
23. Media. /privacidad promete que no se guardan datos en servidores; faltan retención, baja y borrado de copias.

Sesión de Codex: 01a1c85d-20fa-77f3-ae4f-c29bf1b2a518
