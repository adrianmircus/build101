# Revisión de Codex de T1.6a y T1.6b

- **W2b-1 · Media · [lib/server/repos/rpc.ts:51](lib/server/repos/rpc.ts:51)**  
  **Problema:** si `db.rpc()` lanza o su builder rechaza, el error original escapa sin traducción ni sanitización.  
  **Escenario:** lo reproduje con un cliente Supabase que usa `throwOnError()`, compatible con `RpcDb` sin casts. Ante una respuesta `23505`, `callRpc` propagó un `PostgrestError` cuyo `message` contenía el nombre del ejemplo y conservaba `details`. El cliente predeterminado sí sanitiza esa misma respuesta.  
  **Corrección:** capturar las excepciones de la invocación y del `await`; traducir únicamente errores estructurados reconocidos y convertir el resto en `UnexpectedRpcError`, sin conservar mensajes, detalles ni causas originales. Agregar pruebas de lanzamiento síncrono y promesa rechazada con datos sensibles.

No encontré otros defectos en la revisión estática: validación del registro, fallback de razones, encabezado de pedido, fábricas aisladas por UUID, correspondencia de nombres y reglas de capas. Las 13 funciones de repos tienen pruebas de integración; las aserciones de aislamiento fallarían si las operaciones cruzadas resolvieran exitosamente.

Validación:

- Lint: pasó.
- Pruebas unitarias: **537 pasaron**.
- Tipos general y estricto: pasaron desactivando la escritura incremental. El comando original fue bloqueado al intentar escribir `tsconfig.tsbuildinfo`.
- Integración: no pudo ejecutarse; el setup informó que Supabase local no estaba disponible.

No modifiqué archivos ni revisé SQL.

Veredicto: tickets no listos (bloqueante: W2b-1).
