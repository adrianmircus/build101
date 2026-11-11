# Tercera revisión de Codex (11/11/2026)

Revisión de solo lectura de `docs/PLATAFORMA.md` contra las rondas 1 y 2, `CLAUDE.md`, `docs/ROADMAP.md`, el código citado y las guías de Next.js 16.4.2. Resumen: de la ronda 2 quedan 20 resueltos y 10 parciales; de los 15 parciales de la ronda 1, 7 resueltos y 8 parciales; 18 hallazgos nuevos. Codex coincide en que el SQL exacto va en el contrato de cada fase y no en el spec.

## Hallazgos nuevos

| Id | Gravedad | Tema | Problema | Corrección |
|---|---|---|---|---|
| R3-1 | alta | Cierre de generaciones | Una generación que falla no detiene a sus trabajos hermanos, y un sobreviviente puede pasar el recurso a `error` o `ready` sobre una generación nueva | Generación terminal no se reabre y detiene sus trabajos; todo cambio de estado del recurso exige que esa generación siga vigente |
| R3-2 | alta | Presupuesto | El SDK reintenta solo (`maxRetries` 2, `lib/agent/client.ts:26`) dentro de una reserva; el spec se contradice sobre liberar lo incierto; dictado, comandos y TTS no tienen tope de concurrencia; la cota por tokens no sirve para ElevenLabs | Reintentos del SDK en 0 y reserva por envío HTTP; lo incierto nunca se libera; tope compartido también para llamadas sincrónicas; cota por unidad y tarifa de cada proveedor |
| R3-3 | alta | Claves históricas | No se garantiza que las revisiones de la clave sean inmutables ni que correspondan al contenido y las preguntas aprobadas; la publicación mínima de la fase 4 no puede depender de la rúbrica de la fase 7 | Revisiones inmutables de la clave atadas a la revisión del contenido; publicar comprueba que no estén desactualizadas; definir qué clave es obligatoria por modalidad |
| R3-4 | alta | Entregas | La matriz no cruza el estado `submitted` ni la carrera entre el último autosave y la entrega; leída literal, impide corregir antes del vencimiento | Entregar congela las respuestas, comprueba la revisión del borrador y es idempotente; se corrige desde que hay entrega |
| R3-5 | alta | Consentimiento sincrónico | Dictado, comandos y TTS no comprueban consentimiento vigente ni contexto autorizado en cada llamada; el reconocimiento de voz del navegador también manda audio a un tercero | Contexto autorizado y consentimiento vigente en cada llamada, ejercicio resuelto en el servidor, consentimiento antes de prender el micrófono y alternativa accesible |
| R3-6 | alta | Nombres en el contenido | PDFs, fotos, intereses, instrucciones y dictados pueden traer nombres; hoy el documento completo va al proveedor (`lib/agent/exercises.ts:29`) | Preparar la entrada permitida al proveedor antes de la primera llamada (redacción local o revisión previa) y guardar el original aparte |
| R3-7 | alta | Anonimización | Borrar el seudónimo no anonimiza: quedan texto libre, fechas y combinaciones raras que permiten atribuir | Tratar esos registros como personales; el inventario dice por campo qué se borra, se redacta o se conserva y por qué |
| R3-8 | alta | Supresiones y restauración | El registro de supresiones puede desaparecer al restaurar, y un efecto pendiente puede volver a escribir datos de alguien borrado | Registro de supresiones fuera del rollback; marcar la baja primero y comprobarla en todo efecto pendiente; reaplicar antes de abrir accesos |
| R3-9 | alta | Compuerta legal | El consentimiento cubre la IA pero no el tratamiento de datos de salud; faltan responsable y encargado, quién autoriza por el menor y transferencias; la revisión legal (T10.6) queda después de permitir datos reales | Evaluación de impacto (Decreto 64/020, art. 6), consentimiento expreso y escrito (Ley 18.331, art. 18), información del art. 13 y transferencias (art. 23) aprobadas antes del primer dato real |
| R3-10 | alta | Despliegue | Un build hook de Netlify construye la rama, no un SHA fijo | Desplegar desde CI un build del checkout exacto (o referencia inmutable), verificar el SHA y no cancelar el flujo a mitad |
| R3-11 | media | Puentes entre fases | T2.8 saca el login viejo antes de que exista la demo sobre sandbox (T4.9); `/api/generate` sigue con 300 s y deadline de 280; T0.6 presupone Cron de Supabase | Mantener el camino viejo hasta su reemplazo o adelantar el sandbox mínimo; adaptar el ejecutor transitorio a 60 s; separar de T0.6 lo que necesita Supabase |
| R3-12 | media | Idempotencia | Un doble clic crea dos generaciones; el hash del análisis no fija institución, grupo ni la atribución de seudónimos (`lib/results/analyze.ts:12` los asigna por posición) | Id de operación del cliente con alcance institucional antes de crear la generación; el análisis incluye el snapshot de atribución en su identidad |
| R3-13 | media | Operaciones compuestas | Lectura, programa y análisis tienen partes y merge, pero `generations` no los representa | Operación padre con dependencias, cierre y fallo; el merge consume un conjunto fijo y completo |
| R3-14 | media | «Ver como Paula» | Se guarda solo el refresh token pero se vuelve con `setSession`, que pide los dos; consumir la fila primero puede dejar al visitante sin retorno | Volver con `refreshSession({ refresh_token })`; reclamar, reintentar y consumir al final |
| R3-15 | media | Acción vieja tras un deploy | Next rechaza el id antes de llegar a `defineAction` | Recuperación del lado del cliente que guarda el borrador antes de recargar, probada entre dos builds |
| R3-16 | media | Respaldos | Con PITR, Supabase deja de tomar los backups diarios | Producción es PITR más dumps propios; si hacen falta copias diarias, se programan |
| R3-17 | media | Tickets grandes | T1.4, T3.6, T9.5 y T4.4 son paquetes, no tickets | Tratarlos como macro-tickets y partirlos en el contrato de su fase, con sus dependencias |
| R3-18 | media | Instrucciones generales | `splitExercises` (`lib/results/exercises.ts:17`) descarta el texto antes del primer ejercicio | Campo de instrucciones generales en el modelo, en snapshots, revisión, publicación e impresión |

## Estado de rondas anteriores

- **Ronda 2, resueltos (20):** N1, N2, N5, N6, N7, N8, N11, N12, N13, N14, N15, N18, N19, N20, N22, N25, N26, N28, N29, N30.
- **Ronda 2, parciales (10):** N3 (R3-1), N4 (R3-2), N9 (R3-3), N10 (R3-3 a R3-5), N16 (R3-7, R3-8), N17 (R3-10), N21 (R3-11), N23 (R3-14), N24 (R3-12), N27 (R3-8, R3-16).
- **Ronda 1, resueltos (7):** 2, 3, 7, 10, 12, 18, 20.
- **Ronda 1, parciales (8):** 5 (R3-1), 8 (R3-3), 11 (R3-2), 14 (R3-8, R3-16), 19 (R3-11), 21 (R3-14), 22 (R3-10), 23 (R3-7 a R3-9).

## Fase 0 y `noUncheckedIndexedAccess`

De acuerdo con aplicarlo solo al código nuevo por `tsconfig.strict.json`, con cuatro condiciones:

- CI y las compuertas corren los dos chequeos de tipos.
- El alcance incluye los tests al lado del código.
- `include` no aísla lo importado: si el código nuevo importa uno legado, ese entra al programa estricto. Hay que cuidar esa frontera y verificarla con `--listFilesOnly`.
- El spec tiene que decir que la adopción es gradual.

## Qué va en el spec y qué en el contrato

Codex no pide SQL en el spec. Al spec le corresponden:

- los estados terminales;
- la correspondencia histórica de las claves y la entrega congelada;
- el consentimiento por operación y la frontera de salida a proveedores;
- la garantía realista de borrado y la durabilidad de las supresiones;
- la compuerta legal;
- el SHA exacto del despliegue;
- los puentes entre fases y las instrucciones generales;
- el alcance de la idempotencia y las operaciones compuestas.

Al contrato de cada fase le corresponden las transiciones, los locks, las tablas de revisiones, las RPC, las proyecciones, los recorridos de borrado, los formularios legales, el workflow de despliegue y los protocolos exactos. El contrato de la fase 2 comprueba clientes de sesión por pedido y respuestas de auth sin caché compartida (`Set-Cookie`).
