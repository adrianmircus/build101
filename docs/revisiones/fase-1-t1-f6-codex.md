# Confirmación de Codex de T1.F6

**El vector original de P-1 dentro de GraphSpec está cerrado**, pero quedan dos hallazgos medios:

- **SQL no coincide con zod.** [leaf_text](supabase/migrations/20261113040000_t1_fix6.sql:19) cuenta unidades UTF-16; zod **4.6.7**, fijado en el lockfile, cuenta puntos de código. Confirmado: una etiqueta de 31 emojis pasa GraphSpec, pero SQL la rechaza y la proyección devuelve `null`. También ocurre con una expresión de 101 emojis. Hay que alinear validador, proyección y nota contractual.

- **Queda una vía estructural en `options[].text`, heredada de F5.** [publication_content](supabase/migrations/20261113040000_t1_fix6.sql:88) sigue usando `project_option`, que copia `text` íntegro. Confirmé que una opción con `text: {"correctOptionId":"B","recipients":["otro"]}` satisface el CHECK de la tabla y conserva ambos campos al proyectarse. Sin `graph`, la nueva validación la omite. Requiere una fila sembrada como dueño; las RPC normales rechazan ese tipo. Falta validar también la opción completa.

El resto revisado:

- Ningún objeto/array sobrevivió en las hojas de GraphSpec; colores y claves adicionales se eliminan.
- Ejercicios, enunciados e instrucciones proceden de columnas `text`; `aids` se reconstruye como `{"readAloud":true}`.
- `invalid_option_graph` impide insertar publicación e intentos. Puede haber una actualización previa mediante `refresh_version_status`, pero la excepción revierte toda la llamada.

Pasaron lint, ambos chequeos de tipos y **550 pruebas**. Probé los helpers por TCP con transacciones `READ ONLY`; sus cuerpos coinciden con el repositorio. No ejecuté pgTAP completo. Sin cambios en archivos.

Veredicto: no listo
